import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Writes one Codex rollout transcript. `firstUserMessage` mirrors the
 * `event_msg`/`user_message` payload the runtime records for the prompt the
 * user typed; omitting it produces a transcript with no user turn.
 */
const writeCodexTranscript = async (
  homeDir: string,
  codexSessionId: string,
  workspacePath: string,
  firstUserMessage?: string,
): Promise<string> => {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });

  const lines: string[] = [
    JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
  ];
  if (firstUserMessage !== undefined) {
    lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstUserMessage } }));
  }

  const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

test('Codex todo_list carries the completed lifecycle state from live events', () => {
  const [message] = new CodexSessionsProvider().normalizeMessage({
    type: 'item',
    itemType: 'todo_list',
    id: 'todo-live-1',
    eventType: 'item.completed',
    items: [{ text: 'Verify the finished changes', completed: true }],
  }, 'codex-todo-1');

  assert.equal(message?.id, 'todo-live-1');
  assert.equal(message?.kind, 'tool_use');
  assert.equal(message?.toolName, 'TodoList');
  assert.equal(message?.status, 'completed');
  assert.deepEqual(message?.toolInput, {
    items: [{ text: 'Verify the finished changes', completed: true }],
  });
});

test('Codex command item updates keep the native id and terminal output', () => {
  const provider = new CodexSessionsProvider();
  const [running] = provider.normalizeMessage({
    type: 'item',
    itemType: 'command_execution',
    id: 'command-live-1',
    command: 'npm test',
    output: '',
    status: 'in_progress',
  }, 'codex-command-1');
  const [completed] = provider.normalizeMessage({
    type: 'item',
    itemType: 'command_execution',
    id: 'command-live-1',
    command: 'npm test',
    output: 'all tests passed',
    status: 'completed',
  }, 'codex-command-1');

  assert.equal(running?.id, 'command-live-1');
  assert.equal(running?.status, 'in_progress');
  assert.equal(running?.toolResult, undefined);
  assert.equal(completed?.id, 'command-live-1');
  assert.deepEqual(completed?.toolResult, {
    content: 'all tests passed',
    isError: false,
  });
});

