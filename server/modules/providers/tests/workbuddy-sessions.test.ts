import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { WorkbuddySessionsProvider } from '@/modules/providers/list/workbuddy/workbuddy-sessions.provider.js';

async function withIsolatedEnvironment(
  runTest: (env: { sessionsRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionsRoot = process.env.WORKBUDDY_PROJECTS_ROOT;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'wb-sessions-test-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const sessionsRoot = path.join(tempDirectory, 'projects');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.WORKBUDDY_PROJECTS_ROOT = sessionsRoot;
  await initializeDatabase();
  await mkdir(cwd, { recursive: true });

  try {
    await runTest({ sessionsRoot, cwd });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSessionsRoot === undefined) {
      delete process.env.WORKBUDDY_PROJECTS_ROOT;
    } else {
      process.env.WORKBUDDY_PROJECTS_ROOT = previousSessionsRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Mirrors the engine's directory encoding: strip the leading slash, `/` → `-`. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-');
}

/** Writes one WorkBuddy JSONL transcript file with the given message events. */
async function writeTranscript(
  sessionsRoot: string,
  cwd: string,
  engineSessionId: string,
  events: unknown[],
): Promise<void> {
  const dir = path.join(sessionsRoot, encodeCwd(cwd));
  await mkdir(dir, { recursive: true });
  const lines = events.map((event) => JSON.stringify(event));
  await writeFile(path.join(dir, `${engineSessionId}.jsonl`), `${lines.join('\n')}\n`);
}

const userMessage = (text: string, timestamp: number) => ({
  type: 'message',
  role: 'user',
  timestamp,
  cwd: '/Users/test/project',
  content: [{ type: 'input_text', text: `<user_query>${text}</user_query>` }],
});

const assistantMessage = (text: string, timestamp: number) => ({
  type: 'message',
  role: 'assistant',
  timestamp,
  cwd: '/Users/test/project',
  content: [
    { type: 'reasoning_text', text: `thinking about ${text}` },
    { type: 'output_text', text },
  ],
});

test('fetchHistory decodes the WorkBuddy transcript via the provider session id', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-transcript-1';
    const appSessionId = 'app-wb-1';
    const time = Date.now();
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      userMessage('hello there', time),
      assistantMessage('Hi!', time + 100),
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'WB session');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const provider = new WorkbuddySessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 3);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'hello there');
    assert.equal(result.messages[1]?.role, 'assistant');
    assert.equal(result.messages[1]?.kind, 'thinking');
    assert.equal(result.messages[2]?.role, 'assistant');
    assert.equal(result.messages[2]?.content, 'Hi!');
    assert.equal(result.messages[2]?.provider, 'workbuddy');
  });
});

test('fetchHistory pages the tail when limit/offset are supplied', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-transcript-paged';
    const appSessionId = 'app-wb-paged';
    const time = Date.now();
    // Each assistant turn normalizes to a thinking + text pair, so the four
    // events become six messages: user, thinking, text, user, thinking, text.
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      userMessage('first prompt', time),
      assistantMessage('first reply', time + 100),
      userMessage('second prompt', time + 200),
      assistantMessage('second reply', time + 300),
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Paged');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const provider = new WorkbuddySessionsProvider();

    // offset 0 returns the newest page and reports older messages remain.
    const firstPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 0 });
    assert.equal(firstPage.total, 6);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.limit, 2);
    assert.equal(firstPage.offset, 0);
    assert.deepEqual(
      firstPage.messages.map((m) => m.content),
      ['thinking about second reply', 'second reply'],
    );

    // Walking the offset back reaches the middle of the conversation; older
    // messages (the first user turn) still remain.
    const secondPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 2 });
    assert.equal(secondPage.total, 6);
    assert.equal(secondPage.hasMore, true);
    assert.deepEqual(
      secondPage.messages.map((m) => m.content),
      ['first reply', 'second prompt'],
    );

    // The final walk reaches the oldest page and reports nothing remains.
    const oldestPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 4 });
    assert.equal(oldestPage.total, 6);
    assert.equal(oldestPage.hasMore, false);
    assert.deepEqual(
      oldestPage.messages.map((m) => m.content),
      ['first prompt', 'thinking about first reply'],
    );

    // A null limit returns everything.
    const fullHistory = await provider.fetchHistory(appSessionId);
    assert.equal(fullHistory.hasMore, false);
    assert.equal(fullHistory.messages.length, 6);
  });
});

test('fetchHistory returns empty history when no transcript exists', async () => {
  await withIsolatedEnvironment(async ({ cwd }) => {
    const appSessionId = 'app-wb-empty';
    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Empty');

    const provider = new WorkbuddySessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  });
});

