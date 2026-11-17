import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appConfigDb, closeConnection, initializeDatabase } from '@/modules/database/index.js';
import {
  ClaudeProviderModels,
  CLAUDE_PREDEFINED_MODELS,
  CLAUDE_ULTRACODE_EFFORT,
  applyClaudeModelMappings,
  extractClaudeEventModel,
  findClaudeModelOption,
  pickClaudeModelMappings,
} from '@/modules/providers/list/claude/claude-models.provider.js';

const SESSION_ID = 'session-1';

const findOption = (value: string) => {
  const option = CLAUDE_PREDEFINED_MODELS.OPTIONS.find((candidate) => candidate.value === value);
  assert.ok(option, `predefined option ${value} must exist`);
  return option;
};

// Pinned versions as Claude Code's own model picker declares them: id, effort default,
// whether xhigh is offered. `null` marks a model with no effort control.
const PINNED_MODELS: ReadonlyArray<[id: string, defaultEffort: string | null, xhigh: boolean]> = [
  ['claude-fable-5-2', 'medium', true],
  ['claude-fable-5-1', 'high', true],
  ['claude-fable-5', 'high', true],
  ['claude-opus-5-5', 'medium', true],
  ['claude-opus-5', 'high', true],
  ['claude-opus-4-8', 'high', true],
  ['claude-opus-4-7', 'xhigh', true],
  ['claude-opus-4-6', 'high', false],
  ['claude-sonnet-5-5', 'medium', true],
  ['claude-sonnet-5', 'high', true],
  ['claude-sonnet-4-6', 'high', false],
  ['claude-haiku-5-5', 'medium', true],
  ['claude-haiku-4-5-20251001', null, false],
];

test('offers each pinned version with the effort levels and default Claude Code uses for it', () => {
  for (const [id, defaultEffort, xhigh] of PINNED_MODELS) {
    const option = findClaudeModelOption(id);
    assert.ok(option, `${id} is missing from the catalog`);

    if (defaultEffort === null) {
      assert.equal(option.effort, undefined, `${id} should have no effort control`);
      continue;
    }

    const levels = option.effort?.values.map((level) => level.value) ?? [];
    assert.equal(option.effort?.default, defaultEffort, `${id} default effort`);
    assert.ok(levels.includes(defaultEffort), `${id} default must be one of its levels`);
    assert.equal(levels.includes('xhigh'), xhigh, `${id} xhigh`);
  }
});

test('offers ultracode only on xhigh-capable pinned versions outside the Haiku family', () => {
  for (const [id, , xhigh] of PINNED_MODELS) {
    const levels = findClaudeModelOption(id)?.effort?.values.map((level) => level.value) ?? [];
    const expected = xhigh && !id.startsWith('claude-haiku-');
    assert.equal(levels.includes(CLAUDE_ULTRACODE_EFFORT), expected, `${id} ultracode`);
  }
});

test('keeps the aliases first, the default unchanged, and every model id unique', () => {
  const values = CLAUDE_PREDEFINED_MODELS.OPTIONS.map((option) => option.value);

  assert.equal(CLAUDE_PREDEFINED_MODELS.DEFAULT, 'default');
  assert.deepEqual(values.slice(0, 9), [
    'default', 'best', 'fable', 'sonnet', 'sonnet[1m]', 'opus', 'opus[1m]', 'haiku', 'opusplan',
  ]);
  assert.equal(new Set(values).size, values.length);
});

test('offers Haiku the effort levels Claude Code accepts for it, starting at its own default', () => {
  const haikuEffort = findClaudeModelOption('haiku')?.effort;
  const levels = haikuEffort?.values.map((level) => level.value);

  assert.deepEqual(levels, ['low', 'medium', 'high', 'xhigh', 'max']);
  // The level Claude Code runs Haiku at when none is sent, so adding the control changes nothing by itself.
  assert.equal(haikuEffort?.default, 'medium');
  assert.equal(levels?.includes(CLAUDE_ULTRACODE_EFFORT), false);
});

test('ignores the <synthetic> placeholder Claude Code stamps on synthesized rows', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: '<synthetic>' } },
      SESSION_ID,
    ),
    null,
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: '<synthetic>' }, SESSION_ID),
    null,
  );
});

test('still surfaces real model ids from message and event fields', () => {
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { model: 'claude-sonnet-5' } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel({ sessionId: SESSION_ID, model: 'opus' }, SESSION_ID),
    'opus',
  );
});

