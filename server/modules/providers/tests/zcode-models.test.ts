import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import {
  ZCODE_PREDEFINED_MODELS,
  ZcodeProviderModels,
  getZcodeDatabasePath,
  loadZcodeModels,
  resolveZcodeModelEnv,
  setZcodeHomeDirForTests,
} from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { AppError } from '@/shared/utils.js';

const TEST_SECRET = 'zcode-test-secret';
const OFFICIAL_KEY_NAME = 'account-provider:coding-plan:account:bigmodel-individual-coding-plan:account:42:api-key';
const tempDirs: string[] = [];

const makeStorageDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zcode-models-'));
  tempDirs.push(dir);
  setZcodeHomeDirForTests(dir);
  return dir;
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

/** Writes a provider document in its real on-disk shape: `{ schemaVersion, config }`. */
const writeProviderConfig = (storageDir: string, config: unknown): Promise<void> =>
  writeJson(path.join(storageDir, 'v2', 'provider_config.json'), { schemaVersion: 1, config });

const writeLegacyConfig = (storageDir: string, config: unknown): Promise<void> =>
  writeJson(path.join(storageDir, 'cli', 'config.json'), config);

/** Reproduces ZCode's `enc:v1:` AES-256-GCM credential format for the given secret. */
const encryptCredential = (plain: string, secret: string): string => {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
};

const writeCredentials = (storageDir: string, apiKey: string): Promise<void> =>
  writeJson(path.join(storageDir, 'v2', 'credentials.json'), {
    [OFFICIAL_KEY_NAME]: encryptCredential(apiKey, TEST_SECRET),
  });

/** A minimal personal provider document: two providers, explicitly ordered. */
const personalConfig = () => ({
  providerOrder: ['deepseek', 'wuanai'],
  providerConfigRules: {
    providerRules: [
      {
        providerId: 'deepseek',
        enabled: true,
        config: {
          visibility: 'visible',
          access: { type: 'api-key', apiKey: 'ds' },
          api: { type: 'anthropic-messages', baseUrl: 'https://ds.example' },
          personalModelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        },
      },
      {
        providerId: 'wuanai',
        enabled: true,
        config: {
          visibility: 'visible',
          access: { type: 'api-key', apiKey: 'wu' },
          api: { type: 'anthropic-messages', baseUrl: 'https://wu.example' },
          personalModelIds: ['glm-5.3', 'glm-5.3-flash'],
        },
      },
    ],
  },
});

beforeEach(() => {
  setZcodeHomeDirForTests(null);
  delete process.env.ZCODE_CREDENTIAL_SECRET;
});

afterEach(async () => {
  setZcodeHomeDirForTests(null);
  delete process.env.ZCODE_CREDENTIAL_SECRET;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('ZCode models list every api-key provider in providerOrder and default to the first model', async () => {
  const storageDir = await makeStorageDir();
  await writeProviderConfig(storageDir, personalConfig());
  // Legacy labels are reused when present; unlabeled ids fall back to the id.
  await writeLegacyConfig(storageDir, {
    provider: { deepseek: { models: { 'deepseek-v4-pro': { name: 'DeepSeek V4 Pro' } } } },
  });

  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), {
    OPTIONS: [
      {
        value: 'deepseek/deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'Frontier DeepSeek model for complex coding and research.',
        group: 'DeepSeek',
      },
      {
        value: 'deepseek/deepseek-v4-flash',
        label: 'deepseek-v4-flash',
        description: 'Fast and affordable DeepSeek coding model.',
        group: 'DeepSeek',
      },
      {
        value: 'wuanai/glm-5.3',
        label: 'glm-5.3',
        description: '积分/百万 · 输入 140 · 输出 440',
        group: 'wuanai',
      },
      {
        value: 'wuanai/glm-5.3-flash',
        label: 'glm-5.3-flash',
        description: '积分/百万 · 输入 15 · 输出 50',
        group: 'wuanai',
      },
    ],
    DEFAULT: 'deepseek/deepseek-v4-pro',
  });
  assert.deepEqual(await new ZcodeProviderModels().getCurrentActiveModel(), {
    model: 'deepseek/deepseek-v4-pro',
  });
});

