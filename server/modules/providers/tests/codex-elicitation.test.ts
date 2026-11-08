import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

/**
 * An MCP server can ask the person for input mid-turn. Codex forwards that as a
 * reverse JSON-RPC request (`mcpServer/elicitation/request`) and blocks the tool
 * call until this client answers, so these drive the real runtime against the
 * mock app-server: the assertion that matters is the frame the MCP server would
 * have received, not just the message the UI saw.
 */

const MOCK_SERVER = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex-app-server-mock.mjs'),
);

const SESSION_ID = 'app-codex-elicitation';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `read` until it returns a value, so assertions do not race the process. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the mock app-server');
    }
    await sleep(10);
  }
}

const sessions = new CodexSessionsProvider();

type LoggedRequest = { method: string; params: Record<string, unknown> };
type Harness = {
  messages: NormalizedMessage[];
  requests: () => LoggedRequest[];
  run: (options?: Record<string, unknown>) => Promise<void>;
};

let tempDir: string | null = null;

const byKind = (messages: NormalizedMessage[], kind: string) =>
  messages.filter((message) => message.kind === kind);

async function createHarness(): Promise<Harness> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-elicitation-'));
  const logPath = path.join(tempDir, 'requests.jsonl');
  process.env.CODEX_MOCK_LOG = logPath;

  const messages: NormalizedMessage[] = [];
  const writer: ProviderRuntimeWriter = {
    isWebSocketWriter: true,
    send: (message) => messages.push(message as NormalizedMessage),
  };

  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveProviderConfigDir: () => null,
    resolveSettingsFile: () => null,
    resolveResumeModel: async () => 'test-model',
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };

  const requests = () => {
    try {
      return readFileSync(logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LoggedRequest);
    } catch {
      return [];
    }
  };

  return {
    messages,
    requests,
    run: (options = {}) => codexRuntime.run('write to the vault', { sessionId: SESSION_ID, cwd: process.cwd(), ...options }, writer, context),
  };
}

const answerFor = (harness: Harness) =>
  harness.requests().find((entry) => entry.method === 'mcpServer/elicitation/answer');

beforeEach(() => {
  process.env.CODEX_APP_SERVER_COMMAND = MOCK_SERVER;
  process.env.CODEX_MOCK_MODE = 'runtime';
  process.env.CODEX_MOCK_SCRIPT = 'elicit';
});

afterEach(async () => {
  delete process.env.CODEX_APP_SERVER_COMMAND;
  delete process.env.CODEX_MOCK_MODE;
  delete process.env.CODEX_MOCK_SCRIPT;
  delete process.env.CODEX_MOCK_LOG;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

test('an MCP form reaches the client as an McpElicitation request, and the answer goes back to the server', async () => {
  const harness = await createHarness();
  const runDone = harness.run();

  const permission = await waitFor(() => byKind(harness.messages, 'permission_request')[0]);
  assert.equal(permission.toolName, 'McpElicitation');
  assert.equal(permission.provider, 'codex');

  const input = permission.input as Record<string, unknown>;
  assert.equal(input.serverName, 'vault');
  assert.equal(input.message, 'Which target should this write to?');
  assert.deepEqual(input.requestedSchema, {
    type: 'object',
    properties: { target: { type: 'string', enum: ['prod', 'dev'] }, count: { type: 'integer' } },
    required: ['target'],
  });

  // Listed under the app session id, so a reconnecting tab replays the form.
  const requestId = permission.requestId as string;
  const pending = codexRuntime.permissions.listPending(SESSION_ID);
  assert.equal(pending.some((entry) => entry.requestId === requestId), true);

  codexRuntime.permissions.resolve(requestId, {
    allow: true,
    // Only flat values survive: a form field is never an object.
    updatedInput: { content: { target: 'dev', count: 3, stray: { nested: true } } },
  });

  await runDone;

  const answer = await waitFor(() => answerFor(harness));
  assert.deepEqual(answer.params.result, { action: 'accept', content: { target: 'dev', count: 3 } });
  assert.equal(
    harness.messages.some((message) => message.kind === 'permission_resolved' && message.requestId === requestId),
    true,
  );
});

test('a refusal reaches the server as decline', async () => {
  const harness = await createHarness();
  const runDone = harness.run();

  const permission = await waitFor(() => byKind(harness.messages, 'permission_request')[0]);
  codexRuntime.permissions.resolve(permission.requestId as string, { allow: false });

  await runDone;

  const answer = await waitFor(() => answerFor(harness));
  assert.deepEqual(answer.params.result, { action: 'decline' });
});

test('an aborted run cancels the form instead of leaving it on screen', async () => {
  const harness = await createHarness();
  const runDone = harness.run();

  const permission = await waitFor(() => byKind(harness.messages, 'permission_request')[0]);
  assert.equal(await codexRuntime.abort(SESSION_ID), true);

  await runDone;

  assert.equal(
    harness.messages.some(
      (message) => message.kind === 'permission_cancelled'
        && message.requestId === permission.requestId
        && message.reason === 'aborted',
    ),
    true,
  );
  assert.equal(codexRuntime.permissions.listPending(SESSION_ID).length, 0);
});

test('an unattended run declines at once instead of waiting on nobody', async () => {
  const harness = await createHarness();
  await harness.run({ unattended: true });

  assert.equal(byKind(harness.messages, 'permission_request').length, 0);

  const answer = await waitFor(() => answerFor(harness));
  assert.deepEqual(answer.params.result, { action: 'decline' });
});

test('a full-access thread runs on-request, so an MCP form can reach the client', async () => {
  const harness = await createHarness();
  const runDone = harness.run({ permissionMode: 'bypassPermissions' });

  // `never` makes Codex answer the elicitation itself; only `on-request` puts
  // it on the wire, which is why full access must not translate to `never`.
  const permission = await waitFor(() => byKind(harness.messages, 'permission_request')[0]);
  const threadStart = harness.requests().find((entry) => entry.method === 'thread/start');
  assert.equal(threadStart?.params.approvalPolicy, 'on-request');
  assert.equal(threadStart?.params.sandbox, 'danger-full-access');

  codexRuntime.permissions.resolve(permission.requestId as string, { allow: false });
  await runDone;

  const answer = await waitFor(() => answerFor(harness));
  assert.deepEqual(answer.params.result, { action: 'decline' });
});

test('a full-access thread answers command approvals itself', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'approval';
  const harness = await createHarness();
  await harness.run({ permissionMode: 'bypassPermissions' });

  const answer = await waitFor(() =>
    harness.requests().find((entry) => entry.method === 'item/commandExecution/answer'),
  );
  assert.deepEqual(answer.params.result, { decision: 'accept' });
  // The person was not asked: full access already granted this.
  assert.equal(byKind(harness.messages, 'permission_request').length, 0);
});

test('a default thread still refuses an approval it cannot present', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'approval';
  const harness = await createHarness();
  await harness.run();

  const answer = await waitFor(() =>
    harness.requests().find((entry) => entry.method === 'item/commandExecution/answer'),
  );
  assert.equal((answer.params.error as { code?: number } | undefined)?.code, -32601);
});

