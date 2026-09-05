import assert from 'node:assert/strict';
import test from 'node:test';

import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';

test('mapCliOptionsToSDK sets sdkOptions.settings to the configured settings file', () => {
  const sdkOptions = mapCliOptionsToSDK({
    model: 'sonnet',
    effort: 'high',
    settingsFile: '/relay/settings-glm.json',
    effortModels: CLAUDE_PREDEFINED_MODELS,
  });

  assert.equal(sdkOptions.settings, '/relay/settings-glm.json');
});

test('mapCliOptionsToSDK leaves settings unset without a settings file', () => {
  const sdkOptions = mapCliOptionsToSDK({
    model: 'sonnet',
    effort: 'high',
    effortModels: CLAUDE_PREDEFINED_MODELS,
  });

  assert.equal(sdkOptions.settings, undefined);
});

test('mapCliOptionsToSDK ignores an empty settings file value', () => {
  const sdkOptions = mapCliOptionsToSDK({
    model: 'sonnet',
    effort: 'high',
    settingsFile: '   ',
    effortModels: CLAUDE_PREDEFINED_MODELS,
  });

  assert.equal(sdkOptions.settings, undefined);
});

test('mapCliOptionsToSDK keeps the ultracode inline settings object over a settings file', () => {
  const sdkOptions = mapCliOptionsToSDK({
    model: 'sonnet',
    effort: 'ultracode',
    settingsFile: '/relay/settings-glm.json',
    effortModels: CLAUDE_PREDEFINED_MODELS,
  });

  // The SDK accepts either a path string OR an inline object — a file must not
  // silently clobber the ultracode object applyClaudeEffort produced.
  assert.equal(typeof sdkOptions.settings, 'object');
  assert.equal((sdkOptions.settings as { ultracode?: boolean }).ultracode, true);
  assert.notEqual(sdkOptions.settings, '/relay/settings-glm.json');
});
