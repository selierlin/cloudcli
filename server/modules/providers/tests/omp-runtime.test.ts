import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import { resetOmpCommandForTests } from '@/modules/providers/list/omp/omp-auth.provider.js';
import { resetOmpModelsForTests } from '@/modules/providers/list/omp/omp-models.provider.js';
import { OmpSessionsProvider } from '@/modules/providers/list/omp/omp-sessions.provider.js';
import { ompRuntime, resetOmpRuntimeForTests } from '@/modules/providers/list/omp/omp-runtime.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'omp-mock-cli.mjs'),
);

type Captured = {
  kind: string;
  id?: string;
  role?: string;
  provider?: string;
  content?: unknown;
  streamChannel?: string;
  newSessionId?: string;
  exitCode?: number;
  aborted?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  delete process.env.OMP_PROFILE;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  resetOmpCommandForTests();
  resetOmpModelsForTests();
});

afterEach(() => {
  resetOmpRuntimeForTests();
  resetOmpCommandForTests();
  resetOmpModelsForTests();
  delete process.env.OMP_COMMAND;
  delete process.env.MOCK_MODE;
  delete process.env.OMP_MOCK_ARGS_FILE;
  delete process.env.OMP_RUN_TIMEOUT_MS;
});

function makeContext(
  providerSessionIds: Map<string, string | null>,
  resumeModel?: string,
): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: (sessionId) => providerSessionIds.get(sessionId ?? '') ?? null,
    resolveProviderConfigDir: () => null,
    resolveSettingsFile: () => null,
    resolveResumeModel: async () => resumeModel,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'auto' }),
    normalizeMessage: (raw, sessionId) => new OmpSessionsProvider().normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
}

function makeWriter(captured: Captured[]): ProviderRuntimeWriter {
  return {
    send(message: { kind: string; id?: string; role?: string; provider?: string; content?: unknown; streamChannel?: string; newSessionId?: string; exitCode?: number; aborted?: boolean }) {
      captured.push(message);
    },
    userId: 1,
  };
}

/** Captures `console.warn` for the duration of a run so unsupported-event noise is assertable. */
async function withCapturedWarnings(
  run: () => Promise<void>,
): Promise<string[]> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = ((...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  }) as typeof console.warn;
  try {
    await run();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

test('new session announces its id and streams assistant text', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';

  await ompRuntime.run('Say hi', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const kinds = captured.map((entry) => entry.kind);
  // session_created then the normalized assistant rows then a terminal complete.
  assert.ok(kinds.includes('session_created'));
  assert.ok(kinds.includes('thinking'));
  assert.ok(kinds.includes('text'));
  const created = captured.find((entry) => entry.kind === 'session_created');
  assert.equal(created?.newSessionId, 'mock-omp-session-uuid');
  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
  // The user echo must not be forwarded.
  assert.equal(captured.filter((entry) => entry.role === 'user' && entry.kind === 'text').length, 0);
});

test('resumed session passes --session and does not re-announce', async () => {
  const captured: Captured[] = [];
  const argsFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'omp-args-')), 'args.json');
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  process.env.OMP_MOCK_ARGS_FILE = argsFile;

  const sessions = new Map<string, string | null>([['app-1', 'existing-uuid']]);
  await ompRuntime.run('Continue', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(sessions, 'ark/deepseek-v4-flash'));

  assert.equal(captured.some((entry) => entry.kind === 'session_created'), false);
  const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
  assert.ok(args.includes('--session'));
  assert.ok(args.includes('existing-uuid'));
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('ark/deepseek-v4-flash'));
  const text = captured.find((entry) => entry.kind === 'text' && entry.role === 'assistant');
  assert.ok(typeof text?.content === 'string');
  assert.ok(text.content.includes('RESUMED:existing-uuid'));
  await rm(path.dirname(argsFile), { recursive: true, force: true });
});

// OMP rejects Pi's `--no-approve` with a usage error and exit 2; headless print
// mode must instead be told to auto-approve so it never blocks on a prompt.
test('always passes --auto-approve and never the rejected Pi flag', async () => {
  const captured: Captured[] = [];
  const argsFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'omp-args-')), 'args.json');
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  process.env.OMP_MOCK_ARGS_FILE = argsFile;

  await ompRuntime.run('Go', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
  assert.ok(args.includes('--auto-approve'));
  assert.equal(args.includes('--no-approve'), false);
  assert.deepEqual(args.slice(0, 3), ['--mode', 'json', '-p']);
  await rm(path.dirname(argsFile), { recursive: true, force: true });
});

// OMP errors out on a tool name it does not ship, so the readonly allowlist has
// to use its own vocabulary (`glob`, not Pi's `find`/`ls`).
test('maps the readonly permission mode onto OMP tool names', async () => {
  const captured: Captured[] = [];
  const argsFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'omp-args-')), 'args.json');
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  process.env.OMP_MOCK_ARGS_FILE = argsFile;

  await ompRuntime.run(
    'Review only',
    { sessionId: 'app-1', projectPath: process.cwd(), permissionMode: 'readonly' },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
  assert.ok(args.includes('--tools'));
  assert.ok(args.includes('read,grep,glob'));
  assert.equal(args.includes('read,grep,find,ls'), false);
  // Read-only still auto-approves; the allowlist is the only safety lever.
  assert.ok(args.includes('--auto-approve'));
  await rm(path.dirname(argsFile), { recursive: true, force: true });
});

