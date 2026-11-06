import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { dshRuntime, resetDshRuntimeForTests } from '@/modules/providers/list/dsh/dsh-runtime.provider.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

type CapturedMessage = Record<string, any>;

/**
 * Minimal DSH ACP server that models the session table of a real child: it
 * hands out ids from `session/new`, accepts `session/resume` once per id, and
 * rejects an id it is already serving the way DSH does. The prompt echoes the
 * session id it ran under, so a test can tell which conversation was driven.
 */
const fakeResumeDshServer = `
  let created = 0;
  const serving = new Set();
  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    for (const line of chunk.split('\\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const params = message.params ?? {};
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
      } else if (message.method === 'session/new') {
        created += 1;
        const sessionId = 'acp-' + created;
        serving.add(sessionId);
        send({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
      } else if (message.method === 'session/resume') {
        // Delayed so two concurrent runs definitely overlap while resuming.
        setTimeout(() => {
          const sessionId = params.sessionId;
          if (serving.has(sessionId)) {
            send({ jsonrpc: '2.0', id: message.id, error: { message: 'session is already active: ' + sessionId } });
          } else if (sessionId.startsWith('missing-')) {
            send({ jsonrpc: '2.0', id: message.id, error: { message: 'session is not resumable: ' + sessionId } });
          } else {
            serving.add(sessionId);
            send({ jsonrpc: '2.0', id: message.id, result: { configOptions: [] } });
          }
        }, 150);
      } else if (message.method === 'session/close') {
        const sessionId = params.sessionId;
        if (!serving.has(sessionId)) {
          send({ jsonrpc: '2.0', id: message.id, error: { message: 'unknown session: ' + sessionId } });
        } else {
          serving.delete(sessionId);
          send({ jsonrpc: '2.0', id: message.id, result: {} });
        }
      } else if (message.method === 'session/prompt') {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              messageId: 'msg-1',
              content: { type: 'text', text: 'prompt:' + params.sessionId },
            },
          },
        });
        send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      }
    }
  });
`;

const createFakeDshBinary = (directory: string): void => {
  const serverPath = path.join(directory, 'fake-dsh-resume-server.mjs');
  fs.writeFileSync(serverPath, fakeResumeDshServer, 'utf8');
  fs.writeFileSync(path.join(directory, 'dsh'), `#!/bin/sh\nexec "${process.execPath}" "${serverPath}"\n`, {
    mode: 0o755,
  });
};

const createContext = (resolveProviderSessionId: () => string | null): ProviderRuntimeContext => ({
  resolveProviderSessionId,
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

const withFakeDsh = (t: TestContext): string => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-dsh-resume-'));
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
  return temporaryDirectory;
};

/** Runs one turn and returns the captured messages. */
const runTurn = async (
  cwd: string,
  resolveProviderSessionId: () => string | null,
): Promise<CapturedMessage[]> => {
  const messages: CapturedMessage[] = [];
  await dshRuntime.run('hello', { sessionId: 'app-session', cwd }, createWriter(messages), createContext(resolveProviderSessionId));
  return messages;
};

/** The session id the fake harness actually prompted, or `null` when it never ran a turn. */
const promptedSession = (messages: CapturedMessage[]): string | null => {
  const reply = messages.find((message) => typeof message.content === 'string' && message.content.startsWith('prompt:'));
  return reply ? String(reply.content).slice('prompt:'.length) : null;
};

test.beforeEach(() => {
  resetDshRuntimeForTests();
});

test.afterEach(() => {
  resetDshRuntimeForTests();
});

test('creates a session when the app session has no provider session yet', async (t) => {
  const temporaryDirectory = withFakeDsh(t);

  const messages = await runTurn(temporaryDirectory, () => null);

  assert.equal(promptedSession(messages), 'acp-1');
  assert.ok(messages.some((message) => message.kind === 'session_created' && message.newSessionId === 'acp-1'));
});

test('resumes a persisted session after the ACP child restarted', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  await runTurn(temporaryDirectory, () => null);

  // A new child has an empty in-memory session table, exactly like the real
  // one after a crash or a CloudCLI restart.
  resetDshRuntimeForTests();

  const messages = await runTurn(temporaryDirectory, () => 'acp-1');

  assert.equal(promptedSession(messages), 'acp-1', 'the turn must continue the persisted conversation');
  assert.equal(
    messages.some((message) => message.kind === 'session_created'),
    false,
    'resuming must not announce a new provider session',
  );
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === true));
});

test('does not resume a session the current child is already serving', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  await runTurn(temporaryDirectory, () => null);

  // The synchronizer writes the provider id back onto the row after the first
  // turn; re-resuming it would make DSH answer "session is already active".
  const messages = await runTurn(temporaryDirectory, () => 'acp-1');

  assert.equal(promptedSession(messages), 'acp-1');
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === true));
});

test('follows the database when an edit repoints it to a derived session', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  await runTurn(temporaryDirectory, () => null);

  // Editing a message rewrites the row to a derived provider session while the
  // cached mapping still names the pre-edit conversation.
  const messages = await runTurn(temporaryDirectory, () => 'derived-1');

  assert.equal(promptedSession(messages), 'derived-1', 'the turn must run on the repointed session');
});

test('starts a fresh session when the row was detached', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  await runTurn(temporaryDirectory, () => null);

  // Editing the first message detaches the row; the cached mapping must not
  // drag the abandoned conversation into the new one.
  const messages = await runTurn(temporaryDirectory, () => null);

  assert.equal(promptedSession(messages), 'acp-2');
});

test('shares one resume between concurrent runs of the same persisted session', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  const first: CapturedMessage[] = [];
  const second: CapturedMessage[] = [];

  await Promise.all([
    dshRuntime.run('hello', { sessionId: 'app-a', cwd: temporaryDirectory }, createWriter(first), createContext(() => 'shared-1')),
    dshRuntime.run('hello', { sessionId: 'app-b', cwd: temporaryDirectory }, createWriter(second), createContext(() => 'shared-1')),
  ]);

  for (const messages of [first, second]) {
    const error = messages.find((message) => message.kind === 'error');
    // The second run may be rejected because the harness is busy, but it must
    // never fail because the same session was resumed twice.
    assert.doesNotMatch(String(error?.content ?? ''), /already active/);
  }
  assert.ok(promptedSession(first) ?? promptedSession(second), 'the shared session must run at least one turn');
});

test('fails the turn with the resume error when the persisted session is gone', async (t) => {
  const temporaryDirectory = withFakeDsh(t);

  const messages = await runTurn(temporaryDirectory, () => 'missing-1');

  const error = messages.find((message) => message.kind === 'error');
  assert.match(String(error?.content), /Could not resume DSH session missing-1/);
  assert.equal(promptedSession(messages), null, 'the turn must not reach the harness');
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === false));
});

test('disposeSession releases the conversation so the next run can resume it again', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  await runTurn(temporaryDirectory, () => null);

  // Closing removes the session from the child's table, exactly like deleting
  // a btw copy; the local tables must forget it too, or the next run would
  // prompt a session the child no longer serves.
  await dshRuntime.disposeSession?.('app-session');

  const messages = await runTurn(temporaryDirectory, () => 'acp-1');

  assert.equal(promptedSession(messages), 'acp-1');
  assert.equal(messages.some((message) => message.kind === 'error'), false);
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === true));
});

test('disposeSession treats an id the child never served as already released', async (t) => {
  withFakeDsh(t);
  // Starting the child is not required; an id it does not know is not a failure.
  await assert.doesNotReject(async () => {
    await dshRuntime.disposeSession?.('never-opened');
  });
});
