import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';

/**
 * Every provider except Claude and Cursor is rendered by one shared mode
 * picker, so the thing worth testing is that a provider never gets another
 * provider's modes or another provider's heading: that is the "blank/wrong
 * panel" defect OMP, OpenClaw, workbuddy and OpenCode each shipped with.
 *
 * The fake `t` echoes keys, so these assertions are independent of the locale
 * files and prove which provider's copy rendered.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'en' },
  }),
}));

const modeTitles = () => screen.getAllByRole('radio').length;

// The panel reads its mode list from the capability matrix over HTTP; these
// tests care about the copy each provider renders, so answer it from the same
// mirror the panel falls back to before that request lands.
vi.mock('@/shared/hooks/useProviderCapabilities', async () => {
  const { FALLBACK_PERMISSION_MODES } = await import('@/shared/permissionModes');
  return {
    usePermissionModes: (provider: keyof typeof FALLBACK_PERMISSION_MODES) =>
      FALLBACK_PERMISSION_MODES[provider],
  };
});

test('omp renders its own read-only picker, not the codex fallback', () => {
  render(<PermissionsContent agent="omp" permissionMode="default" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText('permissions.omp.permissionMode'));
  assert.ok(screen.getByText(/permissions\.omp\.modes\.readonly\.title/));
  assert.equal(screen.queryByText('permissions.codex.permissionMode'), null);
});

test('openclaw renders its own auto-allow picker, not the codex fallback', () => {
  render(<PermissionsContent agent="openclaw" permissionMode="default" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText('permissions.openclaw.permissionMode'));
  assert.ok(screen.getByText(/permissions\.openclaw\.modes\.auto\.title/));
  assert.equal(screen.queryByText('permissions.codex.permissionMode'), null);
});

test('workbuddy offers only the two modes that can finish a turn', () => {
  render(<PermissionsContent agent="workbuddy" permissionMode="auto" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText('permissions.workbuddy.permissionMode'));
  assert.ok(screen.getByText(/permissions\.workbuddy\.modes\.auto\.title/));
  assert.ok(screen.getByText(/permissions\.workbuddy\.modes\.bypassPermissions\.title/));
  // `default`, `acceptEdits` and `plan` wait for an approver `-p` never has.
  assert.equal(modeTitles(), 2);
  assert.equal(screen.queryByText(/permissions\.workbuddy\.modes\.default/), null);
  assert.equal(screen.queryByText('permissions.codex.permissionMode'), null);
});

test('opencode has a permissions panel of its own', () => {
  render(<PermissionsContent agent="opencode" permissionMode="default" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText('permissions.opencode.permissionMode'));
  assert.ok(screen.getByText(/permissions\.opencode\.modes\.default\.title/));
  assert.equal(modeTitles(), 4);
});

test('each provider is named by its own copy, never codex\'s', () => {
  const providers = ['codex', 'workbuddy', 'opencode', 'zcode', 'pi', 'dsh', 'omp', 'openclaw'] as const;

  for (const agent of providers) {
    const { unmount } = render(
      <PermissionsContent agent={agent} permissionMode="default" onPermissionModeChange={() => {}} />,
    );
    assert.ok(screen.getByText(`permissions.${agent}.permissionMode`), `${agent} names itself`);
    unmount();
  }
});

test('a card reports the mode it shows', () => {
  const changes: string[] = [];
  render(
    <PermissionsContent
      agent="omp"
      permissionMode="default"
      onPermissionModeChange={(value) => changes.push(value)}
    />,
  );

  const options = screen.getAllByRole('radio');
  assert.equal(options.length, 2);
  fireEvent.click(options[1]);
  // A card reports twice — its radio's change handler and the card's own click
  // handler both fire — so only the reported values matter, not their count.
  assert.deepEqual([...new Set(changes)], ['readonly']);
});

test('openclaw\'s second card reports the auto mode', () => {
  const changes: string[] = [];
  render(
    <PermissionsContent
      agent="openclaw"
      permissionMode="default"
      onPermissionModeChange={(value) => changes.push(value)}
    />,
  );

  const options = screen.getAllByRole('radio');
  assert.equal(options.length, 2);
  fireEvent.click(options[1]);
  assert.deepEqual([...new Set(changes)], ['auto']);
});
