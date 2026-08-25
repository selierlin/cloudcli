import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { beforeEach } from 'node:test';

import { workbuddyRuntime, resetWorkbuddyRuntimeForTests } from '@/modules/providers/list/workbuddy/workbuddy-runtime.provider.js';
import { WorkbuddySessionsProvider } from '@/modules/providers/list/workbuddy/workbuddy-sessions.provider.js';
import { resetWorkbuddyCommandForTests } from '@/modules/providers/list/workbuddy/workbuddy-auth.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wb-mock-cli.mjs'),
);

type Captured = { kind: string; role?: string; content?: unknown; newSessionId?: string; exitCode?: number; aborted?: boolean };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The runtime inherits the parent env and only overrides the config-dir vars
// when a session config dir is resolved. Developers' shells often export
// CODEBUDDY_CONFIG_DIR/WORKBUDDY_CONFIG_DIR, which would otherwise leak into
// the spawned mock CLI and corrupt the CFG suffix assertions. The command
// resolution cache is cleared too so each test re-resolves CODEBUDDY_COMMAND.
beforeEach(() => {
  delete process.env.CODEBUDDY_CONFIG_DIR;
  delete process.env.WORKBUDDY_CONFIG_DIR;
  resetWorkbuddyCommandForTests();
});

function makeContext(
  providerSessionIds: Map<string, string | null>,
  configDir?: string,
  resumeModel?: string,
): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: (sessionId) => providerSessionIds.get(sessionId ?? '') ?? null,
    resolveProviderConfigDir: (sessionId) => (sessionId && configDir ? configDir : null),
    resolveResumeModel: async () => resumeModel,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'auto' }),
    normalizeMessage: (raw, sessionId) => new WorkbuddySessionsProvider().normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
}

function makeWriter(captured: Captured[]): ProviderRuntimeWriter {
  return {
    send(message: any) {
      captured.push({
        kind: message.kind,
        role: message.role,
        content: message.content,
        newSessionId: message.newSessionId,
        exitCode: message.exitCode,
        aborted: message.aborted,
      });
    },
    userId: null,
  };
}

test('workbuddy run drives a new session and emits thinking/text/complete', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];
  const context = makeContext(new Map());

  await workbuddyRuntime.run(
    'hello',
    { sessionId: 'wb-test-1', cwd: '/tmp' },
    makeWriter(captured),
    context,
  );

  const kinds = captured.map((entry) => entry.kind);
  assert.ok(kinds.includes('session_created'), `kinds: ${kinds.join(',')}`);
  assert.ok(kinds.includes('thinking'), `kinds: ${kinds.join(',')}`);
  assert.ok(kinds.includes('text'), `kinds: ${kinds.join(',')}`);
  assert.ok(kinds.includes('complete'), `kinds: ${kinds.join(',')}`);

  const sessionCreated = captured.find((entry) => entry.kind === 'session_created');
  assert.equal(sessionCreated?.newSessionId, 'mock-session-123');

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'OK:hello:perm=none');

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
});

test('workbuddy run resumes an existing session id', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];
  const providerSessionIds = new Map<string, string | null>([
    ['wb-test-2', 'previous-session-id'],
  ]);

  await workbuddyRuntime.run(
    'continue work',
    { sessionId: 'wb-test-2', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(providerSessionIds),
  );

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'RESUMED:previous-session-id:continue work');
  // A resumed session must not announce a fresh session id.
  assert.equal(captured.some((entry) => entry.kind === 'session_created'), false);
});

test('workbuddy run sends image and file attachments as stream-json stdin', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wb-attach-'));
  const imagePath = path.join(tempDir, 'photo.png');
  const filePath = path.join(tempDir, 'notes.txt');
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  await writeFile(filePath, 'hello file');

  try {
    await workbuddyRuntime.run(
      'look at this',
      {
        sessionId: 'wb-attach',
        cwd: tempDir,
        attachments: [
          { path: imagePath, name: 'photo.png', mimeType: 'image/png' },
          { path: filePath, name: 'notes.txt' },
        ],
      },
      makeWriter(captured),
      makeContext(new Map()),
    );

    // The mock echoes the prompt plus a count of the stdin content blocks, so
    // this asserts the runtime switched to stream-json and serialized one
    // image block and one document block.
    const text = captured.find((entry) => entry.kind === 'text');
    assert.equal(text?.content, 'OK:look at this:perm=none STDIN:1img:1file');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('workbuddy run keeps attachments working when resuming a session', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];
  const providerSessionIds = new Map<string, string | null>([
    ['wb-attach-resume', 'previous-session-id'],
  ]);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wb-attach-resume-'));
  const imagePath = path.join(tempDir, 'photo.png');
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));

  try {
    await workbuddyRuntime.run(
      'still looking',
      {
        sessionId: 'wb-attach-resume',
        cwd: tempDir,
        attachments: [{ path: imagePath, name: 'photo.png', mimeType: 'image/png' }],
      },
      makeWriter(captured),
      makeContext(providerSessionIds),
    );

    const text = captured.find((entry) => entry.kind === 'text');
    assert.equal(text?.content, 'RESUMED:previous-session-id:still looking STDIN:1img:0file');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('workbuddy run forwards the permission mode flag', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'edit the file',
    { sessionId: 'wb-test-3', cwd: '/tmp', permissionMode: 'acceptEdits' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'OK:edit the file:perm=acceptEdits');
});