test('skips a placeholder content part so a later real model tag still wins', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: [
            { text: '<model><synthetic></model>' },
            { text: '<model>claude-sonnet-5</model>' },
          ],
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('a placeholder stdout hit does not shadow a real <model> tag in the same text', () => {
  const text = '<local-command-stdout>Set model to <synthetic></local-command-stdout>'
    + '<model>claude-sonnet-5</model>';
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: text } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
  assert.equal(
    extractClaudeEventModel(
      { sessionId: SESSION_ID, message: { content: [{ text }] } },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('falls back to the message model when every content hit is a placeholder', () => {
  assert.equal(
    extractClaudeEventModel(
      {
        sessionId: SESSION_ID,
        message: {
          content: '<model><synthetic></model>',
          model: 'claude-sonnet-5',
        },
      },
      SESSION_ID,
    ),
    'claude-sonnet-5',
  );
});

test('leaves the catalog untouched when no alias is mapped', () => {
  const annotated = applyClaudeModelMappings(CLAUDE_PREDEFINED_MODELS, {});

  assert.deepEqual(annotated, CLAUDE_PREDEFINED_MODELS);
});

test('relabels a mapped alias with the concrete model and its tier only', () => {
  const annotated = applyClaudeModelMappings(
    CLAUDE_PREDEFINED_MODELS,
    { sonnet: 'doubao-seed-2.1-turbo' },
  );

  const sonnet = annotated.OPTIONS.find((option) => option.value === 'sonnet');
  assert.ok(sonnet);
  assert.equal(sonnet.label, 'doubao-seed-2.1-turbo');
  assert.equal(sonnet.description, 'Sonnet');
  assert.equal(sonnet.value, findOption('sonnet').value);
  assert.deepEqual(sonnet.effort, findOption('sonnet').effort);

  // The 1M variant shares the alias's model, so it keeps the marker.
  const sonnet1m = annotated.OPTIONS.find((option) => option.value === 'sonnet[1m]');
  assert.ok(sonnet1m);
  assert.equal(sonnet1m.label, 'doubao-seed-2.1-turbo (1M context)');
  assert.equal(sonnet1m.description, 'Sonnet');

  // Unmapped aliases keep their predefined display strings.
  const haiku = annotated.OPTIONS.find((option) => option.value === 'haiku');
  assert.ok(haiku);
  assert.equal(haiku.label, findOption('haiku').label);
  assert.equal(haiku.description, findOption('haiku').description);
  assert.equal(annotated.DEFAULT, CLAUDE_PREDEFINED_MODELS.DEFAULT);
});

test('relabels the default option when ANTHROPIC_MODEL is mapped', () => {
  const annotated = applyClaudeModelMappings(
    CLAUDE_PREDEFINED_MODELS,
    { default: 'doubao-seed-evolving' },
  );

  const fallback = annotated.OPTIONS.find((option) => option.value === 'default');
  assert.ok(fallback);
  assert.equal(fallback.label, 'doubao-seed-evolving');
  assert.equal(fallback.description, 'Default');
});

test('opusplan lists both mapped targets, and only the mapped one when partial', () => {
  const both = applyClaudeModelMappings(
    CLAUDE_PREDEFINED_MODELS,
    { opus: 'doubao-seed-evolving', sonnet: 'doubao-seed-2.1-turbo' },
  );
  const opusPlanBoth = both.OPTIONS.find((option) => option.value === 'opusplan');
  assert.ok(opusPlanBoth);
  assert.equal(opusPlanBoth.label, 'doubao-seed-evolving / doubao-seed-2.1-turbo');
  assert.equal(opusPlanBoth.description, 'Opus Plan');

  const sonnetOnly = applyClaudeModelMappings(
    CLAUDE_PREDEFINED_MODELS,
    { sonnet: 'doubao-seed-2.1-turbo' },
  );
  const opusPlanSonnet = sonnetOnly.OPTIONS.find((option) => option.value === 'opusplan');
  assert.ok(opusPlanSonnet);
  assert.equal(opusPlanSonnet.label, 'doubao-seed-2.1-turbo');
  assert.equal(opusPlanSonnet.description, 'Opus Plan');
});

test('the predefined catalog itself stays immutable', () => {
  applyClaudeModelMappings(
    CLAUDE_PREDEFINED_MODELS,
    { opus: 'doubao-seed-evolving', sonnet: 'doubao-seed-2.1-turbo', haiku: 'doubao-seed-2.0-lite' },
  );

  assert.equal(
    findOption('opus').label,
    'Opus',
  );
  assert.equal(
    findOption('sonnet').label,
    'Sonnet',
  );
});

test('pickClaudeModelMappings lets earlier sources win per alias', () => {
  const processEnv = { ANTHROPIC_DEFAULT_SONNET_MODEL: 'from-process-env' };
  const activeFileEnv = {
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'from-settings-file',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'doubao-seed-evolving',
  };
  const userSettingsEnv = {
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'from-user-settings',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'from-user-settings',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'doubao-seed-2.0-lite',
  };

  const mappings = pickClaudeModelMappings(processEnv, activeFileEnv, userSettingsEnv);

  assert.deepEqual(mappings, {
    sonnet: 'from-process-env',
    opus: 'doubao-seed-evolving',
    haiku: 'doubao-seed-2.0-lite',
  });
});

test('pickClaudeModelMappings ignores blank, non-string, and unmapped values', () => {
  const mappings = pickClaudeModelMappings({
    ANTHROPIC_MODEL: '   ',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 42,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'doubao-seed-2.0-lite',
  });

  assert.deepEqual(mappings, { haiku: 'doubao-seed-2.0-lite' });
  assert.deepEqual(pickClaudeModelMappings({}), {});
});

test('tags the catalog with the channel named by the active settings profile', async () => {
  // Isolated database: the suite must never touch the host's app config.
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-models-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  appConfigDb.set('claude.settings.activeFile', '/x/settings-wuanai-glm.json');

  try {
    const models = await new ClaudeProviderModels().getSupportedModels();
    assert.ok(models.OPTIONS.length > 0);
    assert.ok(models.OPTIONS.every((option) => option.group === 'wuanai'));
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
