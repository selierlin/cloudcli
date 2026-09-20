import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  OpenCodeProviderModels,
  OPENCODE_PREDEFINED_MODELS,
} from '@/modules/providers/list/opencode/opencode-models.provider.js';

const OPENCODE_ENV_KEYS = ['OPENCODE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

/**
 * Runs one case against a throwaway OpenCode home, so the catalog the adapter
 * reports depends on the fixture rather than on the providers the machine
 * running the suite happens to be logged into.
 */
const withOpenCodeHome = async (
  setUp: (homeDir: string) => Promise<void>,
  runTest: (adapter: OpenCodeProviderModels) => Promise<void>,
): Promise<void> => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-catalog-'));
  const originalHomedir = os.homedir;
  const originalEnv = OPENCODE_ENV_KEYS.map((key) => [key, process.env[key]] as const);

  (os as any).homedir = () => homeDir;
  for (const key of OPENCODE_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await setUp(homeDir);
    await runTest(new OpenCodeProviderModels());
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

const writeOpenCodeAuth = async (homeDir: string, auth: Record<string, unknown>): Promise<void> => {
  const authDir = path.join(homeDir, '.local', 'share', 'opencode');
  await mkdir(authDir, { recursive: true });
  await writeFile(path.join(authDir, 'auth.json'), JSON.stringify(auth), 'utf8');
};

/** Writes a global OpenCode config into the throwaway home. */
const writeOpenCodeConfig = async (
  homeDir: string,
  config: Record<string, unknown>,
): Promise<void> => {
  const configDir = path.join(homeDir, '.config', 'opencode');
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'opencode.json'), JSON.stringify(config), 'utf8');
};

test('OpenCode exposes only the curated predefined catalog', async () => {
  await withOpenCodeHome(async () => {}, async (adapter) => {
    // Nothing readable about this install, so the picker keeps every option
    // rather than coming up empty.
    assert.deepEqual(await adapter.getSupportedModels(), OPENCODE_PREDEFINED_MODELS);
    assert.equal(
      (await adapter.getCurrentActiveModel()).model,
      OPENCODE_PREDEFINED_MODELS.DEFAULT,
    );
  });
  // OpenCode routes by `<providerID>/<modelID>`, so every option has to carry a
  // provider prefix that `opencode models --verbose` reports.
  const providerIds = new Set(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value.split('/')[0]),
  );
  assert.deepEqual([...providerIds].sort(), ['anthropic', 'opencode', 'opencode-go', 'openai'].sort());
  assert.equal(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.every((option) => /^[a-z0-9-]+\/.+/.test(option.value)),
    true,
  );
  assert.equal(
    new Set(OPENCODE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value)).size,
    OPENCODE_PREDEFINED_MODELS.OPTIONS.length,
  );
  assert.equal(OPENCODE_PREDEFINED_MODELS.DEFAULT, 'opencode/gpt-5.6-terra');
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'opencode/claude-opus-5'),
  );
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'anthropic/claude-opus-5'),
  );
  assert.ok(
    OPENCODE_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === 'openai/gpt-5.6'),
  );
  // The Go gateway carries its own provider id, so its models must be curated
  // too - a Go subscriber otherwise authenticates while the picker offers
  // nothing they can run.
  const opencodeGoOptions = OPENCODE_PREDEFINED_MODELS.OPTIONS.filter(
    (option) => option.value.startsWith('opencode-go/'),
  );
  assert.equal(opencodeGoOptions.length, 27);
  assert.ok(opencodeGoOptions.every((option) => option.description === 'OpenCode Go'));
  const glmFlash = opencodeGoOptions.find(
    (option) => option.value === 'opencode-go/glm-5.3-flash',
  );
  assert.ok(glmFlash);
  // Effort choices come from `opencode models --verbose` variants; the runtime
  // turns a selected value into `--variant`, so the values have to match the
  // CLI's exactly.
  assert.deepEqual(
    glmFlash?.effort?.values.map((value) => value.value),
    ['low', 'high', 'max'],
  );
  assert.ok(
    opencodeGoOptions
      .filter((option) => !option.effort)
      .every((option) =>
        ['glm-5.1', 'kimi-k2.6', 'kimi-k2.7-code', 'mimo-v2.5', 'mimo-v2.5-pro',
          'minimax-m2.7', 'qwen3.6-plus', 'qwen3.7-max', 'qwen3.7-plus']
          .includes(option.value.slice('opencode-go/'.length)),
      ),
  );
});

