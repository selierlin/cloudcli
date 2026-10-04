import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySharedModelDescriptions,
  MODEL_DESCRIPTIONS,
  CHANNEL_MODEL_DESCRIPTIONS,
  resolveChannelFromProfileFile,
  resolveChannelLabel,
} from '@/shared/model-descriptions.js';

test('fills missing subtitles from the shared catalog and keeps existing ones', () => {
  const options = applySharedModelDescriptions([
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { value: 'zhihui/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    { value: 'auto', label: 'Auto', description: '积分倍率 0.29x（夜间折扣）' },
    { value: 'unknown-model', label: 'unknown-model' },
  ]);

  assert.equal(options[0].description, 'Latest frontier agentic coding model.');
  assert.equal(options[1].description, 'Frontier DeepSeek model for complex coding and research.');
  assert.equal(options[2].description, '积分倍率 0.29x（夜间折扣）');
  assert.equal(options[3].description, undefined);
});

test('resolves known channel ids to canonical vendor names and keeps unknown ids raw', () => {
  assert.equal(resolveChannelLabel('workbuddy'), 'WorkBuddy');
  assert.equal(resolveChannelLabel('volcano-ark'), 'Volcano Ark');
  assert.equal(resolveChannelLabel('some-custom-gateway'), 'some-custom-gateway');
});

test('prefers channel-qualified descriptions for a scoped catalog', () => {
  const options = applySharedModelDescriptions(
    [
      { value: 'glm-5.3', label: 'GLM-5.3' },
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    ],
    'workbuddy',
  );

  assert.equal(options[0].description, CHANNEL_MODEL_DESCRIPTIONS['workbuddy/glm-5.3']);
  // Not on the WorkBuddy gateway, so the generic shared description applies.
  assert.equal(options[1].description, MODEL_DESCRIPTIONS['gpt-5.6-sol']);
});

test('derives channel tags from single-channel profile file names', () => {
  assert.equal(resolveChannelFromProfileFile('settings-wuanai-glm.json'), 'wuanai');
  assert.equal(resolveChannelFromProfileFile('config-ark.toml'), 'ark');
  assert.equal(resolveChannelFromProfileFile('/any/dir/config-volcano-ark.toml'), 'Volcano Ark');
  // Plain base names carry no channel signal.
  assert.equal(resolveChannelFromProfileFile('settings.json'), null);
  assert.equal(resolveChannelFromProfileFile('config.toml'), null);
  assert.equal(resolveChannelFromProfileFile(null), null);
});