test('a full-access thread answers Codex\'s MCP tool approval itself, then shows the form', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'elicit-approval';
  const harness = await createHarness();
  const runDone = harness.run({ permissionMode: 'bypassPermissions' });

  // The bare confirmation has no fields, so full access accepts it silently.
  const toolApproval = await waitFor(() =>
    harness.requests().find((entry) => entry.method === 'mcpServer/tool-approval/answer'),
  );
  assert.deepEqual(toolApproval.params.result, { action: 'accept' });

  // The server's own form still waits for a person.
  const permission = await waitFor(() => byKind(harness.messages, 'permission_request')[0]);
  assert.equal((permission.input as Record<string, unknown>).message, 'This is the form the server itself asked for.');
  assert.equal(byKind(harness.messages, 'permission_request').length, 1);

  codexRuntime.permissions.resolve(permission.requestId as string, {
    allow: true,
    updatedInput: { content: { name: '亮' } },
  });
  await runDone;

  const answer = await waitFor(() => answerFor(harness));
  assert.deepEqual(answer.params.result, { action: 'accept', content: { name: '亮' } });
});

test('a default thread asks the person about the MCP tool approval too', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'elicit-approval';
  const harness = await createHarness();
  const runDone = harness.run();

  // Without full access nothing answers for the person: the tool approval is
  // itself a form-shaped request, and refusing it would hide the server's form.
  const toolApproval = await waitFor(() => byKind(harness.messages, 'permission_request')[0]);
  assert.equal(toolApproval.toolName, 'McpElicitation');
  const approvalInput = toolApproval.input as Record<string, unknown>;
  // The panel writes this sentence itself, so the kind and the tool name must
  // survive the trip rather than leaving a hard-coded English message to show.
  assert.equal(approvalInput.approvalKind, 'mcp_tool_call');
  assert.equal(approvalInput.toolName, 'ask_me');
  codexRuntime.permissions.resolve(toolApproval.requestId as string, { allow: true, updatedInput: { content: {} } });

  const serverForm = await waitFor(() => byKind(harness.messages, 'permission_request')[1]);
  assert.equal((serverForm.input as Record<string, unknown>).message, 'This is the form the server itself asked for.');
  codexRuntime.permissions.resolve(serverForm.requestId as string, {
    allow: true,
    updatedInput: { content: { name: '亮' } },
  });

  await runDone;

  const toolApprovalAnswer = harness.requests().find((entry) => entry.method === 'mcpServer/tool-approval/answer');
  assert.deepEqual(toolApprovalAnswer?.params.result, { action: 'accept', content: {} });
  const answer = await waitFor(() => answerFor(harness));
  assert.deepEqual(answer.params.result, { action: 'accept', content: { name: '亮' } });
});
