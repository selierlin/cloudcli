import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseDshComposedEntries,
  readDshComposedEntries,
} from '@/modules/providers/list/dsh/dsh-cordis.provider.js';
import {
  DSH_PREDEFINED_MODELS,
  DshProviderModels,
  buildDshModelsFromComposedEntries,
  loadDshSettingsModels,
} from '@/modules/providers/list/dsh/dsh-models.provider.js';

/**
 * DSH resolves its model routes from its composed Cordis configuration, so the
 * picker reads the tree `dsh --profile acp --dump-config` prints (the same
 * source the MCP reader uses), falling back to the legacy `settings.yaml` and
 * then the curated mirror. These tests pin the composed parsing against
 * recorded serializer output, cover the degradation chain, and — when the CLI
 * is installed — the whole read path from a home patch layer.
 */

/** The CLI is an external prerequisite: skip the end-to-end case when it is absent instead of failing. */
const DSH_INSTALLED = spawnSync('dsh', ['--version']).status === 0;

/** A composed read that yields nothing, so a test exercises the non-composer sources. */
const NO_COMPOSED_ENTRIES = (): Record<string, Record<string, unknown>> => ({});

/** Recorded shape of the dump: provenance comments, quoted package names, folded scalars and `!!js` expressions. */
const COMPOSED_DUMP = `# == @deepseek-ai/dsh-base
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: session-telemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config:
    mode: !!js process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'
    exporter:
      url: !!js >-
        process.env.DSH_TELEMETRY_OTLP_URL ??
        'https://example.com/v1/logs'
      retry:
        - 1000
        - 5000
# == @deepseek-ai/dsh-base, patched by /home/dev/.dsh/profiles/acp/cordis.patch.yml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      zhihui:
        displayName: Zhihui
        apiKeyEnv: GATEWAY_API_KEY
        api: openai-completions
        baseURL: https://cn.zhihuiai.top/v1
        compat:
          supportsDeveloperRole: false
        models:
          - id: "gpt-5.6-terra"
          - id: gpt-5.6-luna
      volcano-ark:
        displayName: 火山方舟
        models:
          - id: glm-5.3
          - id: deepseek-v4-flash
# == @deepseek-ai/dsh-base, patched by /home/dev/.dsh/profiles/acp/cordis.patch.yml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: volcano-ark
    model: glm-5.3
- id: mcp-dbhub
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: dbhub
    transport: streamable-http
    url: http://127.0.0.1:8880/mcp
`;

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

/** Runs a test body with `DSH_HOME` pointed at a fresh temp directory seeded with the given files. */
async function withDshHome(
  files: Record<string, string>,
  runTest: (dshHome: string) => void | Promise<void>,
): Promise<void> {
  const previousDshHome = process.env.DSH_HOME;
  const previousDshModel = process.env.DSH_MODEL;
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-models-test-'));
  process.env.DSH_HOME = dshHome;
  delete process.env.DSH_MODEL;
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dshHome, name), content, 'utf8');
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

test('builds the catalog from the composed llm-pi-ai and agent-default-model entries', () => {
  const catalog = buildDshModelsFromComposedEntries(parseDshComposedEntries(COMPOSED_DUMP));

  assert.deepEqual(catalog?.OPTIONS, [
    { value: 'zhihui/gpt-5.6-terra', label: 'gpt-5.6-terra', group: 'zhihui' },
    { value: 'zhihui/gpt-5.6-luna', label: 'gpt-5.6-luna', group: 'zhihui' },
    { value: 'volcano-ark/glm-5.3', label: 'glm-5.3', group: 'Volcano Ark' },
    { value: 'volcano-ark/deepseek-v4-flash', label: 'deepseek-v4-flash', group: 'Volcano Ark' },
  ]);
  assert.equal(catalog?.DEFAULT, 'volcano-ark/glm-5.3');
});

test('defaults to the first composed model when agent-default-model is unknown', () => {
  const entries = parseDshComposedEntries(
    COMPOSED_DUMP.replace('model: glm-5.3', 'model: does-not-exist'),
  );

  assert.equal(buildDshModelsFromComposedEntries(entries)?.DEFAULT, 'zhihui/gpt-5.6-terra');
});

test('returns null when the composed tree declares no llm-pi-ai models', () => {
  for (const document of ['', 'not: a sequence\n', '- id: timer\n  name: x\n']) {
    const entries = parseDshComposedEntries(document);
    assert.equal(
      buildDshModelsFromComposedEntries(entries),
      null,
      `document: ${JSON.stringify(document)}`,
    );
  }

  // An entry that exists but declares no routes is the same as no entry: the
  // picker must fall through instead of rendering an empty list.
  const dormant = parseDshComposedEntries(
    "- id: llm-pi-ai\n  name: '@deepseek-ai/dsh-llm-pi-ai'\n  config:\n    providers: {}\n",
  );
  assert.equal(buildDshModelsFromComposedEntries(dormant), null);
});

