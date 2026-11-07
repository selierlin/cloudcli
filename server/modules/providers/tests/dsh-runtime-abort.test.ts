import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  dshRuntime,
  resetDshRuntimeForTests,
} from '@/modules/providers/list/dsh/dsh-runtime.provider.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

type CapturedMessage = Record<string, any>;

/**
 * Minimal DSH ACP server whose turns hang until cancelled. `session/cancel` is
 * handled as a notification (no reply) and settles that session's pending
 * `session/prompt` with stopReason "cancelled", mirroring a real agent.
 */
const fakeCancelDshServer = `
  let sessionCounter = 0;
  const pendingPrompts = new Map();

  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
  const chunk = (sessionId, text) => send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
    },
  });

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    for (const line of data.split('\\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
      } else if (message.method === 'session/new') {
        sessionCounter += 1;
        send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'acp-' + sessionCounter } });
      } else if (message.method === 'session/prompt') {
        pendingPrompts.set(message.params.sessionId, message.id);
        chunk(message.params.sessionId, '开始');
      } else if (message.method === 'session/cancel') {
        const sessionId = message.params.sessionId;
        const promptId = pendingPrompts.get(sessionId);
        if (promptId !== undefined) {
          pendingPrompts.delete(sessionId);
          send({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } });
        }
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
  throw new Error('Timed out waiting for a DSH runtime message');
}

const isComplete = (message: CapturedMessage): boolean => message.kind === 'complete';

const createFakeDshBinary = (directory: string): void => {
  const serverPath = path.join(directory, 'fake-dsh-cancel-server.mjs');
  fs.writeFileSync(serverPath, fakeCancelDshServer, 'utf8');
  fs.writeFileSync(
    path.join(directory, 'dsh'),
    `#!/bin/sh\nexec "${process.execPath}" "${serverPath}"\n`,
    { mode: 0o755 },
  );
};

let temporaryDirectory: string;
let originalPath: string | undefined;
let originalDshHome: string | undefined;

test.beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-dsh-abort-'));
  originalPath = process.env.PATH;
  originalDshHome = process.env.DSH_HOME;
  createFakeDshBinary(temporaryDirectory);
  process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ''}`;
  process.env.DSH_HOME = temporaryDirectory;
  resetDshRuntimeForTests();
});

test.afterEach(() => {
  resetDshRuntimeForTests();
  process.env.PATH = originalPath;
  process.env.DSH_HOME = originalDshHome;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('abort cancels the in-flight DSH turn and reports an aborted completion', async () => {
  const messages: CapturedMessage[] = [];
  const run = dshRuntime.run(
    'cancel please',
    { sessionId: 'app-session', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(messages),
    createContext(),
  );

  await waitFor(messages, (message) => message.kind === 'text' && message.content === '开始');
  assert.equal(await dshRuntime.abort('app-session'), true);
  await run;

  assert.ok(messages.some((message) => isComplete(message) && message.aborted === true));
});

test('aborting one DSH session leaves another session running on the same ACP child', async () => {
  const keptMessages: CapturedMessage[] = [];
  const stoppedMessages: CapturedMessage[] = [];

  const keptRun = dshRuntime.run(
    'cancel please',
    { sessionId: 'session-kept', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(keptMessages),
    createContext(),
  );
  const stoppedRun = dshRuntime.run(
    'cancel please',
    { sessionId: 'session-stopped', cwd: temporaryDirectory, permissionMode: 'auto' },
    createWriter(stoppedMessages),
    createContext(),
  );

  await waitFor(keptMessages, (message) => message.kind === 'text' && message.content === '开始');
  await waitFor(stoppedMessages, (message) => message.kind === 'text' && message.content === '开始');

  assert.equal(await dshRuntime.abort('session-stopped'), true);
  await stoppedRun;
  assert.ok(stoppedMessages.some((message) => isComplete(message) && message.aborted === true));

  // One ACP child serves both sessions, so a cancel must settle only its own
  // prompt: the sibling turn is still running.
  assert.equal(
    keptMessages.some(isComplete),
    false,
    'aborting one session must not end another session on the same connection',
  );

  assert.equal(await dshRuntime.abort('session-kept'), true);
  await keptRun;
  assert.ok(keptMessages.some((message) => isComplete(message) && message.aborted === true));
});
