import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type * as SharedApiModule from '@/shared/api';
import { SETTINGS_MAIN_TABS } from '@/shared/constants';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import zhSettings from '@/modules/i18n/locales/zh-CN/settings.json';

/**
 * The Shared Links tab is the only place a published link can be seen again or
 * taken down. These tests pin the two things that made it necessary: the list
 * shows links published earlier, and revoking one goes through the server.
 */

const sharesApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApiModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      shares: {
        list: sharesApiMocks.list,
        revoke: sharesApiMocks.revoke,
      },
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const ACTIVE_SHARE = {
  shareId: 'share-active',
  urlPath: '/s/active-token',
  title: 'Renaming review',
  sessionId: 'session-1',
  messageCount: 3,
  byteSize: 2048,
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  revokedAt: null,
  status: 'active' as const,
};

const REVOKED_SHARE = {
  ...ACTIVE_SHARE,
  shareId: 'share-revoked',
  urlPath: null,
  title: 'Old share',
  status: 'revoked' as const,
  revokedAt: '2026-10-02T00:00:00.000Z',
};

const clipboardWrite = vi.fn(() => Promise.resolve());

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderTab() {
  const { default: SharedTranscriptsSettingsTab } = await import('@/modules/settings/tabs/SharedTranscriptsSettingsTab');
  return render(<SharedTranscriptsSettingsTab />);
}

beforeEach(() => {
  sharesApiMocks.list.mockReset();
  sharesApiMocks.revoke.mockReset();
  sharesApiMocks.list.mockImplementation(() => Promise.resolve(jsonResponse({ success: true, shares: [ACTIVE_SHARE, REVOKED_SHARE] })));
  sharesApiMocks.revoke.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
  clipboardWrite.mockClear();

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the settings tab list carries the shared links tab', () => {
  const tab = SETTINGS_MAIN_TABS.find((entry) => entry.id === 'shares');

  assert.ok(tab, 'expected a "shares" entry in SETTINGS_MAIN_TABS');
  assert.match(tab.keywords, /share/);
});

test('both locales define the tab label and the empty state', () => {
  assert.equal(typeof enSettings.mainTabs.shares, 'string');
  assert.equal(typeof zhSettings.mainTabs.shares, 'string');
  assert.equal(typeof enSettings.shares.empty, 'string');
  assert.equal(typeof zhSettings.shares.empty, 'string');
});

test('lists published links with their URL so a lost link can be recovered', async () => {
  const { getByText, getByLabelText } = await renderTab();

  await waitFor(() => assert.ok(getByText('Renaming review')));
  assert.ok(getByText(`${window.location.origin}/s/active-token`));
  assert.ok(getByText('shares.statusActive'));
  // The revoked row keeps its place in the list but exposes no link.
  assert.ok(getByText('shares.statusRevoked'));
  assert.ok(getByLabelText('shares.copy'));
});

test('copying a row writes the absolute URL to the clipboard', async () => {
  const { getByLabelText } = await renderTab();

  await waitFor(() => assert.ok(getByLabelText('shares.copy')));
  fireEvent.click(getByLabelText('shares.copy'));

  await waitFor(() => assert.equal(clipboardWrite.mock.calls.length, 1));
  assert.deepEqual(clipboardWrite.mock.calls[0], [`${window.location.origin}/s/active-token`]);
});

test('revoking asks first, then reloads the row as revoked', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { getByText, queryByText } = await renderTab();

  await waitFor(() => assert.ok(getByText('shares.revoke')));
  // The server answers the next read with the link already taken down.
  sharesApiMocks.list.mockImplementation(() => Promise.resolve(jsonResponse({
    success: true,
    shares: [{ ...ACTIVE_SHARE, urlPath: null, status: 'revoked', revokedAt: '2026-10-03T00:00:00.000Z' }, REVOKED_SHARE],
  })));

  const before = sharesApiMocks.list.mock.calls.length;
  fireEvent.click(getByText('shares.revoke'));

  await waitFor(() => assert.equal(sharesApiMocks.revoke.mock.calls.length, 1));
  assert.deepEqual(sharesApiMocks.revoke.mock.calls[0], ['share-active']);
  await waitFor(() => assert.equal(sharesApiMocks.list.mock.calls.length, before + 1));
  await waitFor(() => assert.equal(queryByText('shares.revoke'), null));
  assert.equal(queryByText('shares.copy'), null);
});

test('a cancelled confirmation leaves the link alone', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { getByText } = await renderTab();

  await waitFor(() => assert.ok(getByText('shares.revoke')));
  fireEvent.click(getByText('shares.revoke'));

  assert.equal(sharesApiMocks.revoke.mock.calls.length, 0);
});

// 404 means the link is already gone — revoked from another device, or swept
// after it expired. Reporting that as a failure would leave the row looking
// active forever and the reader with nothing to do about it.
test('revoking a link that is already gone reloads instead of failing', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  sharesApiMocks.revoke.mockImplementation(() => Promise.resolve(new Response(null, { status: 404 })));
  const { getByText, queryByText } = await renderTab();

  await waitFor(() => assert.ok(getByText('shares.revoke')));
  // The server answers the next read with the link already taken down.
  sharesApiMocks.list.mockImplementation(() => Promise.resolve(jsonResponse({
    success: true,
    shares: [{ ...ACTIVE_SHARE, urlPath: null, status: 'revoked', revokedAt: '2026-10-03T00:00:00.000Z' }],
  })));
  const before = sharesApiMocks.list.mock.calls.length;
  fireEvent.click(getByText('shares.revoke'));

  await waitFor(() => assert.equal(sharesApiMocks.list.mock.calls.length, before + 1));
  assert.equal(queryByText('shares.revoke'), null);
});

test('shows the empty state when nothing has been published', async () => {
  sharesApiMocks.list.mockImplementation(() => Promise.resolve(jsonResponse({ success: true, shares: [] })));
  const { getByText } = await renderTab();

  await waitFor(() => assert.ok(getByText('shares.empty')));
});