test('ZCode models skip hidden, disabled, non-api-key, and model-less providers', async () => {
  const storageDir = await makeStorageDir();
  await writeProviderConfig(storageDir, {
    providerOrder: ['keep'],
    providerConfigRules: {
      providerRules: [
        { providerId: 'keep', enabled: true, config: { visibility: 'visible', access: { type: 'api-key', apiKey: 'k' }, personalModelIds: ['m'] } },
        { providerId: 'hidden', enabled: true, config: { visibility: 'hidden', access: { type: 'api-key', apiKey: 'h' }, personalModelIds: ['m'] } },
        { providerId: 'disabled', enabled: false, config: { visibility: 'visible', access: { type: 'api-key', apiKey: 'd' }, personalModelIds: ['m'] } },
        { providerId: 'account', enabled: true, config: { visibility: 'visible', access: { type: 'zhipu-account' }, personalModelIds: ['m'] } },
        { providerId: 'modelless', enabled: true, config: { visibility: 'visible', access: { type: 'api-key', apiKey: 'x' } } },
      ],
    },
  });

  assert.deepEqual(loadZcodeModels(), {
    OPTIONS: [{ value: 'keep/m', label: 'm', group: 'keep' }],
    DEFAULT: 'keep/m',
  });
});

test('ZCode models append the official provider when its key can be recovered', async () => {
  const storageDir = await makeStorageDir();
  process.env.ZCODE_CREDENTIAL_SECRET = TEST_SECRET;
  await writeProviderConfig(storageDir, personalConfig());
  await writeCredentials(storageDir, 'official-key-1234567890');

  const catalog = await new ZcodeProviderModels().getSupportedModels();
  // Neither model is in the shared table, so the channel label stands in as the
  // subtitle (the same fallback the other harness adapters use).
  assert.deepEqual(catalog.OPTIONS.slice(-2), [
    { value: 'bigmodel/GLM-5.3', label: 'GLM-5.3', description: 'BigModel', group: 'BigModel' },
    { value: 'bigmodel/GLM-5.3-Flash', label: 'GLM-5.3-Flash', description: 'BigModel', group: 'BigModel' },
  ]);
  // The official provider is appended, never promoted: it must not become the
  // implicit default and silently change what a bare run selects.
  assert.equal(catalog.DEFAULT, 'deepseek/deepseek-v4-pro');
});

test('ZCode models omit the official provider when its key is unrecoverable', async () => {
  const storageDir = await makeStorageDir();
  await writeProviderConfig(storageDir, personalConfig());

  // No credential store at all.
  assert.ok(!loadZcodeModels()?.OPTIONS.some((option) => option.value.startsWith('bigmodel/')));

  // A store whose value is not decryptable under the active secret.
  process.env.ZCODE_CREDENTIAL_SECRET = TEST_SECRET;
  await writeJson(path.join(storageDir, 'v2', 'credentials.json'), {
    [OFFICIAL_KEY_NAME]: 'enc:v1:not.valid.cipher',
  });
  assert.ok(!loadZcodeModels()?.OPTIONS.some((option) => option.value.startsWith('bigmodel/')));
});

test('ZCode models fall back to the curated catalog when the document is missing or unusable', async () => {
  const storageDir = await makeStorageDir();
  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), ZCODE_PREDEFINED_MODELS);
  assert.equal(loadZcodeModels(), null);

  await mkdir(path.join(storageDir, 'v2'), { recursive: true });
  await writeFile(path.join(storageDir, 'v2', 'provider_config.json'), '{ not json', 'utf8');
  assert.deepEqual(await new ZcodeProviderModels().getSupportedModels(), ZCODE_PREDEFINED_MODELS);

  await writeProviderConfig(storageDir, { providerConfigRules: { providerRules: [] } });
  assert.equal(loadZcodeModels(), null);
});

test('resolveZcodeModelEnv returns null when there is nothing to override', async () => {
  const storageDir = await makeStorageDir();
  // No provider document → nothing to mirror.
  assert.equal(resolveZcodeModelEnv('deepseek/deepseek-v4-pro'), null);

  await writeProviderConfig(storageDir, personalConfig());
  assert.equal(resolveZcodeModelEnv('   '), null);
  // The model a bare run already selects is left to the config path.
  assert.equal(resolveZcodeModelEnv('deepseek/deepseek-v4-pro'), null);
});

