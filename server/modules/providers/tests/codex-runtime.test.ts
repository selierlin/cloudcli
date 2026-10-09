import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import { codexRuntime, extractCodexTokenBudget } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

/**
 * The runtime is exercised against a fake `codex app-server` process: the
 * assertions are about the conversation the runtime builds out of the
 * notification stream, not about the CLI behind it, and the real binary is
 * driven end-to-end elsewhere.
 *
 * `normalizeMessage` is the real one, so each assertion covers the whole chain
 * — notification → mapper → normalizer → wire message.
 */
const MOCK_SERVER = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex-app-server-mock.mjs'),
);

type LoggedRequest = { method: string; params: Record<string, unknown> };

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

type Harness = {
  messages: NormalizedMessage[];
  requests: () => LoggedRequest[];
  context: ProviderRuntimeContext;
  writer: ProviderRuntimeWriter;
};

let tempDir: string | null = null;

async function createHarness(input: {
  sessionId?: string;
  providerSessionId?: string | null;
} = {}): Promise<Harness> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-runtime-mock-'));
  const logPath = path.join(tempDir, 'requests.jsonl');
  process.env.CODEX_MOCK_LOG = logPath;

  const messages: NormalizedMessage[] = [];
  const writer: ProviderRuntimeWriter = {
    isWebSocketWriter: true,
    send: (message) => messages.push(message as NormalizedMessage),
  };

  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => input.providerSessionId ?? null,
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

  return { messages, requests, context, writer };
}

const byKind = (messages: NormalizedMessage[], kind: string) =>
  messages.filter((message) => message.kind === kind);

const textOf = (message: NormalizedMessage | undefined) =>
  typeof message?.content === 'string' ? message.content : '';

const run = (harness: Harness, options: Record<string, unknown> = {}) =>
  codexRuntime.run('hey there', {
    sessionId: 'app-session',
    cwd: process.cwd(),
    ...options,
  }, harness.writer, harness.context);

beforeEach(() => {
  process.env.CODEX_APP_SERVER_COMMAND = MOCK_SERVER;
  process.env.CODEX_MOCK_MODE = 'runtime';
  process.env.CODEX_MOCK_SCRIPT = 'text';
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

test('Codex reads the app-server token usage shape into the budget row', () => {
  assert.deepEqual(extractCodexTokenBudget({
    total: {
      totalTokens: 220,
      inputTokens: 120,
      cachedInputTokens: 30,
      cacheWriteInputTokens: 10,
      outputTokens: 40,
      reasoningOutputTokens: 60,
    },
    modelContextWindow: 128000,
  }), {
    used: 220,
    total: 128000,
    inputTokens: 120,
    outputTokens: 40,
    reasoningTokens: 60,
    breakdown: { input: 120, output: 40, reasoning: 60 },
  });

  // A window without a context size falls back to the historical default.
  assert.equal(extractCodexTokenBudget({ total: { totalTokens: 5 } })?.total, 200000);
  assert.equal(extractCodexTokenBudget(null), null);
});

test('a streamed reply becomes deltas, one stream_end and no duplicate final row', async () => {
  const harness = await createHarness();
  await run(harness);

  const created = byKind(harness.messages, 'session_created')[0];
  assert.equal((created as { newSessionId?: string }).newSessionId, 'mock-thread-1');

  const deltas = byKind(harness.messages, 'stream_delta');
  assert.equal(deltas.length, 1, 'consecutive deltas are coalesced into one frame');
  assert.equal(textOf(deltas[0]), 'Hello, world');
  assert.equal(deltas[0].streamChannel, 'text');
  assert.equal((deltas[0] as { sourceItemId?: string }).sourceItemId, 'item-1');

  assert.equal(byKind(harness.messages, 'stream_end').length, 1);
  // The completed message is not re-sent as a row: its text is already the
  // streamed row, and re-sending it would render the reply twice.
  assert.equal(byKind(harness.messages, 'text').filter((m) => m.role === 'assistant').length, 0);

  const budget = byKind(harness.messages, 'status')[0];
  assert.equal((budget as { text?: string }).text, 'token_budget');
  assert.equal((budget as { tokenBudget?: { used?: number } }).tokenBudget?.used, 220);

  const complete = byKind(harness.messages, 'complete')[0];
  assert.equal((complete as { exitCode?: number }).exitCode, 0);
});

test('the echoed user turn and a streamed reasoning trace are not rendered as rows', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'reasoning';
  const harness = await createHarness();
  await run(harness);

  // The protocol echoes the turn's own input as a `userMessage` item; the client
  // already has the message the user typed, so it must not become a tool card.
  assert.deepEqual(byKind(harness.messages, 'tool_use'), []);

  // Reasoning streams on the thinking channel and its completed row (which
  // carries the same summary) is suppressed, so the trace is not shown twice.
  const thinking = byKind(harness.messages, 'stream_delta').filter((m) => m.streamChannel === 'thinking');
  assert.equal(thinking.map(textOf).join(''), 'part one\npart two');
  assert.equal(byKind(harness.messages, 'thinking').length, 0);

  // The reply still streams, and its completed row stays suppressed.
  const text = byKind(harness.messages, 'stream_delta').filter((m) => m.streamChannel === 'text');
  assert.equal(text.map(textOf).join(''), 'ok');
  assert.equal(byKind(harness.messages, 'text').length, 0);
  assert.equal(byKind(harness.messages, 'stream_end').length, 1);
  assert.equal((byKind(harness.messages, 'complete')[0] as { exitCode?: number }).exitCode, 0);
});

test('prose either side of a tool comes out as two sealed segments, and the command output accumulates', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'tool';
  const harness = await createHarness();
  await run(harness);

  const deltas = byKind(harness.messages, 'stream_delta');
  assert.deepEqual(deltas.map(textOf), ['First', 'Second']);
  assert.equal(byKind(harness.messages, 'stream_end').length, 2, 'one seal per assistant message');

  const bash = byKind(harness.messages, 'tool_use').find((message) => message.toolName === 'Bash');
  assert.deepEqual(bash?.toolInput, { command: 'ls' });

  // Every output frame carries the whole command output so far: the client
  // replaces the row, so a bare delta would erase what it already shows.
  const results = byKind(harness.messages, 'tool_result').filter((message) => message.toolId === 'cmd-1');
  assert.deepEqual(results.map(textOf), ['a\n', 'a\nb\n', 'a\nb\n']);
  assert.equal((results.at(-1) as { isError?: boolean }).isError, false);
});

