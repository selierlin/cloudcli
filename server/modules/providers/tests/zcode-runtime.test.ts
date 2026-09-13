import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import { resetZcodeCommandForTests } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { setZcodeHomeDirForTests } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { resetZcodeRuntimeForTests, zcodeRuntime } from '@/modules/providers/list/zcode/zcode-runtime.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'zcode-mock-cli.mjs'),
);

type Captured = {
  kind: string;
  role?: string;
  content?: unknown;
  streamChannel?: string;
  newSessionId?: string;
  exitCode?: number;
  aborted?: boolean;
  errorCode?: string;
  toolId?: string;
  toolName?: string;
  isError?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const useMockCli = (): void => {
  process.env.ZCODE_COMMAND = `node ${MOCK_CLI}`;
  resetZcodeCommandForTests();
};

beforeEach(() => {
  delete process.env.MOCK_MODE;
  delete process.env.MOCK_DENIALS;
  delete process.env.ZCODE_COMMAND;
  delete process.env.ZCODE_MOCK_ARGS_FILE;
  delete process.env.ZCODE_MOCK_ENV_FILE;
  delete process.env.ZCODE_RUN_TIMEOUT_MS;
  delete process.env.ZCODE_MAX_DENIALS;
  resetZcodeCommandForTests();
  // Model selection rewrites `<home>/cli/config.json`; never let a test reach
  // the developer's real `~/.zcode` store.
  setZcodeHomeDirForTests(null);
});

afterEach(async () => {
  resetZcodeRuntimeForTests();
  resetZcodeCommandForTests();
  setZcodeHomeDirForTests(null);
  delete process.env.MOCK_MODE;
  delete process.env.MOCK_DENIALS;
  delete process.env.ZCODE_COMMAND;
  delete process.env.ZCODE_MOCK_ARGS_FILE;
  delete process.env.ZCODE_MOCK_ENV_FILE;
  delete process.env.ZCODE_RUN_TIMEOUT_MS;
  delete process.env.ZCODE_MAX_DENIALS;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Creates a throwaway ZCode home holding a config with two selectable models
 * and points the provider at it.
 */
const makeZcodeHome = async (mainModel = 'ark/glm-5.3'): Promise<string> => {
  const home = await makeTempDir('zcode-home-');
  await mkdir(path.join(home, 'cli'), { recursive: true });
  await writeFile(
    path.join(home, 'cli', 'config.json'),
    JSON.stringify({
      provider: {
        ark: {
          options: { baseURL: 'https://ark.example/api', apiKey: 'ark-secret' },
          models: {
            'glm-5.3': { name: 'GLM 5.3' },
            'glm-5.3-flash': { name: 'GLM 5.3 Flash' },
          },
        },
      },
      model: { main: mainModel },
    }),
    'utf8',
  );
  setZcodeHomeDirForTests(home);
  return home;
};

const readMainModel = async (home: string): Promise<string | undefined> => {
  const config = JSON.parse(await readFile(path.join(home, 'cli', 'config.json'), 'utf8')) as {
    model?: { main?: string };
  };
  return config.model?.main;
};

function makeContext(providerSessionIds: Map<string, string | null> = new Map()): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: (sessionId) => providerSessionIds.get(sessionId ?? '') ?? null,
    resolveProviderConfigDir: () => null,
    resolveSettingsFile: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'ark/deepseek-v4-flash' }),
    normalizeMessage: (raw, sessionId) => new ZcodeSessionsProvider().normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
}

function makeWriter(captured: Captured[]): ProviderRuntimeWriter {
  return {
    send(message: unknown) {
      captured.push(message as Captured);
    },
    userId: 1,
  };
}

const kindsOf = (captured: Captured[]): string[] => captured.map((entry) => entry.kind);

test('a new session announces its id, streams thinking and text, and completes', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'success';

  await zcodeRuntime.run('Say hi', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  const kinds = kindsOf(captured);
  assert.ok(kinds.includes('session_created'), `kinds: ${kinds.join(',')}`);
  assert.ok(kinds.includes('stream_delta'));
  assert.ok(kinds.includes('stream_end'));
  assert.ok(kinds.includes('complete'));

  const created = captured.find((entry) => entry.kind === 'session_created');
  assert.equal(created?.newSessionId, 'sess_mock-zcode-session-1');

  // Reasoning and reply ride separate stream channels.
  assert.ok(captured.some((entry) => entry.kind === 'stream_delta' && entry.streamChannel === 'thinking'));
  assert.ok(captured.some((entry) => entry.kind === 'stream_delta' && entry.streamChannel === 'text'));

  // The user prompt is never echoed back as a user message.
  assert.equal(captured.filter((entry) => entry.role === 'user' && entry.kind === 'text').length, 0);

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
});