test('resolveZcodeModelEnv promotes the requested provider and model in a generated copy', async () => {
  const storageDir = await makeStorageDir();
  await writeProviderConfig(storageDir, personalConfig());
  const realConfigPath = path.join(storageDir, 'v2', 'provider_config.json');
  const before = await readFile(realConfigPath, 'utf8');

  const override = resolveZcodeModelEnv('wuanai/glm-5.3-flash');
  assert.ok(override);
  const filePath = override.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  assert.ok(filePath && existsSync(filePath));

  const generated = JSON.parse(await readFile(filePath, 'utf8')) as {
    config: {
      providerOrder: string[];
      providerConfigRules: { providerRules: Array<{ providerId: string; config: { personalModelIds: string[] } }> };
    };
  };
  assert.equal(generated.config.providerOrder[0], 'wuanai');
  assert.equal(generated.config.providerOrder.length, 2, 'the other provider must survive');
  const wuanai = generated.config.providerConfigRules.providerRules
    .find((rule) => rule.providerId === 'wuanai');
  assert.equal(wuanai?.config.personalModelIds[0], 'glm-5.3-flash');

  // Resolving a model never touches the user's own document.
  assert.equal(await readFile(realConfigPath, 'utf8'), before);

  override.cleanup();
  assert.equal(existsSync(filePath), false);
  override.cleanup(); // idempotent
});

test('resolveZcodeModelEnv accepts a model the provider does not declare yet', async () => {
  const storageDir = await makeStorageDir();
  await writeProviderConfig(storageDir, personalConfig());

  const override = resolveZcodeModelEnv('wuanai/brand-new-model');
  assert.ok(override);
  const generated = JSON.parse(await readFile(override.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, 'utf8')) as {
    config: { providerConfigRules: { providerRules: Array<{ providerId: string; config: { personalModelIds: string[] } }> } };
  };
  const wuanai = generated.config.providerConfigRules.providerRules
    .find((rule) => rule.providerId === 'wuanai');
  // The provider itself decides whether the id exists, so it is promoted rather
  // than rejected by the catalog.
  assert.equal(wuanai?.config.personalModelIds[0], 'brand-new-model');
  override.cleanup();
});

test('resolveZcodeModelEnv injects the official provider when selecting an official model', async () => {
  const storageDir = await makeStorageDir();
  process.env.ZCODE_CREDENTIAL_SECRET = TEST_SECRET;
  await writeProviderConfig(storageDir, personalConfig());
  await writeCredentials(storageDir, 'official-key-1234567890');

  const override = resolveZcodeModelEnv('bigmodel/GLM-5.3-Flash');
  assert.ok(override);
  const generated = JSON.parse(await readFile(override.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, 'utf8')) as {
    config: {
      providerOrder: string[];
      providerConfigRules: { providerRules: Array<{ providerId: string; config: { access: { apiKey: string }; api: { baseUrl: string }; personalModelIds: string[] } }> };
    };
  };
  assert.equal(generated.config.providerOrder[0], 'bigmodel');
  const official = generated.config.providerConfigRules.providerRules
    .find((rule) => rule.providerId === 'bigmodel');
  assert.equal(official?.config.access.apiKey, 'official-key-1234567890');
  assert.equal(official?.config.api.baseUrl, 'https://open.bigmodel.cn/api/anthropic');
  assert.equal(official?.config.personalModelIds[0], 'GLM-5.3-Flash');
  override.cleanup();
});

test('resolveZcodeModelEnv rejects a model whose provider the document does not declare', async () => {
  const storageDir = await makeStorageDir();
  await writeProviderConfig(storageDir, personalConfig());

  const expectUnresolved = (model: string) => assert.throws(
    () => resolveZcodeModelEnv(model),
    (error: unknown) => error instanceof AppError && error.code === 'ZCODE_MODEL_CHANNEL_UNRESOLVED',
  );

  // A bare id has no provider at all.
  expectUnresolved('glm-5.3');
  // An unknown provider.
  expectUnresolved('nope/glm-5.3');
  // The official provider is not selectable when its key cannot be recovered.
  expectUnresolved('bigmodel/GLM-5.3');
});

test('ZCode database path honors storage.sessionDbPath with ~ expansion', async () => {
  const storageDir = await makeStorageDir();
  await writeLegacyConfig(storageDir, { storage: { sessionDbPath: '~/custom/zcode.sqlite' } });
  assert.equal(getZcodeDatabasePath(), path.join(os.homedir(), 'custom', 'zcode.sqlite'));

  await writeLegacyConfig(storageDir, {});
  assert.equal(getZcodeDatabasePath(), path.join(storageDir, 'cli', 'db', 'db.sqlite'));
});
