import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import {
  ZCODE_PREDEFINED_MODELS,
  ZcodeProviderModels,
  getZcodeDatabasePath,
  loadZcodeModels,
  readZcodeMainModel,
  resolveZcodeModelEnv,
  setZcodeHomeDirForTests,
} from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { AppError } from '@/shared/utils.js';

const tempDirs: string[] = [];

const makeStorageDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zcode-models-'));
  tempDirs.push(dir);
  setZcodeHomeDirForTests(dir);
  return dir;
};

const writeConfig = async (storageDir: string, config: unknown): Promise<void> => {
  await mkdir(path.join(storageDir, 'cli'), { recursive: true });
  await writeFile(path.join(storageDir, 'cli', 'config.json'), JSON.stringify(config), 'utf8');
};

const readConfig = async (storageDir: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(storageDir, 'cli', 'config.json'), 'utf8'));

beforeEach(() => {
  setZcodeHomeDirForTests(null);
});

afterEach(async () => {
  setZcodeHomeDirForTests(null);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('ZCode models list every configured channel and default to model.main', async () => {
  const storageDir = await makeStorageDir();
  await writeConfig(storageDir, {
    provider: {
      ark: {
        name: 'Ark',
        options: { apiKey: 'secret' },
        models: {
          'deepseek-v4-flash': { name: 'DeepSeek V4 Flash' },
          'glm-5.3': { name: 'GLM-5.3' },
        },
      },
      deepseek: {
        name: 'DeepSeek',
        options: { apiKey: 'secret' },
        models: { 'deepseek-v4-flash': { name: 'DeepSeek V4 Flash' } },
      },
    },
    model: { main: 'ark/glm-5.3' },
  });

  const catalog = await new ZcodeProviderModels().getSupportedModels();
  // Same model id in two channels stays distinguishable through `group`.
  assert.deepEqual(catalog, {
    OPTIONS: [
      { value: 'ark/deepseek-v4-flash', label: 'DeepSeek V4 Flash', group: 'ark' },
      { value: 'ark/glm-5.3', label: 'GLM-5.3', group: 'ark' },
      { value: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', group: 'deepseek' },
    ],
    DEFAULT: 'ark/glm-5.3',
  });
  assert.deepEqual(await new ZcodeProviderModels().getCurrentActiveModel(), { model: 'ark/glm-5.3' });
});

test('ZCode models fall back to the curated catalog when config is missing or invalid', async () => {
  const storageDir = await makeStorageDir();
  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), ZCODE_PREDEFINED_MODELS);

  await mkdir(path.join(storageDir, 'cli'), { recursive: true });
  await writeFile(path.join(storageDir, 'cli', 'config.json'), '{ not json', 'utf8');
  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), ZCODE_PREDEFINED_MODELS);

  // A config with providers but no models at all is equally unusable.
  await writeConfig(storageDir, { provider: { ark: { options: { apiKey: 'secret' } } } });
  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), ZCODE_PREDEFINED_MODELS);
  assert.equal(loadZcodeModels(), null);
});

test('ZCode models keep an unlabeled model id as its own label', async () => {
  const storageDir = await makeStorageDir();
  await writeConfig(storageDir, {
    provider: { ark: { options: { apiKey: 'secret' }, models: { 'unknown-model': {} } } },
    model: { main: 'ark/unknown-model' },
  });

  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), {
    // The label falls back to the bare model id; the channel still groups it.
    OPTIONS: [{ value: 'ark/unknown-model', label: 'unknown-model', group: 'ark' }],
    DEFAULT: 'ark/unknown-model',
  });
});

test('ZCode models default to the first model when model.main is absent', async () => {
  const storageDir = await makeStorageDir();
  await writeConfig(storageDir, {
    provider: {
      ark: { options: { apiKey: 'secret' }, models: { 'glm-5.3': { name: 'GLM-5.3' } } },
    },
  });

  const catalog = await new ZcodeProviderModels().getSupportedModels();
  assert.equal(catalog.DEFAULT, 'ark/glm-5.3');
  assert.deepEqual(await new ZcodeProviderModels().getCurrentActiveModel(), { model: 'ark/glm-5.3' });
});

test('resolveZcodeModelEnv overrides only the requested non-default model', async () => {
  const storageDir = await makeStorageDir();
  await writeConfig(storageDir, {
    provider: {
      ark: {
        options: { baseURL: 'https://ark.example/api', apiKey: 'ark-secret' },
        models: { 'glm-5.3': { name: 'GLM 5.3' }, 'glm-5.3-flash': { name: 'GLM 5.3 Flash' } },
      },
      deepseek: {
        options: { baseURL: 'https://ds.example/anthropic', apiKey: 'ds-secret' },
        models: { 'deepseek-v4-pro': { name: 'DeepSeek V4 Pro' } },
      },
    },
    model: { main: 'ark/glm-5.3' },
  });
  const before = await readConfig(storageDir);

  assert.deepEqual(resolveZcodeModelEnv('deepseek/deepseek-v4-pro'), {
    ZCODE_MODEL: 'deepseek/deepseek-v4-pro',
    ZCODE_BASE_URL: 'https://ds.example/anthropic',
    ZCODE_API_KEY: 'ds-secret',
  });

  // The model `model.main` already selects is left to the config path, which
  // also carries provider headers, timeouts, and request signing.
  assert.equal(resolveZcodeModelEnv('ark/glm-5.3'), null);
  assert.equal(resolveZcodeModelEnv('   '), null);

  // Nothing about resolving a model touches the user's config.
  assert.deepEqual(await readConfig(storageDir), before);
});

test('resolveZcodeModelEnv rejects a model whose channel cannot be resolved', async () => {
  const storageDir = await makeStorageDir();
  await writeConfig(storageDir, {
    provider: {
      ark: {
        options: { baseURL: 'https://ark.example/api', apiKey: 'ark-secret' },
        models: { 'glm-5.3': { name: 'GLM 5.3' } },
      },
      keyless: {
        options: { baseURL: 'https://keyless.example/api' },
        models: { 'some-model': { name: 'Some Model' } },
      },
    },
    model: { main: 'ark/glm-5.3' },
  });

  const expectUnresolved = (model: string) => assert.throws(
    () => resolveZcodeModelEnv(model),
    (error: unknown) => error instanceof AppError && error.code === 'ZCODE_MODEL_CHANNEL_UNRESOLVED',
  );

  // A model the config does not list still resolves: the channel supplies the
  // endpoint and key, and the provider itself decides whether the id exists.
  assert.deepEqual(resolveZcodeModelEnv('ark/not-declared'), {
    ZCODE_MODEL: 'ark/not-declared',
    ZCODE_BASE_URL: 'https://ark.example/api',
    ZCODE_API_KEY: 'ark-secret',
  });

  // A bare id has no channel at all; the CLI would silently treat it as
  // `anthropic/<id>` against the wrong endpoint.
  expectUnresolved('glm-5.3');
  expectUnresolved('nope/glm-5.3');
  expectUnresolved('keyless/some-model');
});

test('ZCode database path honors storage.sessionDbPath with ~ expansion', async () => {
  const storageDir = await makeStorageDir();
  await writeConfig(storageDir, { storage: { sessionDbPath: '~/custom/zcode.sqlite' } });
  assert.equal(getZcodeDatabasePath(), path.join(os.homedir(), 'custom', 'zcode.sqlite'));

  await writeConfig(storageDir, {});
  assert.equal(getZcodeDatabasePath(), path.join(storageDir, 'cli', 'db', 'db.sqlite'));
});