test('fetchHistory coalesces WorkBuddy task lifecycle snapshots', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-task-history';
    const appSessionId = 'app-wb-task-history';
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-history-1',
        uuid: 'task-history-started',
        timestamp: 1_700_000_000_000,
        description: '历史任务开始',
      },
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-history-1',
        uuid: 'task-history-finished',
        timestamp: 1_700_000_100_000,
        status: 'completed',
        summary: '历史任务完成',
      },
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Task history');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const result = await new WorkbuddySessionsProvider().fetchHistory(appSessionId);
    const taskMessages = result.messages.filter((message) => message.kind === 'task_notification');

    assert.equal(taskMessages.length, 1);
    assert.equal(taskMessages[0]?.status, 'completed');
    assert.equal(taskMessages[0]?.summary, '历史任务完成');
    assert.equal(taskMessages[0]?.timestamp, new Date(1_700_000_100_000).toISOString());
  });
});

test('fetchHistory keeps a finite task-event page bounded to its requested tail', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-history-task-tail';
    const appSessionId = 'app-wb-task-tail';
    const events = Array.from({ length: 100 }, (_, index) => ({
      type: 'system',
      subtype: 'task_notification',
      task_id: `task-tail-${index}`,
      uuid: `task-tail-event-${index}`,
      timestamp: 1_700_000_000_000 + index,
      status: 'completed',
      summary: `Task ${index}`,
    }));
    await writeTranscript(sessionsRoot, cwd, engineSessionId, events);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Task tail');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const result = await new WorkbuddySessionsProvider().fetchHistory(appSessionId, { limit: 2 });

    assert.equal(result.total, 100);
    assert.equal(result.messages.length, 2);
    assert.deepEqual(result.messages.map((message) => message.summary), ['Task 98', 'Task 99']);
  });
});

test('normalizeMessage converts WorkBuddy task metadata into a TodoList snapshot', () => {
  const messages = new WorkbuddySessionsProvider().normalizeMessage({
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'call-task-create',
        content: [{ type: 'text', text: 'Task #1 created successfully: 验证任务显示' }],
        is_error: false,
        _meta: {
          rawResponse: {
            task: {
              id: '1',
              subject: '验证任务显示',
              status: 'pending',
            },
            todos: [{
              id: '1',
              content: '验证任务显示',
              status: 'pending',
            }],
          },
          renderer: { type: 'todo' },
        },
      }],
    },
  }, 'app-wb-task-meta');

  assert.deepEqual(messages.map((message) => message.kind), ['tool_result', 'tool_use']);
  assert.equal(messages[0]?.content, 'Task #1 created successfully: 验证任务显示');
  assert.equal(messages[1]?.toolName, 'TodoList');
  assert.equal(messages[1]?.id, 'workbuddy-todo-app-wb-task-meta');
  assert.deepEqual(messages[1]?.toolInput, {
    items: [{
      id: '1',
      content: '验证任务显示',
      status: 'pending',
    }],
  });
});

test('normalizeMessage keeps cancelled tool results distinct from ordinary errors', () => {
  const [message] = new WorkbuddySessionsProvider().normalizeMessage({
    type: 'function_call_result',
    id: 'function-result-cancelled',
    callId: 'call-cancelled',
    name: 'Bash',
    status: 'cancelled',
    output: { type: 'text', text: 'cancelled by user' },
  }, 'app-wb-cancelled');

  assert.equal(message?.kind, 'tool_result');
  assert.equal(message?.isError, true);
  assert.equal(message?.status, 'cancelled');
});

test('fetchHistory keeps tool rows timestamp-stable across repeated reads', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-transcript-tools';
    const appSessionId = 'app-wb-tools';
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      userMessage('list files', 1_700_000_000_000),
      {
        type: 'function_call',
        id: 'fc-1',
        callId: 'call-1',
        name: 'Bash',
        arguments: { command: 'ls' },
        timestamp: 1_700_000_010_000,
      },
      {
        type: 'function_call_result',
        id: 'fcr-1',
        callId: 'call-1',
        status: 'completed',
        output: { type: 'text', text: 'file-a' },
        timestamp: 1_700_000_020_000,
      },
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Tool rows');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const provider = new WorkbuddySessionsProvider();
    const firstRead = await provider.fetchHistory(appSessionId);
    const secondRead = await provider.fetchHistory(appSessionId);

    const firstToolRows = firstRead.messages.filter((message) => message.kind.startsWith('tool_'));
    const secondToolRows = secondRead.messages.filter((message) => message.kind.startsWith('tool_'));

    assert.equal(firstToolRows.length, 2);
    // The frontend pagination only stitches older pages when repeated reads of
    // the same transcript row produce identical timestamps/ids.
    assert.deepEqual(
      secondToolRows.map(({ id, kind, timestamp, toolId }) => ({ id, kind, timestamp, toolId })),
      firstToolRows.map(({ id, kind, timestamp, toolId }) => ({ id, kind, timestamp, toolId })),
    );
    assert.equal(firstToolRows[0]?.timestamp, new Date(1_700_000_010_000).toISOString());
    assert.equal(firstToolRows[1]?.timestamp, new Date(1_700_000_020_000).toISOString());
  });
});

