import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dshRuntime, resetDshRuntimeForTests } from '@/modules/providers/list/dsh/dsh-runtime.provider.js';
import { DshSessionsProvider } from '@/modules/providers/list/dsh/dsh-sessions.provider.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

type CapturedMessage = Record<string, any>;

/** Minimal JSON-RPC DSH ACP server that asks for permission during a prompt. */
const fakeDshServer = `
  let nextId = 0;
  let promptId = null;
  let permissionId = null;

  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    for (const line of chunk.split('\\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
      } else if (message.method === 'session/new') {
        send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-session' } });
      } else if (message.method === 'session/prompt') {
        promptId = message.id;
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session',
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'tool-1',
              title: 'bash',
              rawInput: { command: 'touch outside-workspace' },
            },
          },
        });
        permissionId = ++nextId;
        send({
          jsonrpc: '2.0',
          id: permissionId,
          method: 'session/request_permission',
          params: {
            sessionId: 'acp-session',
            toolCall: { toolCallId: 'tool-1' },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          },
        });
      } else if (message.id === permissionId) {
        const outcome = message.result.outcome;
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'permission:' + outcome.outcome + ':' + (outcome.optionId || '') },
            },
          },
        });
        send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } });
        permissionId = null;
      }
    }
  });
`;

const createContext = (): ProviderRuntimeContext => ({
  resolveProviderSessionId: () => null,
  resolveProviderConfigDir: () => null,
  resolveSettingsFile: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'model' }),
  normalizeMessage: (raw, sessionId) => {
    const event = raw as { content?: string };
    return [createNormalizedMessage({
      kind: 'text',
      role: 'assistant',
      content: event.content ?? '',
      sessionId,
      provider: 'dsh',
    })];
  },
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

const waitForPermissionRequest = async (messages: CapturedMessage[]): Promise<CapturedMessage> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const request = messages.find((message) => message.kind === 'permission_request');
    if (request) {
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for a DSH permission request');
};

const createFakeDshBinary = (directory: string): string => {
  const serverPath = path.join(directory, 'fake-dsh-server.mjs');
  const binaryPath = path.join(directory, 'dsh');
  fs.writeFileSync(serverPath, fakeDshServer, 'utf8');
  fs.writeFileSync(binaryPath, `#!/bin/sh\nexec "${process.execPath}" "${serverPath}"\n`, { mode: 0o755 });
  return binaryPath;
};

/**
 * Minimal DSH ACP server that streams one reply as two `agent_message_chunk`
 * updates sharing a `messageId`. Chunks are deltas the runtime is expected to
 * accumulate into the message's full-text snapshot and forward with the id.
 * Used to pin the ACP → runtime → normalize wiring end to end; feeding
 * `normalizeMessage` directly cannot catch a payload dropped between the ACP
 * callback and the normalize call.
 */
const fakeSnapshotDshServer = `
  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    for (const line of chunk.split('\\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
      } else if (message.method === 'session/new') {
        send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-session' } });
      } else if (message.method === 'session/prompt') {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session',
            update: {
              sessionUpdate: 'agent_message_chunk',
              messageId: 'msg-9',
              content: { type: 'text', text: '第一段' },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session',
            update: {
              sessionUpdate: 'agent_message_chunk',
              messageId: 'msg-9',
              content: { type: 'text', text: '第二段' },
            },
          },
        });
        send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      }
    }
  });
`;

const createSnapshotFakeDshBinary = (directory: string): string => {
  const serverPath = path.join(directory, 'fake-dsh-snapshot-server.mjs');
  const binaryPath = path.join(directory, 'dsh');
  fs.writeFileSync(serverPath, fakeSnapshotDshServer, 'utf8');
  fs.writeFileSync(binaryPath, `#!/bin/sh\nexec "${process.execPath}" "${serverPath}"\n`, { mode: 0o755 });
  return binaryPath;
};

test.beforeEach(() => {
  resetDshRuntimeForTests();
});

test.afterEach(() => {
  resetDshRuntimeForTests();
});

test('default mode surfaces a DSH permission request and forwards the user decision', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-dsh-permission-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  const originalDshHome = process.env.DSH_HOME;
  createFakeDshBinary(temporaryDirectory);
  process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ''}`;
  process.env.DSH_HOME = temporaryDirectory;
  t.after(() => {
    process.env.PATH = originalPath;
    process.env.DSH_HOME = originalDshHome;
  });

  const messages: CapturedMessage[] = [];
  const run = dshRuntime.run(
    'touch outside-workspace',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'default' },
    createWriter(messages),
    createContext(),
  );

  const request = await waitForPermissionRequest(messages);
  assert.equal(request.toolName, 'bash');
  assert.deepEqual(request.input, { command: 'touch outside-workspace' });
  assert.equal(dshRuntime.permissions?.listPending('app-session').length, 1);

  dshRuntime.permissions?.resolve(request.requestId, { allow: false });
  await run;

  assert.ok(messages.some((message) => message.kind === 'permission_resolved'));
  assert.ok(messages.some((message) => message.content === 'permission:selected:reject-once'));
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === true));
});

test('auto mode answers DSH permission requests with allow-once without prompting', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-dsh-auto-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  const originalDshHome = process.env.DSH_HOME;
  createFakeDshBinary(temporaryDirectory);
  process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ''}`;
  process.env.DSH_HOME = temporaryDirectory;
  t.after(() => {
    process.env.PATH = originalPath;
    process.env.DSH_HOME = originalDshHome;
  });

  const messages: CapturedMessage[] = [];
  await dshRuntime.run(
    'touch outside-workspace',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    createContext(),
  );

  assert.equal(messages.some((message) => message.kind === 'permission_request'), false);
  assert.ok(messages.some((message) => message.content === 'permission:selected:allow-once'));
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === true));
});

test('forwards the ACP messageId through runtime accumulation into the normalized upsert id', async (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-dsh-snapshot-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  const originalDshHome = process.env.DSH_HOME;
  createSnapshotFakeDshBinary(temporaryDirectory);
  process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ''}`;
  process.env.DSH_HOME = temporaryDirectory;
  t.after(() => {
    process.env.PATH = originalPath;
    process.env.DSH_HOME = originalDshHome;
  });

  // Wire the runtime to the real `DshSessionsProvider.normalizeMessage` so the
  // test covers the full ACP → payload → normalize chain, not just normalize.
  const sessionsProvider = new DshSessionsProvider();
  const context: ProviderRuntimeContext = {
    ...createContext(),
    normalizeMessage: (raw, sessionId) => sessionsProvider.normalizeMessage(raw, sessionId),
  };

  const messages: CapturedMessage[] = [];
  await dshRuntime.run(
    '随便说点什么',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    context,
  );

  const replies = messages.filter((message) => message.kind === 'text' && message.role === 'assistant');
  assert.ok(replies.length >= 2, 'both snapshots must reach the writer');
  for (const reply of replies) {
    assert.equal(reply.id, 'msg-9', 'every snapshot of one message shares the stable upsert id');
  }
  assert.equal(replies[replies.length - 1].content, '第一段第二段', 'the accumulated snapshot lands complete');
});