test('workbuddy run forwards the selected model to a new session', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'hello',
    { sessionId: 'wb-model-new', cwd: '/tmp', model: 'glm-5.1' },
    makeWriter(captured),
    makeContext(new Map(), undefined, 'glm-5.1'),
  );

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'OK:hello:perm=none MODEL:glm-5.1');
});

test('workbuddy run forwards the recorded model when resuming a session', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];
  const providerSessionIds = new Map<string, string | null>([
    ['wb-model-resume', 'previous-session-id'],
  ]);

  await workbuddyRuntime.run(
    'continue work',
    { sessionId: 'wb-model-resume', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(providerSessionIds, undefined, 'glm-4.7'),
  );

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'RESUMED:previous-session-id:continue work MODEL:glm-4.7');
});

test('workbuddy run reports a failed task with exit code 1', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'error';
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'do the impossible',
    { sessionId: 'wb-test-4', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
});

test('workbuddy run surfaces a fatal engine error event to the frontend', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'error-event';
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'continue work',
    { sessionId: 'wb-error-event', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const error = captured.find((entry) => entry.kind === 'error');
  assert.equal(error?.content, 'No conversation found with session ID: mock-session');

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
});

test('workbuddy run points the engine at the session config dir', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'hello',
    { sessionId: 'wb-cfg-test', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map(), '/Users/test/.workbuddy'),
  );

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'OK:hello:perm=none CFG:/Users/test/.workbuddy');
});

test('workbuddy run flushes a final event that lacks a trailing newline', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'no-trailing-newline';
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'no trailing newline',
    { sessionId: 'wb-nonl', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const text = captured.find((entry) => entry.kind === 'text');
  assert.equal(text?.content, 'final line without newline');

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
});

test('workbuddy run without a session id completes immediately with exit code 1', async () => {
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'orphan prompt',
    { cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  assert.deepEqual(captured.map((entry) => entry.kind), ['complete']);
  assert.equal(captured[0]?.exitCode, 1);
});

test('workbuddy abort of an unknown session returns false', async () => {
  assert.equal(await workbuddyRuntime.abort('no-such-session'), false);
});

test('workbuddy abort kills a running process and reports an aborted complete', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'hang';
  const captured: Captured[] = [];

  const runPromise = workbuddyRuntime.run(
    'hang forever',
    { sessionId: 'wb-abort', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map()),
  );
  // Give the mock CLI time to spawn before aborting it.
  await sleep(150);

  assert.equal(await workbuddyRuntime.abort('wb-abort'), true);
  await runPromise;

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
  assert.equal(complete?.aborted, true);
});

test('workbuddy run reports a spawn failure as exit code 1', async () => {
  resetWorkbuddyCommandForTests();
  process.env.CODEBUDDY_COMMAND = path.join('/nonexistent', 'codebuddy-missing');
  const captured: Captured[] = [];

  await workbuddyRuntime.run(
    'cannot spawn',
    { sessionId: 'wb-spawn-fail', cwd: '/tmp' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);

  resetWorkbuddyCommandForTests();
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;
  resetWorkbuddyRuntimeForTests();
});

test('workbuddy normalizeMessage ignores non-assistant events', () => {
  const provider = new WorkbuddySessionsProvider();

  assert.deepEqual(provider.normalizeMessage({ type: 'result', subtype: 'success' }, 's'), []);
  assert.deepEqual(provider.normalizeMessage(null, 's'), []);
});

test('workbuddy normalizeMessage converts thinking and text blocks only', () => {
  const provider = new WorkbuddySessionsProvider();
  const event = {
    type: 'assistant',
    session_id: 'mock-session-123',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '  ' },
        { type: 'thinking', thinking: 'real thought' },
        { type: 'text', text: 'hello world' },
        { type: 'tool_use', name: 'Bash' },
        { type: 'text', text: '' },
      ],
    },
  };

  const messages = provider.normalizeMessage(event, 'app-session');

  assert.deepEqual(messages.map((message) => message.kind), ['thinking', 'text']);
  assert.equal(messages[0]?.content, 'real thought');
  assert.equal(messages[0]?.provider, 'workbuddy');
  assert.equal(messages[1]?.content, 'hello world');
  assert.equal(messages[1]?.sessionId, 'app-session');
});