test('resume passes --resume, maps acceptEdits to edit, and does not re-announce', async () => {
  const captured: Captured[] = [];
  const argsFile = path.join(await makeTempDir('zcode-args-'), 'args.json');
  useMockCli();
  process.env.MOCK_MODE = 'success';
  process.env.ZCODE_MOCK_ARGS_FILE = argsFile;

  const sessions = new Map<string, string | null>([['app-1', 'sess_existing']]);
  await zcodeRuntime.run(
    'Continue',
    { sessionId: 'app-1', projectPath: process.cwd(), permissionMode: 'acceptEdits' },
    makeWriter(captured),
    makeContext(sessions),
  );

  assert.equal(captured.some((entry) => entry.kind === 'session_created'), false);
  const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('sess_existing'));
  assert.ok(args.includes('--mode'));
  assert.equal(args[args.indexOf('--mode') + 1], 'edit');
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('--no-color'));
  assert.ok(args.includes('--cwd'));
  assert.ok(args.includes('--prompt'));
  // First version deliberately does not inject the (bypassable) tool denylist.
  assert.equal(args.includes('--disallowed-tools'), false);

  const text = captured
    .filter((entry) => entry.kind === 'stream_delta' && entry.streamChannel === 'text')
    .map((entry) => entry.content)
    .join('');
  assert.ok(text.includes('RESUMED:sess_existing'), `text: ${text}`);
  assert.ok(text.includes('MODE:edit'));
});

test('tool success closes through tool.updated/result and a success batch does not reopen it', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'tool-success';

  await zcodeRuntime.run('Run echo', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  const toolUse = captured.find((entry) => entry.kind === 'tool_use');
  assert.equal(toolUse?.toolId, 'call_ok_1');
  assert.equal(toolUse?.toolName, 'Bash');

  const results = captured.filter((entry) => entry.kind === 'tool_result' && entry.toolId === 'call_ok_1');
  assert.equal(results.length, 1, 'the success batch must not re-close an already-closed call');
  assert.equal(results[0]?.isError, false);
  assert.equal(results[0]?.content, 'ZCODE_TOOL_OK');

  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 0);
});

test('a permission denial emits one guidance error and closes the tool once', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'permission-denied';

  await zcodeRuntime.run('Write a file', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  const guidance = captured.filter((entry) => entry.kind === 'error');
  assert.equal(guidance.length, 1, 'guidance is emitted once per run');
  assert.ok(String(guidance[0]?.content).includes('cannot prompt for approval'));
  assert.ok(String(guidance[0]?.content).includes('Write'));

  // permission.resolved and the error batch both target the call; only one closure.
  const closures = captured.filter((entry) => entry.kind === 'tool_result' && entry.toolId === 'call_denied_1');
  assert.equal(closures.length, 1);
  assert.equal(closures[0]?.isError, true);

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 0);
  assert.equal(complete?.errorCode, undefined);
});

test('the circuit breaker trips at the denial threshold with the stable error code', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'permission-flood';
  process.env.MOCK_DENIALS = '4';
  process.env.ZCODE_MAX_DENIALS = '3';

  await zcodeRuntime.run('Do lots of writes', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
  assert.equal(complete?.errorCode, 'ZCODE_PERMISSION_CIRCUIT_OPEN');

  const errors = captured.filter((entry) => entry.kind === 'error');
  assert.equal(errors.filter((entry) => String(entry.content).includes('cannot prompt for approval')).length, 1);
  assert.equal(errors.filter((entry) => String(entry.content).includes('ZCODE_PERMISSION_CIRCUIT_OPEN')).length, 1);
});

test('the denial counter resets between runs (each spawn is one turn)', async () => {
  useMockCli();
  process.env.MOCK_MODE = 'permission-flood';
  process.env.MOCK_DENIALS = '1';
  process.env.ZCODE_MAX_DENIALS = '2';

  for (let run = 0; run < 2; run += 1) {
    const captured: Captured[] = [];
    await zcodeRuntime.run('one denial', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());
    assert.equal(captured.find((entry) => entry.kind === 'complete')?.errorCode, undefined);
  }

  const captured: Captured[] = [];
  process.env.MOCK_DENIALS = '2';
  await zcodeRuntime.run('two denials', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.errorCode, 'ZCODE_PERMISSION_CIRCUIT_OPEN');
});

test('rejects an over-long prompt before spawning the CLI', async () => {
  const captured: Captured[] = [];
  const argsFile = path.join(await makeTempDir('zcode-args-long-'), 'args.json');
  useMockCli();
  process.env.MOCK_MODE = 'success';
  process.env.ZCODE_MOCK_ARGS_FILE = argsFile;

  await zcodeRuntime.run(
    'x'.repeat(140 * 1024),
    { sessionId: 'app-1', projectPath: process.cwd() },
    makeWriter(captured),
    makeContext(),
  );

  const error = captured.find((entry) => entry.kind === 'error');
  assert.ok(String(error?.content).includes('too long'));
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 1);
  assert.equal(existsSync(argsFile), false, 'the CLI must not be spawned');
});

test('abort terminates the run and reports it as aborted', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'streaming-hang';

  const runPromise = zcodeRuntime.run('keep going', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());
  await sleep(200);
  assert.equal(await zcodeRuntime.abort('app-1'), true);
  await runPromise;

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.aborted, true);
  assert.equal(complete?.exitCode, 0);
});