test('prefers the composed configuration and applies shared descriptions', async () => {
  await withDshHome({}, async () => {
    const models = await new DshProviderModels(
      () => parseDshComposedEntries(COMPOSED_DUMP),
    ).getSupportedModels();

    assert.deepEqual(
      models.OPTIONS.map(({ value, label, group }) => ({ value, label, group })),
      [
        { value: 'zhihui/gpt-5.6-terra', label: 'gpt-5.6-terra', group: 'zhihui' },
        { value: 'zhihui/gpt-5.6-luna', label: 'gpt-5.6-luna', group: 'zhihui' },
        { value: 'volcano-ark/glm-5.3', label: 'glm-5.3', group: 'Volcano Ark' },
        { value: 'volcano-ark/deepseek-v4-flash', label: 'deepseek-v4-flash', group: 'Volcano Ark' },
      ],
    );
    assert.equal(
      models.OPTIONS[0].description,
      'Balanced agentic coding model for everyday work.',
    );
    assert.equal(models.DEFAULT, 'volcano-ark/glm-5.3');
  });
});

test('falls back to settings.yaml when the composer yields nothing', async () => {
  await withDshHome({ 'settings.yaml': SETTINGS_YAML }, async () => {
    const adapter = new DshProviderModels(NO_COMPOSED_ENTRIES);

    const models = await adapter.getSupportedModels();

    assert.deepEqual(models.OPTIONS, [
      {
        value: 'zhihui/gpt-5.6-terra',
        label: 'gpt-5.6-terra',
        group: 'zhihui',
        description: 'Balanced agentic coding model for everyday work.',
      },
      {
        value: 'zhihui/gpt-5.6-luna',
        label: 'gpt-5.6-luna',
        group: 'zhihui',
        description: 'Fast and affordable agentic coding model.',
      },
      {
        value: 'zhihui/gpt-5.6-sol',
        label: 'gpt-5.6-sol',
        group: 'zhihui',
        description: 'Latest frontier agentic coding model.',
      },
    ]);
    assert.equal(models.DEFAULT, 'zhihui/gpt-5.6-terra');
  });
});

test('a composed tree with no routes does not resurface a stale settings.yaml', async () => {
  await withDshHome({ 'settings.yaml': SETTINGS_YAML }, async () => {
    // The dump succeeded (it carries unrelated entries) but the live profile
    // declares no routes; the picker must show the curated mirror rather than
    // a settings document DSH has already migrated away from.
    const models = await new DshProviderModels(
      () => parseDshComposedEntries(COMPOSED_DUMP.replace('llm-pi-ai', 'llm-unused')),
    ).getSupportedModels();

    assert.deepEqual(
      models.OPTIONS.map(({ value, label }) => ({ value, label })),
      DSH_PREDEFINED_MODELS.OPTIONS.map(({ value, label }) => ({ value, label })),
    );
    assert.equal(models.DEFAULT, DSH_PREDEFINED_MODELS.DEFAULT);
  });
});

test('falls back to the curated catalog when neither source is available', async () => {
  await withDshHome({}, async () => {
    const adapter = new DshProviderModels(NO_COMPOSED_ENTRIES);

    const models = await adapter.getSupportedModels();
    assert.deepEqual(
      models.OPTIONS.map(({ value, label }) => ({ value, label })),
      DSH_PREDEFINED_MODELS.OPTIONS.map(({ value, label }) => ({ value, label })),
    );
    assert.equal(models.DEFAULT, DSH_PREDEFINED_MODELS.DEFAULT);
  });
});

