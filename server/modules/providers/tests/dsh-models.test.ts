import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DSH_PREDEFINED_MODELS,
  DshProviderModels,
  loadDshSettingsModels,
} from '@/modules/providers/list/dsh/dsh-models.provider.js';

/** Runs a test body with `DSH_HOME` pointed at a fresh temp directory. */
async function withDshHome(
  settingsYaml: string | null,
  runTest: (dshHome: string) => void | Promise<void>,
): Promise<void> {
  const previousDshHome = process.env.DSH_HOME;
  const previousDshModel = process.env.DSH_MODEL;
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-models-test-'));
  process.env.DSH_HOME = dshHome;
  delete process.env.DSH_MODEL;
  if (settingsYaml !== null) {
    await writeFile(path.join(dshHome, 'settings.yaml'), settingsYaml, 'utf8');
  }

  try {
    await runTest(dshHome);
  } finally {
    if (previousDshHome === undefined) {
      delete process.env.DSH_HOME;
    } else {
      process.env.DSH_HOME = previousDshHome;
    }
    if (previousDshModel === undefined) {
      delete process.env.DSH_MODEL;
    } else {
      process.env.DSH_MODEL = previousDshModel;
    }
    await rm(dshHome, { recursive: true, force: true });
  }
}

const SETTINGS_YAML = `
llm-pi-ai:
  providers:
    zhihui:
      apiKeyEnv: GATEWAY_API_KEY
      baseURL: https://cn.zhihuiai.top/v1
      models:
        - id: gpt-5.6-terra
        - id: gpt-5.6-luna
        - id: gpt-5.6-sol
agent-default-model:
  provider: zhihui
  model: gpt-5.6-terra
`;

test('loads the provider catalog and default from $DSH_HOME/settings.yaml', async () => {
  await withDshHome(SETTINGS_YAML, async () => {
    const adapter = new DshProviderModels();

    const models = await adapter.getSupportedModels();

    assert.deepEqual(models, {
      OPTIONS: [
        { value: 'zhihui/gpt-5.6-terra', label: 'gpt-5.6-terra' },
        { value: 'zhihui/gpt-5.6-luna', label: 'gpt-5.6-luna' },
        { value: 'zhihui/gpt-5.6-sol', label: 'gpt-5.6-sol' },
      ],
      DEFAULT: 'zhihui/gpt-5.6-terra',
    });
  });
});

test('falls back to the curated catalog when settings.yaml is missing', async () => {
  await withDshHome(null, async () => {
    const adapter = new DshProviderModels();

    assert.deepEqual(await adapter.getSupportedModels(), DSH_PREDEFINED_MODELS);
  });
});

test('falls back to the curated catalog when settings.yaml declares no provider models', async () => {
  await withDshHome('ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', async () => {
    const adapter = new DshProviderModels();

    assert.deepEqual(await adapter.getSupportedModels(), DSH_PREDEFINED_MODELS);
  });
});

test('falls back to the curated catalog when settings.yaml is malformed', async () => {
  await withDshHome('llm-pi-ai: [unclosed', async () => {
    const adapter = new DshProviderModels();

    assert.deepEqual(await adapter.getSupportedModels(), DSH_PREDEFINED_MODELS);
  });
});

test('defaults to the first model when agent-default-model is unknown', async () => {
  await withDshHome(
    SETTINGS_YAML.replace('model: gpt-5.6-terra', 'model: does-not-exist'),
    async () => {
      const adapter = new DshProviderModels();

      const models = await adapter.getSupportedModels();

      assert.equal(models.DEFAULT, 'zhihui/gpt-5.6-terra');
    },
  );
});

test('DSH_MODEL overrides the default and prepends unknown values', async () => {
  await withDshHome(SETTINGS_YAML, async () => {
    process.env.DSH_MODEL = 'zhihui/gpt-5.6-sol';
    const known = await new DshProviderModels().getSupportedModels();
    assert.equal(known.DEFAULT, 'zhihui/gpt-5.6-sol');
    assert.equal(known.OPTIONS.length, 3);

    process.env.DSH_MODEL = 'custom/gpt-x';
    const unknown = await new DshProviderModels().getSupportedModels();
    assert.equal(unknown.DEFAULT, 'custom/gpt-x');
    assert.equal(unknown.OPTIONS[0].value, 'custom/gpt-x');
  });
});

test('parses multiple providers, quoted ids, and inline comments', async () => {
  await withDshHome(`
llm-pi-ai:
  providers:
    zhihui:
      models:
        - id: "gpt-5.6-terra"   # main gateway
        - id: gpt-5.6-luna
    second:
      models:
        - id: 'custom-x'   # fallback
agent-default-model:
  provider: second
  model: custom-x
`, async () => {
    const models = await new DshProviderModels().getSupportedModels();

    assert.deepEqual(models.OPTIONS, [
      { value: 'zhihui/gpt-5.6-terra', label: 'gpt-5.6-terra' },
      { value: 'zhihui/gpt-5.6-luna', label: 'gpt-5.6-luna' },
      { value: 'second/custom-x', label: 'custom-x' },
    ]);
    assert.equal(models.DEFAULT, 'second/custom-x');
  });
});

test('ignores nested bare-key config blocks such as compat', async () => {
  await withDshHome(`
llm-pi-ai:
  providers:
    zhihui:
      apiKeyEnv: GATEWAY_API_KEY
      compat:
        supportsDeveloperRole: false
      models:
        - id: gpt-5.6-terra
agent-default-model:
  provider: zhihui
  model: gpt-5.6-terra
`, async () => {
    const models = await new DshProviderModels().getSupportedModels();

    assert.deepEqual(models.OPTIONS, [
      { value: 'zhihui/gpt-5.6-terra', label: 'gpt-5.6-terra' },
    ]);
    assert.equal(models.DEFAULT, 'zhihui/gpt-5.6-terra');
  });
});

test('loadDshSettingsModels returns null when the file cannot be read', async () => {
  await withDshHome(null, async () => {
    assert.equal(loadDshSettingsModels(), null);
  });
});
