import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';

/**
 * The permissions panel is dispatched by provider id, and its fallback arm is
 * Codex's panel. A provider with no arm therefore renders Codex's three modes
 * instead of its own — the "blank/wrong panel" defect OMP and OpenClaw shipped
 * with. The fake `t` echoes keys, so these assertions are independent of the
 * locale files and prove which variant rendered.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'en' },
  }),
}));

test('omp renders its own read-only picker, not the codex fallback', () => {
  render(<PermissionsContent agent="omp" permissionMode="default" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText('permissions.omp.permissionMode'));
  assert.ok(screen.getByText('permissions.omp.modes.readonly.title'));
  assert.equal(screen.queryByText('permissions.codex.permissionMode'), null);
});

test('openclaw renders its own auto-allow picker, not the codex fallback', () => {
  render(<PermissionsContent agent="openclaw" permissionMode="default" onPermissionModeChange={() => {}} />);

  assert.ok(screen.getByText('permissions.openclaw.permissionMode'));
  assert.ok(screen.getByText('permissions.openclaw.modes.auto.title'));
  assert.equal(screen.queryByText('permissions.codex.permissionMode'), null);
});

test('omp\'s second card reports the read-only mode', () => {
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