test('falls back to the curated catalog when settings.yaml declares no provider models', async () => {
  await withDshHome(
    { 'settings.yaml': 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n' },
    async () => {
      const adapter = new DshProviderModels(NO_COMPOSED_ENTRIES);

      const models = await adapter.getSupportedModels();
      assert.deepEqual(
        models.OPTIONS.map(({ value, label }) => ({ value, label })),
        DSH_PREDEFINED_MODELS.OPTIONS.map(({ value, label }) => ({ value, label })),
      );
      assert.equal(models.DEFAULT, DSH_PREDEFINED_MODELS.DEFAULT);
    },
  );
});

test('falls back to the curated catalog when settings.yaml is malformed', async () => {
  await withDshHome({ 'settings.yaml': 'llm-pi-ai: [unclosed' }, async () => {
    const adapter = new DshProviderModels(NO_COMPOSED_ENTRIES);

    const models = await adapter.getSupportedModels();
    assert.deepEqual(
      models.OPTIONS.map(({ value, label }) => ({ value, label })),
      DSH_PREDEFINED_MODELS.OPTIONS.map(({ value, label }) => ({ value, label })),
    );
    assert.equal(models.DEFAULT, DSH_PREDEFINED_MODELS.DEFAULT);
  });
});

test('defaults to the first model when agent-default-model is unknown', async () => {
  await withDshHome(
    { 'settings.yaml': SETTINGS_YAML.replace('model: gpt-5.6-terra', 'model: does-not-exist') },
    async () => {
      const adapter = new DshProviderModels(NO_COMPOSED_ENTRIES);

      const models = await adapter.getSupportedModels();

      assert.equal(models.DEFAULT, 'zhihui/gpt-5.6-terra');
    },
  );
});

test('DSH_MODEL overrides the default and prepends unknown values', async () => {
  await withDshHome({ 'settings.yaml': SETTINGS_YAML }, async () => {
    process.env.DSH_MODEL = 'zhihui/gpt-5.6-sol';
    const known = await new DshProviderModels(NO_COMPOSED_ENTRIES).getSupportedModels();
    assert.equal(known.DEFAULT, 'zhihui/gpt-5.6-sol');
    assert.equal(known.OPTIONS.length, 3);

    process.env.DSH_MODEL = 'custom/gpt-x';
    const unknown = await new DshProviderModels(NO_COMPOSED_ENTRIES).getSupportedModels();
    assert.equal(unknown.DEFAULT, 'custom/gpt-x');
    assert.equal(unknown.OPTIONS[0].value, 'custom/gpt-x');
    assert.equal(unknown.OPTIONS[0].group, 'custom');
  });
});

test('parses multiple providers, quoted ids, and inline comments from settings.yaml', async () => {
  await withDshHome({
    'settings.yaml': `
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
`,
  }, async () => {
    const models = await new DshProviderModels(NO_COMPOSED_ENTRIES).getSupportedModels();

    assert.deepEqual(models.OPTIONS, [
      {
        value: 'zhihui/gpt-5.6-terra',
        label: 'gpt-5.6-terra',
        group: 'zhihui',
        description: 'Balanced agentic coding model for everyday work.',
      },
      {
        value: 'zhihui/gpt-5.6-luna',
        label: 'gpt-5.6-luna',
        group: 'zhihui',
        description: 'Fast and affordable agentic coding model.',
      },
      {
        value: 'second/custom-x',
        label: 'custom-x',
        group: 'second',
        description: 'second',
      },
    ]);
    assert.equal(models.DEFAULT, 'second/custom-x');
  });
});

test('keeps same-named models from different channels distinguishable', async () => {
  await withDshHome({
    'settings.yaml': `
llm-pi-ai:
  providers:
    volcano-ark:
      models:
        - id: glm-5.3
        - id: deepseek-v4-flash
    workbuddy:
      models:
        - id: glm-5.3
        - id: deepseek-v4-flash
agent-default-model:
  provider: volcano-ark
  model: glm-5.3
`,
  }, async () => {
    const models = await new DshProviderModels(NO_COMPOSED_ENTRIES).getSupportedModels();

    // Both channels keep their own row; `group` is what tells the two apart in the picker.
    const glm = models.OPTIONS.filter((option) => option.label === 'glm-5.3');
    assert.deepEqual(
      glm.map((option) => [option.value, option.group]),
      [
        ['volcano-ark/glm-5.3', 'Volcano Ark'],
        ['workbuddy/glm-5.3', 'WorkBuddy'],
      ],
    );
  });
});

test('ignores nested bare-key config blocks such as compat', async () => {
  await withDshHome({
    'settings.yaml': `
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
`,
  }, async () => {
    const models = await new DshProviderModels(NO_COMPOSED_ENTRIES).getSupportedModels();

    assert.deepEqual(models.OPTIONS, [
      {
        value: 'zhihui/gpt-5.6-terra',
        label: 'gpt-5.6-terra',
        group: 'zhihui',
        description: 'Balanced agentic coding model for everyday work.',
      },
    ]);
    assert.equal(models.DEFAULT, 'zhihui/gpt-5.6-terra');
  });
});

test('loadDshSettingsModels returns null when the file cannot be read', async () => {
  await withDshHome({}, async () => {
    assert.equal(loadDshSettingsModels(), null);
  });
});

test('reads no composed entries when the CLI cannot be started', async () => {
  await withDshHome({}, async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      assert.deepEqual(readDshComposedEntries(), {});
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test('lists the routes the harness composes for the booted profile', { skip: !DSH_INSTALLED }, async () => {
  await withDshHome({
    'cordis.patch.yml': `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      e2e-gateway:
        displayName: E2E Gateway
        apiKeyEnv: E2E_KEY
        api: openai-completions
        baseURL: https://e2e.example.com/v1
        models:
          - id: e2e-model-a
          - id: e2e-model-b
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: e2e-gateway
    model: e2e-model-b
`,
  }, async () => {
    const models = await new DshProviderModels(readDshComposedEntries).getSupportedModels();

    const values = models.OPTIONS
      .map((option) => option.value)
      .filter((value) => value.startsWith('e2e-gateway/'));
    assert.deepEqual(values, ['e2e-gateway/e2e-model-a', 'e2e-gateway/e2e-model-b']);
    assert.equal(models.DEFAULT, 'e2e-gateway/e2e-model-b');
  });
});
