import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import {
  isCodexNotificationForActiveTurn,
  startCodexAppServerConnection,
} from '@/modules/providers/list/codex/codex-app-server.client.js';

/**
 * The connection is exercised against a fake `codex app-server` process rather
 * than the real CLI: these assertions are about the transport (frame routing,
 * lifecycle, timeouts), not about the conversation behind it, and the real
 * binary is driven end-to-end elsewhere.
 */
const MOCK_SERVER = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex-app-server-mock.mjs'),
);

type ObservedNotification = { method: string; params: unknown };
type Frame = { id?: number; result?: unknown; error?: { code?: number; message?: string } };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `read` until it returns a value, so assertions do not race the process. */
async function waitFor<T>(read: () => T | undefined, timeoutMs = 2_000): Promise<T> {
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

function observe(connection: Awaited<ReturnType<typeof startCodexAppServerConnection>>): ObservedNotification[] {
  const notifications: ObservedNotification[] = [];
  connection.onNotification((method, params) => notifications.push({ method, params }));
  return notifications;
}

/**
 * The frame the mock echoed back for a given id. The mock echoes every frame it
 * receives that is not an answer to a request of its own (the `initialized`
 * notification, and replies to its reverse request), so the match is by id
 * rather than by position.
 */
function echoFor(notifications: ObservedNotification[], id: number): Frame | undefined {
  for (const entry of notifications) {
    if (entry.method !== 'mock/observed') {
      continue;
    }
    const frame = (entry.params as { frame?: Frame } | undefined)?.frame;
    if (frame?.id === id) {
      return frame;
    }
  }
  return undefined;
}

beforeEach(() => {
  process.env.CODEX_APP_SERVER_COMMAND = MOCK_SERVER;
  delete process.env.CODEX_MOCK_MODE;
  delete process.env.CODEX_MOCK_HANG_METHOD;
});

afterEach(() => {
  delete process.env.CODEX_APP_SERVER_COMMAND;
  delete process.env.CODEX_MOCK_MODE;
  delete process.env.CODEX_MOCK_HANG_METHOD;
});

test('the handshake completes despite a non-JSON banner, and stop() ends the process', async () => {
  process.env.CODEX_MOCK_MODE = 'banner';
  const connection = await startCodexAppServerConnection();

  const pid = connection.pid;
  assert.equal(typeof pid, 'number');
  // stderr is captured for diagnosing a process that dies.
  assert.match(connection.stderrTail, /mock stderr/);

  await connection.stop();
  await waitFor(() => {
    try {
      process.kill(pid as number, 0);
      return undefined;
    } catch {
      return true;
    }
  }, 3_000);
});

test('routes replies, notifications and reverse requests by frame shape', async () => {
  process.env.CODEX_MOCK_MODE = 'scripted';
  const connection = await startCodexAppServerConnection();
  const notifications = observe(connection);

  const started = await connection.request('thread/start', {}) as { thread?: { id?: string } };
  assert.equal(started.thread?.id, 'mock-thread-1');

  await connection.request('turn/start', { threadId: 'mock-thread-1' });

  const delta = await waitFor(() => notifications.find((entry) => entry.method === 'item/agentMessage/delta'));
  assert.equal((delta.params as { delta?: string }).delta, 'hello');

  // No server-request handler is registered, so the connection must refuse the
  // reverse request; the mock echoes that refusal back for the assertion.
  const refusal = await waitFor(() => echoFor(notifications, 900));
  assert.equal(refusal.error?.code, -32601);

  await connection.stop();
});

test('a registered server-request handler answers reverse requests', async () => {
  process.env.CODEX_MOCK_MODE = 'scripted';
  const connection = await startCodexAppServerConnection();
  const notifications = observe(connection);
  const seen: Array<{ id: number; method: string }> = [];
  connection.onServerRequest((id, method) => {
    seen.push({ id, method });
    connection.respond(id, { decision: 'decline' });
  });

  await connection.request('turn/start', {});

  const request = await waitFor(() => seen[0]);
  assert.equal(request.method, 'item/commandExecution/requestApproval');
  const answer = await waitFor(() => echoFor(notifications, request.id));
  assert.deepEqual(answer.result, { decision: 'decline' });

  await connection.stop();
});

test('notifications for another thread or turn are dropped', () => {
  const active = { threadId: 't1', turnId: 'turn1' };
  assert.equal(isCodexNotificationForActiveTurn({ threadId: 't1', turnId: 'turn1' }, active), true);
  assert.equal(isCodexNotificationForActiveTurn({ threadId: 't2', turnId: 'turn1' }, active), false);
  assert.equal(isCodexNotificationForActiveTurn({ threadId: 't1', turnId: 'turn0' }, active), false);
  // Frames that name no turn, or no ids at all, are kept.
  assert.equal(isCodexNotificationForActiveTurn({ threadId: 't1' }, active), true);
  assert.equal(isCodexNotificationForActiveTurn({}, active), true);
  assert.equal(isCodexNotificationForActiveTurn(null, active), true);
  // Before the thread is known there is nothing to filter against.
  assert.equal(isCodexNotificationForActiveTurn({ threadId: 't2' }, {}), true);
});

test('a request that is never answered times out', async () => {
  process.env.CODEX_MOCK_MODE = 'hang';
  process.env.CODEX_MOCK_HANG_METHOD = 'thread/start';
  const connection = await startCodexAppServerConnection();

  await assert.rejects(connection.request('thread/start', {}, 150), /did not answer/);

  await connection.stop();
});

test('a pending request fails when the process exits', async () => {
  process.env.CODEX_MOCK_MODE = 'exit-on-turn';
  const connection = await startCodexAppServerConnection();
  let exitReason = '';
  connection.onExit((reason) => {
    exitReason = reason;
  });

  await assert.rejects(connection.request('turn/start', {}), /exited/);
  await waitFor(() => (exitReason || undefined));
  assert.match(exitReason, /exited/);

  await connection.stop();
});

test('stop() force-kills a process that ignores SIGTERM', async () => {
  process.env.CODEX_MOCK_MODE = 'ignore-sigterm';
  const connection = await startCodexAppServerConnection();
  const pid = connection.pid as number;

  await connection.stop();

  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return undefined;
    } catch {
      return true;
    }
  }, 5_000);
});
