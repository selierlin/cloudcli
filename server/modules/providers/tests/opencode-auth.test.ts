import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { OpenCodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';

/**
 * Every key the adapter falls back to. Cleared per case so the reported status
 * depends on the fixture rather than on the machine running the suite.
 */
const OPENCODE_ENV_KEYS = [
  'OPENCODE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
];

/**
 * Runs one case against a throwaway OpenCode home. The adapter resolves both
 * the auth store and the global config through `os.homedir()`, so redirecting
 * it keeps the machine's own login out of the assertions.
 */
const withOpenCodeHome = async (
  setUp: (homeDir: string) => Promise<void>,
  runTest: (homeDir: string) => Promise<void>,
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-auth-'));
  const originalHomedir = os.homedir;
  const originalEnv = OPENCODE_ENV_KEYS.map((key) => [key, process.env[key]] as const);

  (os as any).homedir = () => homeDir;
  for (const key of OPENCODE_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await setUp(homeDir);
    await runTest(homeDir);
  } finally {
    (os as any).homedir = originalHomedir;
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(homeDir, { recursive: true, force: true });
  }
};

const writeOpenCodeConfig = async (
  homeDir: string,
  config: unknown,
  fileName = 'opencode.json',
): Promise<void> => {
  const configDir = path.join(homeDir, '.config', 'opencode');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, fileName), JSON.stringify(config), 'utf8');
};

const writeOpenCodeAuth = async (homeDir: string, auth: unknown): Promise<void> => {
  const authDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(authDir, { recursive: true });
  await writeFile(path.join(authDir, 'auth.json'), JSON.stringify(auth), 'utf8');
};

/** The shape a dotfiles-managed install writes: the key is a file reference. */
const keyedProviderConfig = {
  provider: {
    workbuddy: {
      npm: '@ai-sdk/openai-compatible',
      name: 'WorkBuddy',
      options: {
        baseURL: 'https://copilot.tencent.com/v2',
        apiKey: '{file:/home/user/.config/opencode/keys/workbuddy.key}',
      },
      models: { auto: { name: 'Auto (recommended)' } },
    },
  },
};

test('OpenCode counts a provider declared in the global config as connected', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeConfig(homeDir, keyedProviderConfig),
    async () => {
      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'opencode_config');
      // The settings card prints `email` as "logged in as X", so a config
      // provider has to report no account rather than a provider id dressed
      // up as one.
      assert.equal(status.email, null);
      assert.equal(status.error, undefined);
    },
  );
});

test('OpenCode keeps reading the auth store', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'secret' } }),
    async () => {
      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'credentials_file');
    },
  );
});

test('OpenCode prefers the auth store over a config provider', async () => {
  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'secret' } });
      await writeOpenCodeConfig(homeDir, keyedProviderConfig);
    },
    async () => {
      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'credentials_file');
      assert.equal(status.email, 'anthropic credentials');
    },
  );
});

test('OpenCode treats OPENCODE_API_KEY as a credential', async () => {
  await withOpenCodeHome(
    async () => {},
    async () => {
      process.env.OPENCODE_API_KEY = 'secret';

      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'environment');
    },
  );
});

test('OpenCode skips an unreadable config file and keeps looking', async () => {
  await withOpenCodeHome(
    async (homeDir) => {
      // `config.json` is loaded first and holds invalid JSON here (a `.jsonc`
      // file may carry comments, which JSON.parse rejects), so the file that
      // actually declares the provider is only reached if the broken one is
      // skipped rather than ending the search. The invalid bytes are written
      // raw: JSON.stringify would turn them into a valid JSON string.
      const configDir = path.join(homeDir, '.config', 'opencode');
      await mkdir(configDir, { recursive: true });
      await writeFile(path.join(configDir, 'config.json'), '{ not json', 'utf8');
      await writeOpenCodeConfig(homeDir, keyedProviderConfig, 'opencode.json');
    },
    async () => {
      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, true);
      assert.equal(status.method, 'opencode_config');
    },
  );
});

test('OpenCode does not treat a provider block without options as connected', async () => {
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeConfig(homeDir, {
      provider: {
        opencode: { models: { 'gpt-5.6-terra': { name: 'GPT-5.6 Terra' } } },
        zen: { options: {} },
      },
    }),
    async () => {
      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, false);
      assert.equal(status.method, null);
      assert.equal(status.error, 'OpenCode not configured');
    },
  );
});

test('OpenCode reports not configured when nothing declares credentials', async () => {
  await withOpenCodeHome(
    async () => {},
    async () => {
      const status = await new OpenCodeProviderAuth().getStatus();

      assert.equal(status.authenticated, false);
      assert.equal(status.method, null);
      assert.equal(status.error, 'OpenCode not configured');
    },
  );
});
