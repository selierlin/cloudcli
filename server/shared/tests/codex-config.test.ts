import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveCodexConfigOverrides, toCodexConfigArgs } from '@/shared/codex-config.js';

async function withTempDirectory(runTest: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-config-'));
  try {
    await runTest(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('resolveCodexConfigOverrides forwards only the whitelisted keys', async () => {
  await withTempDirectory(async (directory) => {
    const profilePath = path.join(directory, 'config-mimo.toml');
    const basePath = path.join(directory, 'config.toml');

    await writeFile(profilePath, [
      'model_provider = "custom"',
      'model = "mimo-v2.5-pro"',
      'model_reasoning_effort = "high"',
      'disable_response_storage = true',
      'model_catalog_json = "cc-switch-model-catalog.json"',
      'web_search = "disabled"',
      '',
      '[model_providers.custom]',
      'name = "xiaomi_mimo"',
      'base_url = "https://api.xiaomimimo.com/v1"',
      '',
      '[mcp_servers.node_repl]',
      'command = "node"',
      '',
      '[projects."/tmp/example"]',
      'trust_level = "trusted"',
      '',
      '[plugins."pdf@openai-primary-runtime"]',
      'enabled = true',
    ].join('\n'), 'utf8');

    await writeFile(basePath, [
      'model_provider = "custom"',
      'model = "ark-code-latest"',
      '',
      '[model_providers.custom]',
      'name = "ark_codingplan"',
      'base_url = "https://ark.cn-beijing.volces.com/api/coding/v3"',
    ].join('\n'), 'utf8');

    const overrides = await resolveCodexConfigOverrides(profilePath, basePath);

    assert.deepEqual(overrides, {
      model_provider: 'cloudcli__custom',
      model: 'mimo-v2.5-pro',
      model_reasoning_effort: 'high',
      disable_response_storage: true,
      // Resolved against the declaring file, not CODEX_HOME.
      model_catalog_json: path.join(directory, 'cc-switch-model-catalog.json'),
      web_search: 'disabled',
      model_providers: {
        cloudcli__custom: {
          name: 'xiaomi_mimo',
          base_url: 'https://api.xiaomimimo.com/v1',
        },
      },
    });
  });
});

test('resolveCodexConfigOverrides keeps a provider key the base config does not define', async () => {
  await withTempDirectory(async (directory) => {
    const profilePath = path.join(directory, 'config-mimo.toml');
    const basePath = path.join(directory, 'config.toml');

    await writeFile(profilePath, [
      'model_provider = "mimo"',
      'model = "mimo-v2.5-pro"',
      '',
      '[model_providers.mimo]',
      'base_url = "https://api.xiaomimimo.com/v1"',
    ].join('\n'), 'utf8');
    await writeFile(basePath, 'model = "gpt-5.6-sol"\n', 'utf8');

    const overrides = await resolveCodexConfigOverrides(profilePath, basePath);

    assert.deepEqual(overrides, {
      model_provider: 'mimo',
      model: 'mimo-v2.5-pro',
      model_providers: {
        mimo: { base_url: 'https://api.xiaomimimo.com/v1' },
      },
    });
  });
});

test('resolveCodexConfigOverrides tolerates a missing base config', async () => {
  await withTempDirectory(async (directory) => {
    const profilePath = path.join(directory, 'config-mimo.toml');
    await writeFile(profilePath, [
      'model_provider = "custom"',
      'model = "mimo-v2.5-pro"',
      '',
      '[model_providers.custom]',
      'base_url = "https://api.xiaomimimo.com/v1"',
    ].join('\n'), 'utf8');

    const overrides = await resolveCodexConfigOverrides(
      profilePath,
      path.join(directory, 'does-not-exist.toml'),
    );

    assert.deepEqual(overrides, {
      model_provider: 'custom',
      model: 'mimo-v2.5-pro',
      model_providers: {
        custom: { base_url: 'https://api.xiaomimimo.com/v1' },
      },
    });
  });
});

test('resolveCodexConfigOverrides returns null for unusable profiles', async () => {
  await withTempDirectory(async (directory) => {
    const missing = await resolveCodexConfigOverrides(path.join(directory, 'absent.toml'));
    assert.equal(missing, null);

    const emptyPath = path.join(directory, 'config-empty.toml');
    await writeFile(emptyPath, '', 'utf8');
    assert.equal(await resolveCodexConfigOverrides(emptyPath), null);

    // A profile that only carries keys outside the whitelist contributes nothing.
    const unrelatedPath = path.join(directory, 'config-unrelated.toml');
    await writeFile(unrelatedPath, '[mcp_servers.node_repl]\ncommand = "node"\n', 'utf8');
    assert.equal(await resolveCodexConfigOverrides(unrelatedPath), null);
  });
});

test('toCodexConfigArgs flattens overrides into dotted -c pairs', () => {
  const args = toCodexConfigArgs({
    model_provider: 'volcano-ark',
    model: 'ark-code-latest',
    model_reasoning_effort: 'low',
    disable_response_storage: true,
    model_providers: {
      'volcano-ark': {
        name: 'ark_codingplan',
        base_url: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        wire_api: 'responses',
        requires_openai_auth: true,
        experimental_bearer_token: 'ark-token',
        http_headers: { 'X-Trace': 'on' },
        request_max_retries: 3,
      },
    },
  });

  assert.deepEqual(args, [
    '-c', 'model_provider="volcano-ark"',
    '-c', 'model="ark-code-latest"',
    '-c', 'model_reasoning_effort="low"',
    '-c', 'disable_response_storage=true',
    '-c', 'model_providers.volcano-ark.name="ark_codingplan"',
    '-c', 'model_providers.volcano-ark.base_url="https://ark.cn-beijing.volces.com/api/coding/v3"',
    '-c', 'model_providers.volcano-ark.wire_api="responses"',
    '-c', 'model_providers.volcano-ark.requires_openai_auth=true',
    '-c', 'model_providers.volcano-ark.experimental_bearer_token="ark-token"',
    '-c', 'model_providers.volcano-ark.http_headers.X-Trace="on"',
    '-c', 'model_providers.volcano-ark.request_max_retries=3',
  ]);
});

test('toCodexConfigArgs quotes keys TOML would not accept bare', () => {
  const args = toCodexConfigArgs({
    model_providers: {
      'my provider': { 'base url': ['https://a.test', 'https://b.test'] },
    },
  });

  assert.deepEqual(args, [
    '-c', 'model_providers."my provider"."base url"=["https://a.test", "https://b.test"]',
  ]);
});