test('OpenCode offers only models the install can route to', async () => {
  // Asking for a provider the user never connected fails the whole run with
  // "Model <id> is not valid", so an OpenCode Zen model must not be offered -
  // or defaulted to - on a machine that only holds an Anthropic key.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['anthropic']);
      assert.ok(catalog.OPTIONS.length > 0);
      assert.equal(catalog.DEFAULT.startsWith('anthropic/'), true);
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
  );

  // A Go subscriber's auth store holds only `opencode-go`, so the whole catalog
  // has to resolve to Go models and the default has to move onto one of them
  // instead of the unreachable Zen default.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, { 'opencode-go': { type: 'api', key: 'test' } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['opencode-go']);
      assert.equal(catalog.OPTIONS.length, 27);
      assert.equal(catalog.DEFAULT, 'opencode-go/grok-4.6');
      assert.ok(catalog.OPTIONS.some((option) => option.value === catalog.DEFAULT));
      assert.equal((await adapter.getCurrentActiveModel()).model, catalog.DEFAULT);
    },
  );

  // The catalog default survives whenever its own provider is connected.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeAuth(homeDir, {
      opencode: { type: 'api', key: 'test' },
      openai: { type: 'oauth' },
    }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds].sort(), ['opencode', 'openai'].sort());
      assert.equal(catalog.DEFAULT, OPENCODE_PREDEFINED_MODELS.DEFAULT);
    },
  );

  // Providers configured rather than logged into count too.
  await withOpenCodeHome(
    (homeDir) => writeOpenCodeConfig(homeDir, { provider: { anthropic: { options: {} } } }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['anthropic']);
    },
  );

  // An API key in the environment is enough on its own.
  await withOpenCodeHome(
    async () => {
      process.env.OPENAI_API_KEY = 'test';
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds], ['openai']);
    },
  );
});

test('OpenCode offers the models a configured provider declares', async () => {
  // A provider carrying its own `provider` block - a subscription gateway such
  // as WorkBuddy, or a self-hosted endpoint - is absent from OpenCode's built-in
  // catalog, so its models exist only in the config. Reading the provider ids
  // alone would filter every one of them out of the picker.
  await withOpenCodeHome(
    (homeDir) =>
      writeOpenCodeConfig(homeDir, {
        provider: {
          workbuddy: {
            npm: '@ai-sdk/openai-compatible',
            name: 'WorkBuddy',
            options: {
              baseURL: 'https://copilot.tencent.com/v2',
              apiKey: '{file:keys/workbuddy.key}',
            },
            models: {
              auto: { name: 'Auto (recommended)' },
              'hy4-preview': { name: 'Hy4 preview', reasoning: true },
              'kimi-k2.7': {},
            },
          },
        },
      }),
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();

      assert.deepEqual(
        catalog.OPTIONS.map((option) => option.value),
        ['workbuddy/auto', 'workbuddy/hy4-preview', 'workbuddy/kimi-k2.7'],
      );
      // The configured list is the only list here, so the default cannot stay
      // on a curated model the CLI would refuse to run.
      assert.equal(catalog.DEFAULT, 'workbuddy/auto');
      assert.equal((await adapter.getCurrentActiveModel()).model, 'workbuddy/auto');

      assert.equal(catalog.OPTIONS[0].label, 'Auto (recommended)');
      assert.equal(catalog.OPTIONS[0].description, 'WorkBuddy');
      // One heading per configured provider keeps same-named models from
      // different gateways apart.
      assert.equal(catalog.OPTIONS[0].group, 'workbuddy');
      // A model without a declared name falls back to the id the CLI routes by.
      assert.equal(catalog.OPTIONS[2].label, 'kimi-k2.7');
    },
  );

  // Curated options keep their place ahead of the configured ones, so an
  // install that still holds a curated provider keeps the shipped ordering.
  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      await writeOpenCodeConfig(homeDir, {
        provider: { deepseek: { models: { 'deepseek-flash': { name: 'DeepSeek Flash' } } } },
      });
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const providerIds = new Set(catalog.OPTIONS.map((option) => option.value.split('/')[0]));

      assert.deepEqual([...providerIds].sort(), ['anthropic', 'deepseek']);
      assert.equal(catalog.OPTIONS[catalog.OPTIONS.length - 1].value, 'deepseek/deepseek-flash');
      assert.equal(catalog.DEFAULT, 'anthropic/claude-opus-5');
    },
  );

  // A configured value that repeats a curated one must not be listed twice.
  await withOpenCodeHome(
    async (homeDir) => {
      await writeOpenCodeAuth(homeDir, { anthropic: { type: 'api', key: 'test' } });
      await writeOpenCodeConfig(homeDir, {
        provider: {
          anthropic: { name: 'My Anthropic', models: { 'claude-opus-5': { name: 'Opus' } } },
        },
      });
    },
    async (adapter) => {
      const catalog = await adapter.getSupportedModels();
      const curated = catalog.OPTIONS.filter(
        (option) => option.value === 'anthropic/claude-opus-5',
      );

      assert.equal(curated.length, 1);
      assert.equal(curated[0].description, 'Anthropic');
      assert.equal(curated[0].group, undefined);
    },
  );
});