test('Codex history restores persisted todo_list response items', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-todo-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const transcriptPath = await writeCodexTranscript(tempRoot, 'codex-todo-history-1', workspacePath);
    await appendFile(transcriptPath, [
      {
        type: 'response_item',
        timestamp: '2026-07-07T00:00:00.000Z',
        payload: {
          type: 'todo_list',
          id: 'todo-history-1',
          items: [{ text: 'Restore the task list', completed: false }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-07-07T00:00:01.000Z',
        payload: {
          type: 'todo_list',
          id: 'todo-history-1',
          items: [{ text: 'Restore the task list', completed: true }],
        },
      },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-todo-history-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-todo-history-1', 'codex-todo-history-1');
      await new CodexSessionSynchronizer().synchronize();

      const result = await new CodexSessionsProvider().fetchHistory('app-todo-history-1');
      assert.equal(result.messages.length, 1);
      assert.equal(result.messages[0]?.toolName, 'TodoList');
      assert.deepEqual(result.messages[0]?.toolInput, {
        items: [{ text: 'Restore the task list', completed: true }],
      });
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer preserves the title assigned when CloudCLI creates a session', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-app-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath, 'Provider transcript title must not win');
    await withIsolatedDatabase(async () => {
      // The app allocates its own id and later maps the provider id onto it,
      // exactly as a message sent from cloudcli does.
      sessionsDb.createAppSession('app-1', 'codex', workspacePath, 'Fix the login redirect');
      sessionsDb.assignProviderSessionId('app-1', 'codex-app-1');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the login redirect');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer skips sub-agent rollout files', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-subagent-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Codex >=0.144 spawn_agent threads write their own rollout files into the
    // same sessions tree, marked via thread_source/source in session_meta.
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, 'rollout-codex-subagent-1.jsonl'),
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'codex-subagent-1',
          cwd: workspacePath,
          thread_source: 'subagent',
          parent_thread_id: 'codex-parent-1',
          source: { subagent: { thread_spawn: { parent_thread_id: 'codex-parent-1', depth: 1 } } },
        },
      })}\n`,
      'utf8'
    );
    await writeCodexTranscript(tempRoot, 'codex-parent-1', workspacePath);

    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      const processed = await synchronizer.synchronize();

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionById('codex-parent-1'));
      assert.equal(sessionsDb.getSessionById('codex-subagent-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer leaves indexed sessions untitled when no name is available', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-indexed-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // A CLI-created session has no app row; its first user message must NOT be
    // used as the title, preserving the existing indexing behavior.
    await writeCodexTranscript(tempRoot, 'codex-indexed-1', workspacePath, 'This prompt should be ignored');
    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('codex-indexed-1')?.custom_name, 'Untitled Codex Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history restores UserMessage items written by Codex >=0.150', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-user-message-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Codex >=0.150 writes user prompts as `item_completed` + `UserMessage`
    // items instead of `event_msg`/`user_message` events. The transcript also
    // carries a system-injected AGENTS.md user message that must not surface.
    const providerSessionId = 'codex-modern-1';
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });
    const transcriptLines = [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-07-07T00:00:00.000Z',
        payload: {
          type: 'item_completed',
          item: {
            type: 'UserMessage',
            id: 'um-1',
            content: [{ type: 'text', text: 'Explain the rollout format', text_elements: [] }],
          },
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-07-07T00:00:01.000Z',
        payload: {
          type: 'item_completed',
          item: {
            type: 'UserMessage',
            id: 'um-2',
            content: [{ type: 'text', text: 'Then fix the parser', text_elements: [] }],
          },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T00:00:02.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: '# AGENTS.md instructions for /tmp/workspace' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T00:00:03.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Here is the analysis.' }],
        },
      }),
    ];
    await writeFile(
      path.join(sessionsDir, `rollout-${providerSessionId}.jsonl`),
      `${transcriptLines.join('\n')}\n`,
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-modern-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-modern-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const history = await new CodexSessionsProvider().fetchHistory('app-modern-1');
      const userMessages = history.messages.filter((message) => message.role === 'user');
      const assistantMessages = history.messages.filter((message) => message.role === 'assistant');

      assert.deepEqual(
        userMessages.map((message) => message.content),
        ['Explain the rollout format', 'Then fix the parser'],
      );
      // The system-injected AGENTS.md message is not surfaced as a user turn.
      assert.ok(!userMessages.some((message) => message.content?.includes('AGENTS.md')));
      assert.equal(assistantMessages.length, 1);
      assert.equal(assistantMessages[0]?.content, 'Here is the analysis.');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history links SubAgentActivity items to spawned sub-agents in Codex >=0.150', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-subagent-activity-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Codex >=0.150 persists sub-agent lifecycle as `item_completed` +
    // `SubAgentActivity` items instead of `event_msg`/`sub_agent_activity`.
    // The item id matches the spawn call id, so the spawned Task tool result
    // must still link to the right sub-agent via the activity-provided path.
    const providerSessionId = 'codex-subagent-modern-1';
    const callId = 'call_subagent_spawn_1';
    const agentPath = '/root/security_review';
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });
    const transcriptLines = [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T00:00:00.000Z',
        payload: {
          type: 'function_call',
          name: 'spawn_agent',
          call_id: callId,
          arguments: JSON.stringify({ task_name: 'security_review' }),
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-07-07T00:00:01.000Z',
        payload: {
          type: 'item_completed',
          item: {
            type: 'SubAgentActivity',
            id: callId,
            kind: 'started',
            agent_thread_id: 'thread-1',
            agent_path: agentPath,
          },
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-07T00:00:02.000Z',
        payload: {
          type: 'agent_message',
          id: 'agent-msg-1',
          author: agentPath,
          recipient: '/root',
          content: [{
            type: 'input_text',
            text: `Message Type: FINAL_ANSWER\nSender: ${agentPath}\nPayload:\n审查完成，未发现问题`,
          }],
        },
      }),
    ];
    await writeFile(
      path.join(sessionsDir, `rollout-${providerSessionId}.jsonl`),
      `${transcriptLines.join('\n')}\n`,
      'utf8',
    );

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-subagent-modern-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-subagent-modern-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const history = await new CodexSessionsProvider().fetchHistory('app-subagent-modern-1');
      const taskUses = history.messages.filter((message) => message.kind === 'tool_use' && message.toolName === 'Task');
      const results = history.messages.filter((message) => message.kind === 'tool_result');

      // Persisted history embeds the completed result on the Task tool instead
      // of returning a second standalone tool_result row.
      assert.equal(taskUses.length, 1);
      assert.equal(results.length, 0);
      assert.equal(taskUses[0]?.toolId, callId);
      assert.equal(taskUses[0]?.toolResult?.content, '审查完成，未发现问题');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history preserves wrapped exec tool calls and results', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exec-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-exec-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    const wrappedCalls = [
      {
        callId: 'shell-command-1',
        input: 'const cmds = ["echo one", "echo two"]; await Promise.all(cmds.map(command => tools.shell_command({ command })));',
        expectedToolName: 'Bash',
        expectedToolInput: JSON.stringify({ command: 'echo one\necho two' }),
      },
      {
        callId: 'json-shell-command-1',
        input: 'const r = await tools.shell_command({"command":"Get-Content -Raw README.md","workdir":"C:\\\\workspace","timeout_ms":10000}); text(r)',
        expectedToolName: 'Bash',
        expectedToolInput: JSON.stringify({ command: 'Get-Content -Raw README.md' }),
      },
      {
        callId: 'exec-command-1',
        input: 'await tools.exec_command({"command":"echo current"});',
        expectedToolName: 'Bash',
        expectedToolInput: JSON.stringify({ command: 'echo current' }),
      },
      { callId: 'apply-patch-1', input: 'await tools.apply_patch("*** Begin Patch\\n*** End Patch");' },
      { callId: 'web-run-1', input: 'await tools.web__run({ search_query: [{ q: "Codex" }] });' },
      { callId: 'update-plan-1', input: 'await tools.update_plan({ plan: [] });' },
      { callId: 'unknown-1', input: 'await tools.unknown_wrapper({ value: true });' },
    ];
    const transcriptLines = [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
    ];
    for (const call of wrappedCalls) {
      transcriptLines.push(
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'custom_tool_call', name: 'exec', call_id: call.callId, input: call.input },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'custom_tool_call_output', call_id: call.callId, output: `result:${call.callId}` },
        }),
      );
    }
    await writeFile(transcriptPath, `${transcriptLines.join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-exec-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-exec-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const history = await new CodexSessionsProvider().fetchHistory('app-exec-1');
      const toolUses = history.messages.filter((message) => message.kind === 'tool_use');
      const toolResults = history.messages.filter((message) => message.kind === 'tool_result');
      const toolUsesById = new Map(toolUses.map((message) => [message.toolId, message]));

      assert.equal(toolUses.length, wrappedCalls.length);
      assert.equal(toolResults.length, 0);
      assert.equal(history.total, wrappedCalls.length);
      assert.equal(history.messages.length, wrappedCalls.length);
      for (const call of wrappedCalls) {
        const toolUse = toolUsesById.get(call.callId);
        assert.ok(toolUse);
        assert.equal(toolUse.toolName, call.expectedToolName || 'exec');
        assert.equal(toolUse.toolInput, call.expectedToolInput || call.input);
        assert.equal(toolUse.toolResult?.content, `result:${call.callId}`);
      }
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
