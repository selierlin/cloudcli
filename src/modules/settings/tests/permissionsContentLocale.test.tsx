import assert from 'node:assert/strict';

import { act, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';
import { i18n } from '@/modules/i18n';
import zhSettings from '@/modules/i18n/locales/zh-CN/settings.json';

/**
 * The panel's copy is resolved through the shared mode-copy hook, which falls
 * back from a provider's own strings to the composer's shared ones. A missing
 * provider block therefore shows English (or a raw key) inside a translated
 * panel instead of failing loudly, so these tests render the real locale.
 */
vi.mock('@/shared/hooks/useProviderCapabilities', async () => {
  const { FALLBACK_PERMISSION_MODES } = await import('@/shared/permissionModes');
  return {
    usePermissionModes: (provider: keyof typeof FALLBACK_PERMISSION_MODES) =>
      FALLBACK_PERMISSION_MODES[provider],
  };
});

test('workbuddy is named by its own strings, not codex\'s', async () => {
  await act(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  render(<PermissionsContent agent="workbuddy" permissionMode="auto" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText(zhSettings.permissions.workbuddy.permissionMode));
  assert.ok(screen.getByText(zhSettings.permissions.workbuddy.description));
  // `auto` is one of the modes each harness implements differently, so it keeps
  // its own name here — in-process approval — instead of the shared "自动".
  assert.ok(screen.getByText(zhSettings.permissions.workbuddy.modes.auto.title));
  assert.ok(screen.getByText(zhSettings.permissions.modes.bypassPermissions.title));
  // Codex's panel text would mean this is the fallback arm again.
  assert.equal(screen.queryByText(zhSettings.permissions.codex.description), null);
  assert.equal(screen.queryByText('默认'), null);
});

test('every mode card carries its mode icon', async () => {
  await act(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  const { container } = render(
    <PermissionsContent agent="codex" permissionMode="default" onPermissionModeChange={() => {}} />,
  );

  const cards = container.querySelectorAll('input[type="radio"]');
  assert.equal(cards.length, 3);
  for (const card of cards) {
    assert.ok(card.closest('label')?.querySelector('svg'), 'each card shows the mode icon');
  }
});

test('codex keeps its sandbox technical detail, other providers do not show it', async () => {
  await act(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  const codex = render(
    <PermissionsContent agent="codex" permissionMode="default" onPermissionModeChange={() => {}} />,
  );
  assert.ok(screen.getByText(zhSettings.permissions.codex.technicalDetails));
  codex.unmount();

  render(<PermissionsContent agent="workbuddy" permissionMode="auto" onPermissionModeChange={() => {}} />);
  assert.equal(screen.queryByText(zhSettings.permissions.codex.technicalDetails), null);
});