const writeOpenCodeSessionDatabase = async (homeDir: string, rows: Array<Record<string, unknown>>) => {
  const dbPath = path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db');
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (
        id text PRIMARY KEY,
        model text,
        agent text,
        directory text,
        time_created integer NOT NULL,
        time_updated integer NOT NULL
      );
    `);
    const insert = db.prepare(
      'INSERT INTO session (id, model, agent, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const [index, row] of rows.entries()) {
      insert.run(
        row.id,
        row.model,
        row.agent ?? null,
        row.directory ?? '/tmp/project',
        row.timeCreated ?? 1700000000000,
        row.timeUpdated ?? 1700000001000 + index,
      );
    }
  } finally {
    db.close();
  }
};

test('OpenCode composes the provider prefix into session model ids', async () => {
  // The lookup translates the app session id through the sessions database,
  // so point it at a throwaway file rather than the developer's real one.
  const tempSessionsDirectory = await mkdtemp(path.join(os.tmpdir(), 'opencode-session-model-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  try {
    closeConnection();
    process.env.DATABASE_PATH = path.join(tempSessionsDirectory, 'auth.db');
    await initializeDatabase();
    // OpenCode stores the provider and model id in separate fields of the
    // session row ({"id":"z-ai/glm-5.3-flash","providerID":"openrouter"}), but
    // the CLI's `--model` flag only resolves the composed
    // `<providerID>/<modelID>` form. Resuming such a session without the prefix
    // fails with an unknown-model server error, which hits OpenRouter users
    // hardest because their model ids carry a slash themselves.
    await withOpenCodeHome(
      (homeDir) => writeOpenCodeSessionDatabase(homeDir, [
        {
          id: 'ses_openrouter',
          model: JSON.stringify({
            id: 'z-ai/glm-5.3-flash',
            providerID: 'openrouter',
            variant: 'default',
          }),
        },
        {
          id: 'ses_qualified',
          // An id that already carries the provider prefix must survive as-is.
          model: JSON.stringify({
            id: 'openrouter/z-ai/glm-5.3-flash',
            providerID: 'openrouter',
          }),
        },
        {
          id: 'ses_plain_string',
          model: 'opencode/gpt-5.6-terra',
        },
      ]),
      async (adapter) => {
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_openrouter')).model,
          'openrouter/z-ai/glm-5.3-flash',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_qualified')).model,
          'openrouter/z-ai/glm-5.3-flash',
        );
        assert.equal(
          (await adapter.getCurrentActiveModel('ses_plain_string')).model,
          'opencode/gpt-5.6-terra',
        );
      },
    );
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempSessionsDirectory, { recursive: true, force: true });
  }
});
