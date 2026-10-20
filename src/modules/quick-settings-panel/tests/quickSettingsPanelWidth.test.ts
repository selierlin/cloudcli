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
  assert.equal(parseQuickSettingsPanelWidth('420'), 420);
  assert.equal(parseQuickSettingsPanelWidth('9999'), QUICK_SETTINGS_PANEL_WIDTH_MAX);
  assert.equal(parseQuickSettingsPanelWidth('10'), QUICK_SETTINGS_PANEL_WIDTH_MIN);
  assert.equal(parseQuickSettingsPanelWidth(null), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  assert.equal(parseQuickSettingsPanelWidth(undefined), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  assert.equal(parseQuickSettingsPanelWidth('wide, please'), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  // A numeric prefix is not a width: '420px' is as broken as 'wide, please'.
  assert.equal(parseQuickSettingsPanelWidth('420px'), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  assert.equal(parseQuickSettingsPanelWidth(''), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
});

// The stored value is a preference, not a measurement: a narrow window must
// narrow what is rendered without forgetting the width dragged on a wider one.
test('the stored preference survives a narrow window instead of being rewritten', () => {
  const preference = parseQuickSettingsPanelWidth('560');

  assert.equal(preference, QUICK_SETTINGS_PANEL_WIDTH_MAX);
  assert.equal(clampQuickSettingsPanelWidth(preference, 900), 450);
  // Widening the window again brings the dragged width back, without a reload.
  assert.equal(clampQuickSettingsPanelWidth(preference, 1440), QUICK_SETTINGS_PANEL_WIDTH_MAX);
});

test('the default matches the overlay width the panel had before pinning existed', () => {
  assert.equal(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT, 320); // tailwind w-80
  assert.equal(parseQuickSettingsPanelWidth(null), QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  // Rendering is what shrinks the default on a narrow window.
  assert.equal(clampQuickSettingsPanelWidth(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT, 400), QUICK_SETTINGS_PANEL_WIDTH_MIN);
});
