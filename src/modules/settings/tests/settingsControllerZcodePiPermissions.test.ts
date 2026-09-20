import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

const settingsApiMocks = vi.hoisted(() => ({
  notificationPreferences: vi.fn(() => Promise.resolve({ ok: false })),
  saveNotificationPreferences: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
}));

/**
 * The zcode and pi permission-mode pickers were new agents-tab entries backed by
 * the same preference store as codex/workbuddy. These tests pin the two things
 * that differ from the codex picker: ZCode's default mode is `acceptEdits`
 * (mirroring its `--mode edit` default) rather than `default`, and both modes
 * must survive a load/save round-trip under their own `zcodePermissions` /
 * `piPermissions` preference keys.
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

test('zcode defaults to acceptEdits and pi to default for a user who never set them', async () => {
  const { result } = await renderSettings();

  await waitFor(() => {
    assert.ok(result.current.zcodePermissionMode);
  });

  assert.equal(
    result.current.zcodePermissionMode,
    'acceptEdits',
    'ZCode mirrors its CLI default of `edit`, unlike the other mode pickers',
  );
  assert.equal(result.current.piPermissionMode, 'default');
});

test('opening settings loads persisted zcode and pi permission modes', async () => {
  seedPreferences({
    zcodePermissions: { permissionMode: 'plan' },
    piPermissions: { permissionMode: 'readonly' },
  });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.equal(result.current.zcodePermissionMode, 'plan');
  });
  assert.equal(result.current.piPermissionMode, 'readonly');
});

test('unknown persisted modes fall back to each provider default', async () => {
  seedPreferences({
    zcodePermissions: { permissionMode: 'bogus' },
    piPermissions: { permissionMode: 'yolo' },
  });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.ok(result.current.zcodePermissionMode);
  });
  assert.equal(result.current.zcodePermissionMode, 'acceptEdits');
  assert.equal(result.current.piPermissionMode, 'default');
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
    result.current.setZcodePermissionMode('bypassPermissions');
    result.current.setPiPermissionMode('readonly');
  });

  await waitFor(() => {
    assert.equal(storedPermissions('zcodePermissions')?.permissionMode, 'bypassPermissions');
  }, { timeout: 1200 });
  assert.equal(storedPermissions('piPermissions')?.permissionMode, 'readonly');
});

test('opening settings loads the persisted DSH permission mode', async () => {
  seedPreferences({
    dshPermissions: { permissionMode: 'auto' },
  });

  const { result } = await renderSettings();

  await waitFor(() => {
    assert.equal(result.current.dshPermissionMode, 'auto');
  });
});

test('changing the DSH mode persists it under its own preference key', async () => {
  seedPreferences({
    dshPermissions: { permissionMode: 'auto' },
  });
  const { result } = await renderSettings();

  await waitFor(() => {
    assert.equal(result.current.dshPermissionMode, 'auto');
  });
  await act(async () => {
    await Promise.resolve();
  });

  act(() => {
    result.current.setDshPermissionMode('default');
  });

  await waitFor(() => {
    assert.equal(storedPermissions('dshPermissions')?.permissionMode, 'default');
  }, { timeout: 1200 });
});
