import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

const settingsApiMocks = vi.hoisted(() => ({
  notificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn((_preferences: unknown) => Promise.resolve(new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))),
}));

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

beforeEach(() => {
  vi.resetModules();
  settingsApiMocks.notificationPreferences.mockReset();
  settingsApiMocks.saveNotificationPreferences.mockClear();
  localStorage.clear();
});

test('a Bark channel preference survives the settings dialog round-trip', async () => {
  settingsApiMocks.notificationPreferences.mockResolvedValue(new Response(JSON.stringify({
    success: true,
    preferences: {
      channels: { inApp: true, webPush: false, desktop: false, bark: true, sound: true, vibration: true },
      events: { actionRequired: true, stop: true, error: true },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  const { useSettingsController } = await import(
    '@/modules/settings/hooks/useSettingsController'
  );
  const { result } = renderHook(() => useSettingsController({ isOpen: true, initialTab: 'appearance' }));

  await waitFor(() => {
    assert.equal(result.current.notificationPreferences.channels.bark, true);
  });

  act(() => {
    result.current.setProjectSortOrder('name');
  });

  await waitFor(() => {
    assert.equal(settingsApiMocks.saveNotificationPreferences.mock.calls.length, 1);
  }, { timeout: 1200 });

  const saved = settingsApiMocks.saveNotificationPreferences.mock.calls[0][0] as {
    channels: { bark: boolean };
  };
  assert.equal(saved.channels.bark, true);
});