test('fetchHistory folds TaskCreate/TaskUpdate calls into one TodoList snapshot', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-task-tools';
    const appSessionId = 'app-wb-task-tools';
    const time = 1_700_000_000_000;
    const taskCall = (id: string, callId: string, name: string, args: Record<string, unknown>, timestamp: number) => ({
      type: 'function_call',
      id,
      callId,
      name,
      arguments: JSON.stringify(args),
      timestamp,
    });
    const taskResult = (id: string, callId: string, name: string, outputText: string, timestamp: number) => ({
      type: 'function_call_result',
      id,
      callId,
      name,
      status: 'completed',
      output: { type: 'text', text: outputText },
      timestamp,
    });

    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      userMessage('按清单执行', time),
      taskCall('fc-1', 'call-1', 'TaskCreate', { subject: '第一项', description: '描述一', activeForm: '做第一项' }, time + 100),
      taskResult('fcr-1', 'call-1', 'TaskCreate', 'Task #1 created successfully: 第一项', time + 200),
      taskCall('fc-2', 'call-2', 'TaskCreate', { subject: '第二项', description: '描述二', activeForm: '做第二项' }, time + 300),
      taskResult('fcr-2', 'call-2', 'TaskCreate', 'Task #2 created successfully: 第二项', time + 400),
      taskCall('fc-3', 'call-3', 'TaskUpdate', { status: 'in_progress', taskId: '1' }, time + 500),
      taskResult('fcr-3', 'call-3', 'TaskUpdate', 'Updated task #1 status', time + 600),
      taskCall('fc-4', 'call-4', 'TaskUpdate', { status: 'completed', taskId: '2' }, time + 700),
      taskResult('fcr-4', 'call-4', 'TaskUpdate', 'Updated task #2 status', time + 800),
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Task tools');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const result = await new WorkbuddySessionsProvider().fetchHistory(appSessionId);
    const todoMessages = result.messages.filter((message) => message.toolName === 'TodoList');
    const items = (todoMessages[0]?.toolInput as { items?: unknown[] } | undefined)?.items;

    assert.equal(todoMessages.length, 1);
    assert.deepEqual(items, [
      { id: '1', content: '第一项', status: 'in_progress', activeForm: '做第一项' },
      { id: '2', content: '第二项', status: 'completed', activeForm: '做第二项' },
    ]);
    assert.equal(
      result.messages.some((message) => message.toolName === 'TaskCreate' || message.toolName === 'TaskUpdate'),
      false,
    );
  });
});

test('fetchHistory restores image_blob_ref attachments as user images', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const blobPath = path.join(sessionsRoot, 'sample.png');
    const blobBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await mkdir(sessionsRoot, { recursive: true });
    await writeFile(blobPath, blobBytes);

    const engineSessionId = 'wb-image';
    const appSessionId = 'app-wb-image';
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      {
        type: 'message',
        role: 'user',
        timestamp: 1_700_000_000_000,
        cwd: '/Users/test/project',
        content: [
          { type: 'input_text', text: '<user_query>看看这张图</user_query>' },
          {
            type: 'image_blob_ref',
            blob_id: 'blob-1',
            blob_path: blobPath,
            mime: 'image/png',
            size: blobBytes.length,
            original_filename: 'sample.png',
          },
        ],
      },
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Image');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const result = await new WorkbuddySessionsProvider().fetchHistory(appSessionId);
    const userRow = result.messages.find((message) => message.role === 'user');
    const images = Array.isArray(userRow?.images) ? userRow.images : [];

    assert.equal(userRow?.content, '看看这张图');
    assert.equal(images.length, 1);
    assert.equal(images[0]?.name, 'sample.png');
    assert.equal(images[0]?.data, `data:image/png;base64,${blobBytes.toString('base64')}`);
  });
});

test('fetchHistory maps top-level reasoning events to thinking', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-reasoning';
    const appSessionId = 'app-wb-reasoning';
    const time = 1_700_000_000_000;
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      {
        type: 'reasoning',
        timestamp: time,
        cwd: '/Users/test/project',
        rawContent: [{ type: 'reasoning_text', text: '先想想方案' }],
      },
      {
        type: 'message',
        role: 'assistant',
        timestamp: time + 100,
        cwd: '/Users/test/project',
        content: [{ type: 'output_text', text: '方案如下' }],
      },
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Reasoning');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const result = await new WorkbuddySessionsProvider().fetchHistory(appSessionId);
    const thinking = result.messages.filter((message) => message.kind === 'thinking');

    assert.equal(thinking.length, 1);
    assert.equal(thinking[0]?.content, '先想想方案');
  });
});
