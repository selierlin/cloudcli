import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import {
  OMP_PREDEFINED_MODELS,
  OmpProviderModels,
  getOmpAgentDir,
  getOmpSessionsRoot,
  loadOmpModels,
  resetOmpModelsForTests,
} from '@/modules/providers/list/omp/omp-models.provider.js';
import { resetOmpCommandForTests } from '@/modules/providers/list/omp/omp-auth.provider.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'omp-probe-mock-cli.mjs'),
);
const MISSING_CLI = path.join('/nonexistent', 'omp-missing');

beforeEach(() => {
  resetOmpCommandForTests();
  resetOmpModelsForTests();
  delete process.env.OMP_COMMAND;
  delete process.env.OMP_MODEL;
  delete process.env.OMP_PROFILE;
  delete process.env.MOCK_MODELS;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
});

afterEach(() => {
  resetOmpCommandForTests();
  resetOmpModelsForTests();
  delete process.env.OMP_COMMAND;
  delete process.env.OMP_MODEL;
  delete process.env.OMP_PROFILE;
  delete process.env.MOCK_MODELS;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
});

test('maps the CLI catalog into picker options, channels and effort levels', async () => {
  process.env.OMP_COMMAND = MOCK_CLI;
  delete process.env.MOCK_MODELS;

  const models = await new OmpProviderModels().getSupportedModels();

  assert.deepEqual(models.OPTIONS.map((option) => option.value), [
    'ark/deepseek-v4-flash',
    'deepseek/deepseek-v4-pro',
  ]);
  // The provider tag groups same-named models across channels.
  assert.equal(models.OPTIONS[0].group, 'ark');
  assert.equal(models.OPTIONS[1].group, 'deepseek');
  assert.equal(models.OPTIONS[0].label, 'DeepSeek V4 Flash');
  // Only reasoning models expose the per-model thinking levels OMP reports.
  assert.deepEqual(models.OPTIONS[0].effort?.values.map((entry) => entry.value), [
    'minimal', 'low', 'medium', 'high',
  ]);
  assert.equal(models.OPTIONS[1].effort, undefined);
  assert.equal(models.DEFAULT, 'ark/deepseek-v4-flash');
});

test('falls back to the curated mirror when the catalog cannot be read', async () => {
  for (const mode of ['empty', 'probe_error', 'garbage']) {
    resetOmpModelsForTests();
    process.env.OMP_COMMAND = MOCK_CLI;
    process.env.MOCK_MODELS = mode;

    assert.equal(await loadOmpModels(), null);
    const models = await new OmpProviderModels().getSupportedModels();
    assert.equal(models.OPTIONS.length, OMP_PREDEFINED_MODELS.OPTIONS.length, `mode: ${mode}`);
    assert.equal(models.DEFAULT, OMP_PREDEFINED_MODELS.DEFAULT, `mode: ${mode}`);
  }
});

test('caches the catalog between calls', async () => {
  process.env.OMP_COMMAND = MOCK_CLI;
  const first = await loadOmpModels();
  assert.ok(first && first.length === 2);

  // A broken command must not matter while the cache is warm.
  process.env.OMP_COMMAND = MISSING_CLI;
  resetOmpCommandForTests();
  assert.deepEqual(await loadOmpModels(), first);
});

test('OMP_MODEL overrides the picker default', async () => {
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.OMP_MODEL = 'deepseek/deepseek-v4-pro';

  const models = await new OmpProviderModels().getSupportedModels();
  assert.equal(models.DEFAULT, 'deepseek/deepseek-v4-pro');
  assert.equal(models.OPTIONS.length, 2);
});

test('OMP_MODEL injects a channel-tagged option when absent from the catalog', async () => {
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.OMP_MODEL = 'openrouter/qwen3-coder';

  const models = await new OmpProviderModels().getSupportedModels();
  assert.equal(models.DEFAULT, 'openrouter/qwen3-coder');
  assert.equal(models.OPTIONS[0].value, 'openrouter/qwen3-coder');
  assert.equal(models.OPTIONS[0].group, 'openrouter');
});

test('agent dir prefers OMP_PROFILE, then PI_CODING_AGENT_DIR, then the default', () => {
  assert.equal(getOmpAgentDir(), path.join(os.homedir(), '.omp', 'agent'));

  process.env.PI_CODING_AGENT_DIR = '/custom/agent';
  assert.equal(getOmpAgentDir(), '/custom/agent');

  // A named profile relocates the whole agent directory and outranks the
  // generic override.
  process.env.OMP_PROFILE = 'work';
  assert.equal(getOmpAgentDir(), path.join(os.homedir(), '.omp', 'profiles', 'work', 'agent'));
});

test('sessions root honors the env override, then nests under the agent dir', () => {
  process.env.PI_CODING_AGENT_DIR = '/custom/agent';
  assert.equal(getOmpSessionsRoot(), path.join('/custom/agent', 'sessions'));

  process.env.PI_CODING_AGENT_SESSION_DIR = '/flat/sessions';
  assert.equal(getOmpSessionsRoot(), '/flat/sessions');

  // The session-dir override outranks a profile too.
  process.env.OMP_PROFILE = 'work';
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  assert.equal(getOmpSessionsRoot(), path.join(os.homedir(), '.omp', 'profiles', 'work', 'agent', 'sessions'));
});
