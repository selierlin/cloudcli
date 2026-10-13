import assert from 'node:assert/strict';

import { render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { SETTINGS_MAIN_TABS } from '@/shared/constants';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import zhSettings from '@/modules/i18n/locales/zh-CN/settings.json';

/**
 * Adding a main settings tab touches several places (the tab union, the tab
 * list, the sidebar, the controller's known-tab list, the Settings switch and
 * the locales); missing one silently hides the tab, drops a deep link or breaks
 * the command palette. These tests pin the places that are observable at runtime
 * for the Login Log tab.
 */

const settingsApiMocks = vi.hoisted(() => ({
  notificationPreferences: vi.fn(() => Promise.resolve({ ok: false })),
  saveNotificationPreferences: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

beforeEach(() => {
  vi.resetModules();
  settingsApiMocks.notificationPreferences.mockClear();
  settingsApiMocks.saveNotificationPreferences.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

test('the settings tab list carries the Login Log tab, so the command palette does too', () => {
  const tab = SETTINGS_MAIN_TABS.find((entry) => entry.id === 'loginLog');

  assert.ok(tab, 'expected a "loginLog" entry in SETTINGS_MAIN_TABS');
  assert.ok(tab.label.length > 0, 'the tab needs a label');
  assert.match(tab.keywords, /login/, 'the tab needs searchable keywords');
});

test('the sidebar renders the Login Log tab', async () => {
  const { default: SettingsSidebar } = await import('@/modules/settings/SettingsSidebar');
  const { container } = render(<SettingsSidebar activeTab="appearance" onChange={() => undefined} />);
  const labels = Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '');

  assert.ok(labels.includes('mainTabs.loginLog'), 'expected a sidebar button labelled "mainTabs.loginLog"');
});

test('the controller accepts "loginLog" as a deep-linked tab', async () => {
  const { useSettingsController } = await import('@/modules/settings/hooks/useSettingsController');
  const { result } = renderHook(() => useSettingsController({ isOpen: true, initialTab: 'loginLog' }));

  await waitFor(() => {
    assert.equal(result.current.activeTab, 'loginLog');
  });
});

test('both locales define the Login Log tab label', () => {
  assert.equal(typeof enSettings.mainTabs.loginLog, 'string');
  assert.equal(typeof zhSettings.mainTabs.loginLog, 'string');
});
