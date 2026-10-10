import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { resetOpenclawCommandForTests } from '@/modules/providers/list/openclaw/openclaw-auth.provider.js';
import {
  openclawRuntime,
  resetOpenclawRuntimeForTests,
} from '@/modules/providers/list/openclaw/openclaw-runtime.provider.js';
import { OpenclawSessionsProvider } from '@/modules/providers/list/openclaw/openclaw-sessions.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

type CapturedMessage = Record<string, any>;

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Writes a fake `openclaw` binary that execs the ACP mock, and returns its path. */
function createFakeOpenclawBinary(directory: string): string {
  const mockPath = path.join(FIXTURES_DIR, 'openclaw-acp-mock.mjs');
  const binaryPath = path.join(directory, 'openclaw');
  fs.writeFileSync(
    binaryPath,
    `#!/bin/sh\nexec "${process.execPath}" "${mockPath}" "$@"\n`,
    { mode: 0o755 },
  );
  return binaryPath;
}

const sessionsProvider = new OpenclawSessionsProvider();

const createContext = (providerSessionId: string | null = null): ProviderRuntimeContext => ({
  resolveProviderSessionId: () => providerSessionId,
  resolveProviderConfigDir: () => null,
  resolveSettingsFile: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'openclaw/default' }),
  normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
  async isProviderInstalled() {
    return true;
  },
});

const createWriter = (messages: CapturedMessage[]): ProviderRuntimeWriter => ({
  userId: null,
  send: (message) => {
    messages.push(message as CapturedMessage);
  },
});

async function waitFor(
  messages: CapturedMessage[],
  predicate: (message: CapturedMessage) => boolean,
): Promise<CapturedMessage> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = messages.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for an OpenClaw runtime message');
}

const isComplete = (message: CapturedMessage): boolean => message.kind === 'complete';

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-openclaw-'));
  const binary = createFakeOpenclawBinary(temporaryDirectory);
  process.env.OPENCLAW_COMMAND = binary;
  process.env.OPENCLAW_STATE_DIR = temporaryDirectory;
  resetOpenclawCommandForTests();
  resetOpenclawRuntimeForTests();
});

afterEach(() => {
  resetOpenclawRuntimeForTests();
  resetOpenclawCommandForTests();
  delete process.env.OPENCLAW_COMMAND;
  delete process.env.OPENCLAW_STATE_DIR;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('streams accumulated chunks with a stable id and announces a fresh session key', async () => {
  const messages: CapturedMessage[] = [];
  await openclawRuntime.run(
    '你好',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'default' },
    createWriter(messages),
    createContext(null),
  );

  const created = messages.find((message) => message.kind === 'session_created');
  assert.ok(created, 'a new session must announce its OpenClaw session key');
  assert.match(String(created.newSessionId), /^agent:main:[0-9a-f]{12}$/);

  const replies = messages.filter((message) => message.kind === 'text' && message.role === 'assistant');
  assert.ok(replies.length >= 2, 'both snapshots must reach the writer');
  for (const reply of replies) {
    assert.equal(reply.id, replies[0].id, 'every chunk of one segment shares the stable upsert id');
  }
  assert.equal(replies[replies.length - 1].content, '第一段第二段', 'the accumulated snapshot lands complete');
  assert.ok(messages.some((message) => isComplete(message) && message.success === true));
});

test('a resumed session re-attaches to its stored key without announcing a new one', async () => {
  const messages: CapturedMessage[] = [];
  await openclawRuntime.run(
    '你好',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'default' },
    createWriter(messages),
    createContext('agent:main:main'),
  );

  assert.equal(messages.some((message) => message.kind === 'session_created'), false);
  assert.ok(messages.some((message) => message.kind === 'text' && message.content === '第一段第二段'));
});

test('maps tool calls and their results to tool_use and tool_result rows', async () => {
  const messages: CapturedMessage[] = [];
  await openclawRuntime.run(
    '用 tool 做事',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    createContext('agent:main:main'),
  );

  const toolUse = messages.find((message) => message.kind === 'tool_use');
  assert.ok(toolUse);
  assert.equal(toolUse.toolName, 'bash');
  assert.deepEqual(toolUse.toolInput, { command: 'ls' });

  const toolResult = messages.find((message) => message.kind === 'tool_result');
  assert.ok(toolResult);
  assert.equal(toolResult.content, 'file-a\nfile-b');
  assert.equal(toolResult.isError, false);

  // The reply text after the tool call starts a fresh segment.
  assert.ok(messages.some((message) => message.kind === 'text' && message.content === '工具完成'));
});

test('maps thought chunks to thinking rows', async () => {
  const messages: CapturedMessage[] = [];
  await openclawRuntime.run(
    '想一下 think',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    createContext('agent:main:main'),
  );

  const thinking = messages.filter((message) => message.kind === 'thinking');
  assert.ok(thinking.length >= 2);
  assert.equal(thinking[thinking.length - 1].content, '想想…');
  assert.ok(messages.some((message) => message.kind === 'text' && message.content === '答案'));
});

test('default mode surfaces a permission request and forwards the user decision', async () => {
  const messages: CapturedMessage[] = [];
  const run = openclawRuntime.run(
    '需要一个 permission',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'default' },
    createWriter(messages),
    createContext('agent:main:main'),
  );

  const request = await waitFor(messages, (message) => message.kind === 'permission_request');
  assert.equal(request.toolName, 'bash');
  assert.deepEqual(request.input, { command: 'rm -rf /tmp/x' });
  assert.equal(openclawRuntime.permissions?.listPending('app-session').length, 1);

  openclawRuntime.permissions?.resolve(request.requestId, { allow: false });
  await run;

  assert.ok(messages.some((message) => message.kind === 'permission_resolved'));
  assert.ok(messages.some((message) => message.content === 'perm:selected:deny'));
  assert.ok(messages.some((message) => isComplete(message) && message.success === true));
});

test('auto mode answers permission requests with allow-once without prompting', async () => {
  const messages: CapturedMessage[] = [];
  await openclawRuntime.run(
    '需要一个 permission',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    createContext('agent:main:main'),
  );

  assert.equal(messages.some((message) => message.kind === 'permission_request'), false);
  assert.ok(messages.some((message) => message.content === 'perm:selected:allow-once'));
  assert.ok(messages.some((message) => isComplete(message) && message.success === true));
});

test('abort cancels the in-flight ACP turn and reports an aborted completion', async () => {
  const messages: CapturedMessage[] = [];
  const run = openclawRuntime.run(
    'cancel please',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    createContext('agent:main:main'),
  );

  await waitFor(messages, (message) => message.kind === 'text' && message.content === '开始');
  assert.equal(await openclawRuntime.abort('app-session'), true);
  await run;

  assert.ok(messages.some((message) => isComplete(message) && message.aborted === true));
});