test('passes effort as --thinking and attachments as @paths', async () => {
  const captured: Captured[] = [];
  const argsFile = path.join(await mkdtemp(path.join(os.tmpdir(), 'omp-args-')), 'args.json');
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';
  process.env.OMP_MOCK_ARGS_FILE = argsFile;

  const imagePath = path.join(process.cwd(), 'fixtures.png');
  await ompRuntime.run(
    'Look',
    {
      sessionId: 'app-1',
      projectPath: process.cwd(),
      effort: 'high',
      attachments: [{ path: imagePath, mimeType: 'image/png' }],
    },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
  assert.ok(args.includes('--thinking'));
  assert.ok(args.includes('high'));
  assert.ok(args.includes(`@${imagePath}`));
  await rm(path.dirname(argsFile), { recursive: true, force: true });
});

test('a terminal error message with exit 0 still reports failure', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'error-message-exit0';

  await ompRuntime.run('Go', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const error = captured.find((entry) => entry.kind === 'error');
  assert.ok(error && typeof error.content === 'string');
  assert.ok(!error.content.includes('sk-12345'));
  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
  assert.equal(complete?.aborted, false);
});

test('an error turn followed by a successful retry reports success', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'error-then-success';

  await ompRuntime.run('Go', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
});

test('a startup error with no terminal event reports failure from stderr', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'startup-error';

  await ompRuntime.run('Go', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
  const error = captured.find((entry) => entry.kind === 'error');
  assert.ok(error && typeof error.content === 'string');
  assert.ok(error.content.includes('Unknown provider'));
});

test('flushes a final event without a trailing newline', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'no-trailing-newline';

  await ompRuntime.run('Hi', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
  assert.ok(captured.some((entry) => entry.kind === 'text'));
});

test('abort terminates a hanging run and reports aborted', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'hang';

  const runPromise = ompRuntime.run(
    'Long task',
    { sessionId: 'app-1', projectPath: process.cwd() },
    makeWriter(captured),
    makeContext(new Map()),
  );
  await sleep(300);
  const aborted = await ompRuntime.abort('app-1');
  assert.equal(aborted, true);
  await runPromise;

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.aborted, true);
  assert.equal(complete?.exitCode, 0);
});

test('rejects a second concurrent run on the same session', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'hang';

  const first = ompRuntime.run('One', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));
  await sleep(200);
  await ompRuntime.run('Two', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  assert.ok(captured.some((entry) => entry.kind === 'error'));
  await ompRuntime.abort('app-1');
  await first;
});

test('a timeout reaps the process and reports a failure', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'hang';
  process.env.OMP_RUN_TIMEOUT_MS = '200';

  await ompRuntime.run('Long', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
  assert.ok(captured.some((entry) => entry.kind === 'error' && typeof entry.content === 'string' && entry.content.includes('timed out')));
});

test('streams thinking/reply deltas and suppresses the terminal full-message copy', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'streaming';

  await ompRuntime.run('hello', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));

  const deltas = captured.filter((entry) => entry.kind === 'stream_delta');
  const reply = deltas.filter((entry) => entry.streamChannel !== 'thinking').map((entry) => entry.content).join('');
  const thinking = deltas.filter((entry) => entry.streamChannel === 'thinking').map((entry) => entry.content).join('');
  assert.equal(reply, 'OK:hello');
  assert.equal(thinking, 'mock thinking');

  const streamEndIndex = captured.findIndex((entry) => entry.kind === 'stream_end');
  assert.notEqual(streamEndIndex, -1, 'expected a stream_end to finalize the placeholder rows');
  const lastDeltaIndex = captured.map((entry) => entry.kind).lastIndexOf('stream_delta');
  assert.ok(lastDeltaIndex < streamEndIndex, 'every delta must precede stream_end');

  // The full `message_end` copy must not re-emit the blocks that streamed.
  const duplicated = captured
    .slice(streamEndIndex + 1)
    .filter((entry) => entry.kind === 'text' || entry.kind === 'thinking');
  assert.deepEqual(duplicated, [], `unexpected duplicated content: ${JSON.stringify(duplicated)}`);

  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 0);
});

// OMP emits `advisor_cost_changed` on every run; it and the agent/turn framing
// must be ignored quietly instead of logging "unsupported json event".
test('ignores the always-on frame vocabulary without warning', async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'success';

  const warnings = await withCapturedWarnings(async () => {
    await ompRuntime.run('Quiet', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext(new Map()));
  });

  assert.deepEqual(warnings, [], `unexpected warnings: ${JSON.stringify(warnings)}`);
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 0);
});

// The regression depends on SIGTERM reaching the child and letting it emit one
// last delta, which is POSIX-specific; Windows kill semantics would not.
test('an abort drops an omp delta that arrives after the terminal complete', { skip: process.platform === 'win32' }, async () => {
  const captured: Captured[] = [];
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_MODE = 'streaming-hang';

  const runPromise = ompRuntime.run(
    'Long task',
    { sessionId: 'app-1', projectPath: process.cwd() },
    makeWriter(captured),
    makeContext(new Map()),
  );

  const deadline = Date.now() + 5000;
  while (!captured.some((entry) => entry.kind === 'stream_delta')) {
    if (Date.now() > deadline) {
      assert.fail('timed out waiting for the mock CLI to stream');
    }
    await sleep(20);
  }

  assert.equal(await ompRuntime.abort('app-1'), true);
  // `handleChatAbort` emits the terminal complete directly on the writer,
  // bypassing the runtime's coalescer — reproduce that here.
  captured.push({ kind: 'complete', provider: 'omp', aborted: true });

  await runPromise;
  // Outlast both the coalescer window (50ms) and the mock's 300ms linger.
  await sleep(400);

  const completeIndex = captured.findIndex((entry) => entry.kind === 'complete');
  assert.notEqual(completeIndex, -1);
  const lateDeltas = captured
    .slice(completeIndex + 1)
    .filter((entry) => entry.kind === 'stream_delta');
  assert.deepEqual(lateDeltas, [], `unexpected delta after complete: ${JSON.stringify(lateDeltas)}`);
});