test('a plan update renders as one TodoWrite row', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'plan';
  const harness = await createHarness();
  await run(harness);

  const todo = byKind(harness.messages, 'tool_use').find((message) => message.toolName === 'TodoWrite');
  assert.deepEqual(todo?.toolInput, {
    todos: [
      { content: 'gather', status: 'completed' },
      { content: 'analyse', status: 'pending' },
      { content: 'report', status: 'pending' },
    ],
  });
});

test('a failed turn surfaces one error row and a complete with a non-zero exit', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'fail';
  const harness = await createHarness();
  await run(harness);

  const errors = byKind(harness.messages, 'error');
  assert.equal(errors.length, 1);
  assert.equal(textOf(errors[0]), 'model exploded');
  assert.equal((byKind(harness.messages, 'complete')[0] as { exitCode?: number }).exitCode, 1);
});

test('a retryable error is not rendered as a terminal row', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'retry';
  const harness = await createHarness();
  await run(harness);

  assert.equal(byKind(harness.messages, 'error').length, 0);
  assert.equal(textOf(byKind(harness.messages, 'stream_delta')[0]), 'recovered');
  assert.equal((byKind(harness.messages, 'complete')[0] as { exitCode?: number }).exitCode, 0);
});

test('a child that dies mid-turn is reported as a failure', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'exit';
  const harness = await createHarness();
  await run(harness);

  const errors = byKind(harness.messages, 'error');
  assert.equal(errors.length, 1);
  assert.match(textOf(errors[0]), /exited/);
  assert.equal((byKind(harness.messages, 'complete')[0] as { exitCode?: number }).exitCode, 1);
});

test('a resumed thread excludes its history', async () => {
  const harness = await createHarness({ providerSessionId: 'native-thread' });
  await run(harness);

  const resume = harness.requests().find((request) => request.method === 'thread/resume');
  assert.equal(resume?.params.threadId, 'native-thread');
  assert.equal(resume?.params.excludeTurns, true);
  // A resumed thread is not a new session, so nothing announces one.
  assert.equal(byKind(harness.messages, 'session_created').length, 0);
});

test('an image turn sends the protocol input shape', async () => {
  const harness = await createHarness();
  const imagePath = path.join(process.cwd(), 'public', 'favicon.png');
  await run(harness, { images: [{ path: imagePath, mimeType: 'image/png' }] });

  const turnStart = harness.requests().find((request) => request.method === 'turn/start');
  const input = turnStart?.params.input as Array<Record<string, unknown>> | undefined;
  assert.ok(Array.isArray(input));
  assert.equal(input[0].type, 'text');
  // Required by the protocol; the SDK shape has no such field.
  assert.deepEqual(input[0].text_elements, []);
  assert.equal(input.at(-1)?.type, 'localImage');
  assert.equal(input.at(-1)?.path, imagePath);
});

test('an image-only turn still carries an instruction', async () => {
  const harness = await createHarness();
  const imagePath = path.join(process.cwd(), 'public', 'favicon.png');
  await run(harness, { images: [{ path: imagePath, mimeType: 'image/png' }] });

  // An empty prompt with attachments exercises the image-only fallback branch.
  const emptyPrompt = await createHarness();
  await codexRuntime.run('', {
    sessionId: 'app-session',
    cwd: process.cwd(),
    images: [{ path: imagePath, mimeType: 'image/png' }],
  }, emptyPrompt.writer, emptyPrompt.context);

  const turnStart = emptyPrompt.requests().find((request) => request.method === 'turn/start');
  const input = turnStart?.params.input as Array<Record<string, unknown>> | undefined;
  assert.equal(input?.[0].text, 'Please analyze the attached image(s).');
});

test('abort interrupts the turn and leaves the terminal complete to the abort handler', async () => {
  process.env.CODEX_MOCK_SCRIPT = 'hang';
  const harness = await createHarness();
  const pending = run(harness);

  // Wait until the turn is live before aborting.
  await waitFor(() => byKind(harness.messages, 'stream_delta')[0]);

  assert.equal(await codexRuntime.abort('app-session'), true);
  await pending;

  assert.ok(harness.requests().some((request) => request.method === 'turn/interrupt'));
  assert.equal(byKind(harness.messages, 'complete').length, 0, 'the abort handler owns the terminal complete');
  assert.equal(await codexRuntime.abort('never-seen'), false);
});
