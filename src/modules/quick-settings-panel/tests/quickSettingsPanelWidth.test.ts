import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  QUICK_SETTINGS_PANEL_WIDTH_DEFAULT,
  QUICK_SETTINGS_PANEL_WIDTH_MAX,
  QUICK_SETTINGS_PANEL_WIDTH_MIN,
  clampQuickSettingsPanelWidth,
  parseQuickSettingsPanelWidth,
  resolveQuickSettingsPanelWidthMax,
} from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelWidth';

test('the panel width is clamped to the supported range', () => {
  assert.equal(clampQuickSettingsPanelWidth(QUICK_SETTINGS_PANEL_WIDTH_MIN - 100, 1600), QUICK_SETTINGS_PANEL_WIDTH_MIN);
  assert.equal(clampQuickSettingsPanelWidth(QUICK_SETTINGS_PANEL_WIDTH_MAX + 100, 1600), QUICK_SETTINGS_PANEL_WIDTH_MAX);
  assert.equal(clampQuickSettingsPanelWidth(320.6, 1600), 321);
});

test('a narrow window lowers the ceiling to half of it', () => {
  assert.equal(resolveQuickSettingsPanelWidthMax(900), 450);
  assert.equal(clampQuickSettingsPanelWidth(500, 900), 450);
  // A wide window keeps the absolute cap.
  assert.equal(resolveQuickSettingsPanelWidthMax(2400), QUICK_SETTINGS_PANEL_WIDTH_MAX);
});

test('a viewport narrower than twice the minimum keeps the range non-empty', () => {
  // 300px of window would cap the panel at 150px; the minimum wins instead.
  assert.equal(resolveQuickSettingsPanelWidthMax(300), QUICK_SETTINGS_PANEL_WIDTH_MIN);
  assert.equal(clampQuickSettingsPanelWidth(500, 300), QUICK_SETTINGS_PANEL_WIDTH_MIN);
});

test('a stored width is restored, and a broken one falls back to the default', () => {
  assert.equal(parseQuickSettingsPanelWidth('420', 1600), 420);
  assert.equal(parseQuickSettingsPanelWidth('9999', 1600), QUICK_SETTINGS_PANEL_WIDTH_MAX);
  assert.equal(parseQuickSettingsPanelWidth('10', 1600), QUICK_SETTINGS_PANEL_WIDTH_MIN);
  assert.equal(parseQuickSettingsPanelWidth(null, 1600), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  assert.equal(parseQuickSettingsPanelWidth(undefined, 1600), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  assert.equal(parseQuickSettingsPanelWidth('wide, please', 1600), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  // A numeric prefix is not a width: '420px' is as broken as 'wide, please'.
  assert.equal(parseQuickSettingsPanelWidth('420px', 1600), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  assert.equal(parseQuickSettingsPanelWidth('', 1600), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
});

test('the default matches the overlay width the panel had before pinning existed', () => {
  assert.equal(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT, 320); // tailwind w-80
  // The default is clamped too, so it never opens wider than the window allows.
  assert.equal(parseQuickSettingsPanelWidth(null, 400), QUICK_SETTINGS_PANEL_WIDTH_MIN);
});
