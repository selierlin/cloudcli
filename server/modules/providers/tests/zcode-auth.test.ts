import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import {
  ZcodeProviderAuth,
  getZcodeCommand,
  resetZcodeCommandForTests,
  resolveZcodeCommand,
  setZcodeBundledCliPathsForTests,
} from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { setZcodeHomeDirForTests } from '@/modules/providers/list/zcode/zcode-models.provider.js';

const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  resetZcodeCommandForTests();
  delete process.env.ZCODE_COMMAND;
  setZcodeHomeDirForTests(null);
});

afterEach(async () => {
  resetZcodeCommandForTests();
  delete process.env.ZCODE_COMMAND;
  setZcodeHomeDirForTests(null);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const writeConfig = async (storageDir: string, config: unknown): Promise<void> => {
  await mkdir(path.join(storageDir, 'cli'), { recursive: true });
  await writeFile(path.join(storageDir, 'cli', 'config.json'), JSON.stringify(config), 'utf8');
};

const authenticatedConfig = {
  provider: {
    ark: {
      name: 'Ark',
      kind: 'anthropic',
      options: { apiKey: 'secret', baseURL: 'https://example.com' },
      models: { 'deepseek-v4-flash': { name: 'DeepSeek V4 Flash' } },
    },
  },
  model: { main: 'ark/deepseek-v4-flash' },
};

test('ZCode auth resolves ZCODE_COMMAND before PATH and the bundled CLI', async () => {
  process.env.ZCODE_COMMAND = 'node /tmp/zcode-override.cjs --flag';

  const resolution = resolveZcodeCommand();
  assert.equal(resolution.source, 'override');
  assert.equal(resolution.command, 'node');
  assert.deepEqual(resolution.baseArgs, ['/tmp/zcode-override.cjs', '--flag']);
  assert.ok(getZcodeCommand().includes("'/tmp/zcode-override.cjs'"));
});

test('ZCode auth resolves the bundled CLI with node when nothing is on PATH', async () => {
  const storageDir = await makeTempDir('zcode-auth-bundled-');
  setZcodeHomeDirForTests(storageDir);
  const fakeBundle = path.join(storageDir, 'zcode.cjs');
  await writeFile(fakeBundle, '// stub', 'utf8');
  setZcodeBundledCliPathsForTests([fakeBundle]);

  const resolution = resolveZcodeCommand();
  assert.equal(resolution.source, 'bundled');
  assert.equal(resolution.command, 'node');
  assert.deepEqual(resolution.baseArgs, [fakeBundle]);
});

test('ZCode auth reports not installed when no command resolves', async () => {
  const emptyDir = await makeTempDir('zcode-auth-empty-');
  const storageDir = await makeTempDir('zcode-auth-storage-');
  setZcodeHomeDirForTests(storageDir);
  const originalPath = process.env.PATH;
  process.env.PATH = `${emptyDir}:/usr/bin:/bin`;
  setZcodeBundledCliPathsForTests([]);

  try {
    const status = await new ZcodeProviderAuth().getStatus();
    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.equal(status.method, null);
    assert.ok(status.error?.includes('not found'), `error: ${status.error}`);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});

test('ZCode auth reports authenticated when the config declares a keyed provider and model', async () => {
  const storageDir = await makeTempDir('zcode-auth-config-');
  setZcodeHomeDirForTests(storageDir);
  process.env.ZCODE_COMMAND = 'node /tmp/zcode-override.cjs';
  await writeConfig(storageDir, authenticatedConfig);

  const status = await new ZcodeProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, true);
  assert.equal(status.authVerified, true);
  assert.equal(status.method, 'zcode_config');
  assert.equal(status.error, undefined);
});

test('ZCode auth stays unauthenticated when only desktop v2 credentials exist', async () => {
  const storageDir = await makeTempDir('zcode-auth-v2-');
  setZcodeHomeDirForTests(storageDir);
  process.env.ZCODE_COMMAND = 'node /tmp/zcode-override.cjs';
  // The desktop app's OAuth credentials do not drive the CLI: without a
  // cli/config.json provider the CLI exits with "Model config is missing".
  await mkdir(path.join(storageDir, 'v2'), { recursive: true });
  await writeFile(path.join(storageDir, 'v2', 'credentials.json'), JSON.stringify({ accessToken: 'x' }), 'utf8');

  const status = await new ZcodeProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
});

test('ZCode auth treats a corrupt config as unauthenticated rather than throwing', async () => {
  const storageDir = await makeTempDir('zcode-auth-corrupt-');
  setZcodeHomeDirForTests(storageDir);
  process.env.ZCODE_COMMAND = 'node /tmp/zcode-override.cjs';
  await mkdir(path.join(storageDir, 'cli'), { recursive: true });
  await writeFile(path.join(storageDir, 'cli', 'config.json'), '{ not json', 'utf8');

  const status = await new ZcodeProviderAuth().getStatus();
  assert.equal(status.authenticated, false);
});

test('ZCode auth requires a resolvable model, not just an api key', async () => {
  const storageDir = await makeTempDir('zcode-auth-nomodel-');
  setZcodeHomeDirForTests(storageDir);
  process.env.ZCODE_COMMAND = 'node /tmp/zcode-override.cjs';
  await writeConfig(storageDir, {
    provider: { ark: { options: { apiKey: 'secret' } } },
  });

  const status = await new ZcodeProviderAuth().getStatus();
  assert.equal(status.authenticated, false);
});
