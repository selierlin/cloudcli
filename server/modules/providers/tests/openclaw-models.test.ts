import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import {
  OPENCLAW_PREDEFINED_MODELS,
  OpenclawProviderModels,
  getOpenclawAgentDbPath,
  getOpenclawAgentIdFromSessionKey,
  getOpenclawAgentIds,
  getOpenclawAgentsDir,
  getOpenclawConfigPath,
  getOpenclawHomeDir,
  getOpenclawWorkspaceDir,
  loadOpenclawModels,
  readOpenclawConfig,
  setOpenclawHomeDirForTests,
} from '@/modules/providers/list/openclaw/openclaw-models.provider.js';

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    const run = cleanup;
    cleanup = null;
    await run();
  }
});

/** Isolates OpenClaw's state root under a fresh temp dir. */
async function withOpenclawHome(runTest: (homeDir: string) => Promise<void>): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-models-'));
  setOpenclawHomeDirForTests(homeDir);
  cleanup = async () => {
    setOpenclawHomeDirForTests(null);
    await rm(homeDir, { recursive: true, force: true });
  };
  await runTest(homeDir);
}

const writeConfig = async (homeDir: string, config: unknown): Promise<void> => {
  await mkdir(homeDir, { recursive: true });
  await writeFile(getOpenclawConfigPath(), JSON.stringify(config));
};

test('getOpenclawHomeDir honors OPENCLAW_STATE_DIR and the test override', () => {
  const previous = process.env.OPENCLAW_STATE_DIR;
  try {
    delete process.env.OPENCLAW_STATE_DIR;
    assert.equal(getOpenclawHomeDir(), path.join(os.homedir(), '.openclaw'));

    process.env.OPENCLAW_STATE_DIR = '/custom/state';
    assert.equal(getOpenclawHomeDir(), '/custom/state');

    setOpenclawHomeDirForTests('/forced/state');
    assert.equal(getOpenclawHomeDir(), '/forced/state');
  } finally {
    setOpenclawHomeDirForTests(null);
    if (previous === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previous;
    }
  }
});

test('derived paths hang off the state root', async () => {
  await withOpenclawHome(async (homeDir) => {
    assert.equal(getOpenclawConfigPath(), path.join(homeDir, 'openclaw.json'));
    assert.equal(getOpenclawAgentsDir(), path.join(homeDir, 'agents'));
    assert.equal(getOpenclawAgentDbPath('main'), path.join(homeDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite'));
  });
});

test('getOpenclawAgentIdFromSessionKey parses the agent prefix', () => {
  assert.equal(getOpenclawAgentIdFromSessionKey('agent:main:main'), 'main');
  assert.equal(getOpenclawAgentIdFromSessionKey('agent:work:dingtalk:group:42'), 'work');
  assert.equal(getOpenclawAgentIdFromSessionKey('main'), null);
  assert.equal(getOpenclawAgentIdFromSessionKey('agent::empty'), null);
});

test('getOpenclawAgentIds lists only folders holding a session database', async () => {
  await withOpenclawHome(async (homeDir) => {
    await mkdir(path.dirname(getOpenclawAgentDbPath('main')), { recursive: true });
    await writeFile(getOpenclawAgentDbPath('main'), '');
    // A channel-only folder with no store must be ignored.
    await mkdir(path.join(homeDir, 'agents', '__default__'), { recursive: true });

    assert.deepEqual(getOpenclawAgentIds(), ['main']);
  });
});

test('getOpenclawAgentIds returns an empty list when the agents dir is missing', async () => {
  await withOpenclawHome(async () => {
    assert.deepEqual(getOpenclawAgentIds(), []);
  });
});

test('loadOpenclawModels builds the catalog and default from openclaw.json', async () => {
  await withOpenclawHome(async (homeDir) => {
    await writeConfig(homeDir, {
      agents: { defaults: { model: { primary: 'ark/deepseek-v4-flash' } } },
      models: {
        providers: {
          ark: { models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
          deepseek: { models: [{ id: 'deepseek-v4-pro' }] },
        },
      },
    });

    const catalog = loadOpenclawModels();
    assert.ok(catalog);
    assert.deepEqual(catalog.OPTIONS.map((option) => option.value), [
      'ark/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
    ]);
    assert.equal(catalog.OPTIONS[0].label, 'DeepSeek V4 Flash');
    assert.equal(catalog.OPTIONS[0].group, 'ark');
    assert.equal(catalog.OPTIONS[1].label, 'deepseek-v4-pro');
    assert.equal(catalog.DEFAULT, 'ark/deepseek-v4-flash');
  });
});

test('loadOpenclawModels returns null when no model is declared', async () => {
  await withOpenclawHome(async (homeDir) => {
    assert.equal(readOpenclawConfig(), null);
    assert.equal(loadOpenclawModels(), null);

    await writeConfig(homeDir, { models: { providers: { ark: { models: [] } } } });
    assert.equal(loadOpenclawModels(), null);
  });
});

test('OpenclawProviderModels falls back to the curated mirror', async () => {
  await withOpenclawHome(async () => {
    const models = await new OpenclawProviderModels().getSupportedModels();
    assert.equal(models.OPTIONS.length, OPENCLAW_PREDEFINED_MODELS.OPTIONS.length);
    assert.equal(models.DEFAULT, OPENCLAW_PREDEFINED_MODELS.DEFAULT);
  });
});

test('getCurrentActiveModel prefers the configured default, else the catalog default', async () => {
  await withOpenclawHome(async (homeDir) => {
    // No config: falls back to the predefined model.
    assert.deepEqual(await new OpenclawProviderModels().getCurrentActiveModel(), {
      model: OPENCLAW_PREDEFINED_MODELS.DEFAULT,
    });

    await writeConfig(homeDir, {
      agents: { defaults: { model: { primary: 'deepseek/deepseek-v4-pro' } } },
      models: { providers: { deepseek: { models: [{ id: 'deepseek-v4-pro' }] } } },
    });
    assert.deepEqual(await new OpenclawProviderModels().getCurrentActiveModel(), {
      model: 'deepseek/deepseek-v4-pro',
    });
  });
});

test('getOpenclawWorkspaceDir reads agents.defaults.workspace', async () => {
  await withOpenclawHome(async (homeDir) => {
    await writeConfig(homeDir, { agents: { defaults: { workspace: '/srv/agent' } } });
    assert.equal(getOpenclawWorkspaceDir(), '/srv/agent');

    await writeConfig(homeDir, { agents: { defaults: {} } });
    assert.equal(getOpenclawWorkspaceDir(), null);
  });
});
