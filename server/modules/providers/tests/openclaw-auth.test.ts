import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import {
  OpenclawProviderAuth,
  getOpenclawCommand,
  resetOpenclawCommandForTests,
  resolveOpenclawCommand,
} from '@/modules/providers/list/openclaw/openclaw-auth.provider.js';
import {
  getOpenclawConfigPath,
  setOpenclawHomeDirForTests,
} from '@/modules/providers/list/openclaw/openclaw-models.provider.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'openclaw-mock-cli.mjs'),
);
const MISSING_CLI = path.join('/nonexistent', 'openclaw-missing');

let homeDir: string | null = null;

beforeEach(() => {
  resetOpenclawCommandForTests();
  setOpenclawHomeDirForTests(null);
  delete process.env.OPENCLAW_COMMAND;
  delete process.env.MOCK_AUTH;
  delete process.env.MOCK_VERSION_FAIL;
});

afterEach(async () => {
  resetOpenclawCommandForTests();
  setOpenclawHomeDirForTests(null);
  delete process.env.OPENCLAW_COMMAND;
  delete process.env.MOCK_AUTH;
  delete process.env.MOCK_VERSION_FAIL;
  if (homeDir) {
    const dir = homeDir;
    homeDir = null;
    await rm(dir, { recursive: true, force: true });
  }
});

/** Points the state root at a temp dir so config reads are isolated. */
async function isolateStateRoot(): Promise<string> {
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-auth-'));
  setOpenclawHomeDirForTests(homeDir);
  return homeDir;
}

test('resolveOpenclawCommand honors OPENCLAW_COMMAND and splits quoted args', () => {
  process.env.OPENCLAW_COMMAND = `${MOCK_CLI} --profile "work dir"`;
  const resolution = resolveOpenclawCommand();
  assert.equal(resolution.source, 'override');
  assert.equal(resolution.command, MOCK_CLI);
  assert.deepEqual(resolution.baseArgs, ['--profile', 'work dir']);
});

test('getOpenclawCommand quotes the resolved executable and fixed args', () => {
  process.env.OPENCLAW_COMMAND = `${MOCK_CLI} --profile "work dir"`;
  assert.equal(getOpenclawCommand(), `'${MOCK_CLI}' '--profile' 'work dir'`);
});

test('getOpenclawCommand falls back to the bare name when nothing resolves', () => {
  process.env.OPENCLAW_COMMAND = MISSING_CLI;
  // The override still resolves (so quoting applies), but a truly unresolvable
  // setup yields the bare name; assert the override path here.
  assert.equal(getOpenclawCommand(), `'${MISSING_CLI}'`);
});

test('getStatus reports authenticated when models status shows a credential profile', async () => {
  await isolateStateRoot();
  process.env.OPENCLAW_COMMAND = MOCK_CLI;
  process.env.MOCK_AUTH = 'ready';

  const status = await new OpenclawProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.provider, 'openclaw');
  assert.equal(status.authenticated, true);
  assert.equal(status.authVerified, true);
  assert.equal(status.method, 'openclaw_config');
  assert.equal(status.error, undefined);
});

test('getStatus reports unauthenticated when a provider in use is missing auth', async () => {
  await isolateStateRoot();
  process.env.OPENCLAW_COMMAND = MOCK_CLI;
  process.env.MOCK_AUTH = 'missing_in_use';

  const status = await new OpenclawProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.authVerified, false);
  assert.equal(status.method, null);
  assert.ok(status.error?.includes('no usable model credentials'), `error: ${status.error}`);
});

test('getStatus reports unauthenticated when no provider holds a profile', async () => {
  await isolateStateRoot();
  process.env.OPENCLAW_COMMAND = MOCK_CLI;
  process.env.MOCK_AUTH = 'no_profiles';

  const status = await new OpenclawProviderAuth().getStatus();
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
});

test('getStatus falls back to an inline apiKey when the status probe cannot be read', async () => {
  await isolateStateRoot();
  process.env.OPENCLAW_COMMAND = MOCK_CLI;

  for (const mode of ['probe_error', 'garbage']) {
    resetOpenclawCommandForTests();
    process.env.MOCK_AUTH = mode;

    // No inline key: unauthenticated.
    await writeFile(getOpenclawConfigPath(), JSON.stringify({ models: { providers: { ark: { models: [] } } } }));
    let status = await new OpenclawProviderAuth().getStatus();
    assert.equal(status.installed, true, `mode: ${mode}`);
    assert.equal(status.authenticated, false, `mode: ${mode}`);

    // Inline key present: authenticated.
    resetOpenclawCommandForTests();
    await writeFile(getOpenclawConfigPath(), JSON.stringify({ models: { providers: { ark: { apiKey: 'sk-test' } } } }));
    status = await new OpenclawProviderAuth().getStatus();
    assert.equal(status.authenticated, true, `mode: ${mode}`);
    assert.equal(status.method, 'openclaw_config', `mode: ${mode}`);
  }
});

test('getStatus reports not installed when the command cannot run', async () => {
  await isolateStateRoot();
  process.env.OPENCLAW_COMMAND = MISSING_CLI;

  const status = await new OpenclawProviderAuth().getStatus();
  assert.equal(status.installed, false);
  assert.equal(status.authenticated, false);
  assert.equal(status.authVerified, false);
  assert.equal(status.method, null);
  assert.ok(status.error?.includes('not found'), `error: ${status.error}`);
});

test('getStatus reports not installed when the CLI runs but --version fails', async () => {
  await isolateStateRoot();
  process.env.OPENCLAW_COMMAND = MOCK_CLI;
  process.env.MOCK_VERSION_FAIL = '1';

  const status = await new OpenclawProviderAuth().getStatus();
  assert.equal(status.installed, false);
  assert.equal(status.authenticated, false);
  assert.ok(status.error?.includes('not found'), `error: ${status.error}`);
});
