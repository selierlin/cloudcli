import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

const settingsApiMocks = vi.hoisted(() => ({
  notificationPreferences: vi.fn(() => Promise.resolve({ ok: false })),
  saveNotificationPreferences: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
}));

/**
 * OMP and OpenClaw gained the permission picker every other mode-based provider
 * already had, backed by the same preference store. These pin the two things
 * that matter: the mode survives a load/save round-trip under `ompPermissions` /
 * `openclawPermissions`, and saving a mode drops the composer's "last used"
 * override for that provider (and only that provider) — without the drop a mode
 * picked earlier from the composer would keep shadowing the new default.
 */

vi.mock('@/shared/api', () => {
  const ok = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  return {
    api: {
      settings: {
        notificationPreferences: settingsApiMocks.notificationPreferences,
        saveNotificationPreferences: settingsApiMocks.saveNotificationPreferences,
      },
      user: {
        preferences: async () => new Response(JSON.stringify({ preferences: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        savePreferences: ok,
        drafts: ok,
        saveDraft: ok,
        deleteDraft: ok,
      },
    },
  };
});

// These mocks must return stable identities: the hook's open-effect depends on
// the functions they expose, so fresh ones each render would re-run it forever.
vi.mock('@/shared/context/ThemeContext', () => {
  const theme = { isDarkMode: false, toggleDarkMode: () => undefined };
  return { useTheme: () => theme };
});

vi.mock('@/modules/provider-auth', () => {
  const authStatus = {
    providerAuthStatus: {},
    checkProviderAuthStatus: () => Promise.resolve({ authenticated: false }),
    refreshProviderAuthStatuses: () => Promise.resolve(),
  };
  return { useProviderAuthStatus: () => authStatus };
});

/** The single localStorage blob the preference store mirrors the server into. */
const MIRROR_STORAGE_KEY = 'user-preferences';

/**
 * Seeds the store the way a returning user's browser already holds it: the
 * mirror is read once, when the module loads, so this has to happen before the
 * controller is imported.
 */
const seedPreferences = (preferences: Record<string, unknown>) => {
  localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify(preferences));
};

const storedPermissions = (key: string): Record<string, unknown> | undefined => {
  const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }

  return (JSON.parse(raw) as Record<string, Record<string, unknown>>)[key];
};

const renderSettings = async () => {
  const { useSettingsController } = await import(
    '@/modules/settings/hooks/useSettingsController'
  );
  return renderHook(() => useSettingsController({ isOpen: true, initialTab: 'agents' }));
};

beforeEach(() => {
  // A fresh module graph per test, so the seeded mirror above is what the
  // preference store picks up when the controller pulls it in.
  vi.resetModules();
  settingsApiMocks.notificationPreferences.mockClear();
  settingsApiMocks.saveNotificationPreferences.mockClear();
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('omp and openclaw default to default for a user who never set them', async () => {
  const { result } = await renderSettings();

  await waitFor(() => {
    assert.ok(result.current.ompPermissionMode);
  });

  assert.equal(result.current.ompPermissionMode, 'default');
  assert.equal(result.current.openclawPermissionMode, 'default');
});

test('opening settings loads persisted omp and openclaw permission modes', async () => {
  seedPreferences({
    ompPermissions: { permissionMode: 'readonly' },
    openclawPermissions: { permissionMode: 'auto' },
  });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.equal(result.current.ompPermissionMode, 'readonly');
  });
  assert.equal(result.current.openclawPermissionMode, 'auto');
});

test('unknown persisted modes fall back to each provider default', async () => {
  seedPreferences({
    ompPermissions: { permissionMode: 'bypassPermissions' },
    openclawPermissions: { permissionMode: 'readonly' },
  });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.ok(result.current.ompPermissionMode);
  });
  assert.equal(result.current.ompPermissionMode, 'default');
  assert.equal(result.current.openclawPermissionMode, 'default');
});

test('changing either mode persists it under its own preference key after the debounce', async () => {
  const { result } = await renderSettings();

  await waitFor(() => {
    assert.equal(settingsApiMocks.notificationPreferences.mock.calls.length, 1);
  });
  await act(async () => {
    await Promise.resolve();
  });

  act(() => {
    result.current.setOmpPermissionMode('readonly');
    result.current.setOpenclawPermissionMode('auto');
  });

  await waitFor(() => {
    assert.equal(storedPermissions('ompPermissions')?.permissionMode, 'readonly');
  }, { timeout: 1200 });
  assert.equal(storedPermissions('openclawPermissions')?.permissionMode, 'auto');
});

test('saving a mode drops the composer override for that provider alone', async () => {
  localStorage.setItem('permissionMode-last-omp', 'default');
  localStorage.setItem('permissionMode-last-openclaw', 'default');

  const { result } = await renderSettings();
  await waitFor(() => {
    assert.ok(result.current.ompPermissionMode);
  });

  act(() => {
    result.current.setOmpPermissionMode('readonly');
  });

  assert.equal(localStorage.getItem('permissionMode-last-omp'), null);
  assert.equal(
    localStorage.getItem('permissionMode-last-openclaw'),
    'default',
    'another provider\'s override must survive',
  );
});
