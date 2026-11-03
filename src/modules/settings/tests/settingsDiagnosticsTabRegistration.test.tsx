import assert from 'node:assert/strict';

import { renderHook, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { SETTINGS_MAIN_TABS } from '@/shared/constants';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import zhSettings from '@/modules/i18n/locales/zh-CN/settings.json';

/**
 * The diagnostics tab is the one entry that was added after the settings module
 * settled, and its switch is the only way to reach the on-device recorder — a
 * missed wiring point would silently make the recorder unreachable instead of
 * failing a build. Mirrors `settingsMcpTabRegistration.test.tsx`.
 */

vi.mock('@/shared/api', () => {
  const ok = async () => new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  return {
    api: {
      settings: {
        notificationPreferences: async () => new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        saveNotificationPreferences: ok,
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

test('the settings tab list carries the diagnostics tab, so the command palette does too', () => {
  const tab = SETTINGS_MAIN_TABS.find((entry) => entry.id === 'diagnostics');

  assert.ok(tab, 'expected a "diagnostics" entry in SETTINGS_MAIN_TABS');
  assert.match(tab.keywords, /diagnostics/, 'the tab needs searchable keywords');
});

test('the sidebar renders the diagnostics tab', async () => {
  const { default: SettingsSidebar } = await import('@/modules/settings/SettingsSidebar');
  const { container } = render(<SettingsSidebar activeTab="appearance" onChange={() => undefined} />);
  const labels = Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '');

  assert.ok(
    labels.includes('mainTabs.diagnostics'),
    'expected a sidebar button labelled "mainTabs.diagnostics"',
  );
});

test('the controller accepts "diagnostics" as a deep-linked tab', async () => {
  const { useSettingsController } = await import('@/modules/settings/hooks/useSettingsController');
  const { result } = renderHook(() => useSettingsController({ isOpen: true, initialTab: 'diagnostics' }));

  await waitFor(() => {
    assert.equal(result.current.activeTab, 'diagnostics');
  });
});

test('both locales define the diagnostics tab label and copy', () => {
  for (const bundle of [enSettings, zhSettings]) {
    assert.equal(typeof bundle.mainTabs.diagnostics, 'string');
    assert.equal(typeof bundle.diagnostics.recorderLabel, 'string');
    assert.equal(typeof bundle.diagnostics.recorderDescription, 'string');
  }
});