test('a hung run is failed by the run timeout', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'hang';
  process.env.ZCODE_RUN_TIMEOUT_MS = '300';

  await zcodeRuntime.run('hang forever', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
  assert.ok(captured.some((entry) => entry.kind === 'error' && String(entry.content).includes('timed out')));
});

test('a startup failure with no stdout surfaces stderr', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'startup-error';

  await zcodeRuntime.run('resume a missing session', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  const complete = captured.find((entry) => entry.kind === 'complete');
  assert.equal(complete?.exitCode, 1);
  assert.ok(captured.some((entry) => entry.kind === 'error' && String(entry.content).includes('Session not found')));
});

test('flushes a terminal result written without a trailing newline', async () => {
  const captured: Captured[] = [];
  useMockCli();
  process.env.MOCK_MODE = 'no-trailing-newline';

  await zcodeRuntime.run('hi', { sessionId: 'app-1', projectPath: process.cwd() }, makeWriter(captured), makeContext());

  assert.equal(captured.find((entry) => entry.kind === 'session_created')?.newSessionId, 'sess_mock-zcode-session-1');
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 0);
});

test('passes --attach for attachments inside the working directory', async () => {
  const captured: Captured[] = [];
  const workingDir = await makeTempDir('zcode-attach-');
  const attachment = path.join(workingDir, 'note.txt');
  await writeFile(attachment, 'hello', 'utf8');
  const argsFile = path.join(workingDir, 'args.json');
  useMockCli();
  process.env.MOCK_MODE = 'success';
  process.env.ZCODE_MOCK_ARGS_FILE = argsFile;

  await zcodeRuntime.run(
    'Read the attachment',
    { sessionId: 'app-1', projectPath: workingDir, attachments: [{ path: attachment }] },
    makeWriter(captured),
    makeContext(),
  );

  const args = JSON.parse(await readFile(argsFile, 'utf8')) as string[];
  assert.ok(args.includes('--attach'));
  assert.ok(args.includes(attachment));
});

test('a requested non-default model rides the ZCODE_MODEL env channel and leaves the config alone', async () => {
  const captured: Captured[] = [];
  const home = await makeZcodeHome('ark/glm-5.3');
  const envFile = path.join(await makeTempDir('zcode-env-'), 'env.json');
  const configBefore = await readFile(path.join(home, 'cli', 'config.json'), 'utf8');
  useMockCli();
  process.env.MOCK_MODE = 'success';
  process.env.ZCODE_MOCK_ENV_FILE = envFile;

  await zcodeRuntime.run(
    'Switch model',
    { sessionId: 'app-1', projectPath: process.cwd(), model: 'ark/glm-5.3-flash' },
    makeWriter(captured),
    makeContext(),
  );

  assert.deepEqual(JSON.parse(await readFile(envFile, 'utf8')), {
    ZCODE_MODEL: 'ark/glm-5.3-flash',
    ZCODE_BASE_URL: 'https://ark.example/api',
    ZCODE_API_KEY: 'ark-secret',
  });
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 0);
  // The whole point of the env channel: no global config mutation.
  assert.equal(await readFile(path.join(home, 'cli', 'config.json'), 'utf8'), configBefore);
});

test('the default model is left to the config instead of the env channel', async () => {
  const captured: Captured[] = [];
  const home = await makeZcodeHome('ark/glm-5.3');
  const envFile = path.join(await makeTempDir('zcode-env-'), 'env.json');
  useMockCli();
  process.env.MOCK_MODE = 'success';
  process.env.ZCODE_MOCK_ENV_FILE = envFile;

  await zcodeRuntime.run(
    'Keep the default',
    { sessionId: 'app-1', projectPath: process.cwd(), model: 'ark/glm-5.3' },
    makeWriter(captured),
    makeContext(),
  );

  // An empty dump means the CLI ran without the override environment.
  assert.deepEqual(JSON.parse(await readFile(envFile, 'utf8')), {});
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 0);
  assert.equal(await readMainModel(home), 'ark/glm-5.3');
});

test('a model whose channel cannot be resolved fails the run before spawning', async () => {
  const captured: Captured[] = [];
  const home = await makeZcodeHome('ark/glm-5.3');
  const argsFile = path.join(await makeTempDir('zcode-args-'), 'args.json');
  useMockCli();
  process.env.MOCK_MODE = 'success';
  process.env.ZCODE_MOCK_ARGS_FILE = argsFile;

  await zcodeRuntime.run(
    'Unknown channel',
    { sessionId: 'app-1', projectPath: process.cwd(), model: 'nope/glm-5.3' },
    makeWriter(captured),
    makeContext(),
  );

  assert.match(String(captured.find((entry) => entry.kind === 'error')?.content), /no provider "nope"/);
  assert.equal(captured.find((entry) => entry.kind === 'complete')?.exitCode, 1);
  // The run never started, so the CLI was never spawned.
  assert.equal(existsSync(argsFile), false);
  assert.equal(await readMainModel(home), 'ark/glm-5.3');
});
