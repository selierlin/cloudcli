import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import { setApprovalIndicator } from '@/shared/favicon';
import { SessionProtectionProvider } from '@/shared/context/SessionProtectionContext';
import { useTabAttentionFavicon } from '@/modules/project-workspace/hooks/useTabAttentionFavicon';

/**
 * The tab icon's approval mark rides the running-sessions poll, not the websocket:
 * a `permission_request` frame only reaches subscribers of that session, so a run
 * blocked in the background would otherwise never raise anything on this tab.
 */

const runningSessions = vi.fn();

vi.mock('@/shared/api', () => ({
  api: { runningSessions: () => runningSessions() },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(SessionProtectionProvider, null, children);

const faviconHref = (): string | null =>
  document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null;

beforeEach(() => {
  runningSessions.mockReset();
  document.head.innerHTML = '<link rel="icon" type="image/png" href="/icons/favicon-light-32.png" />';
  document.documentElement.removeAttribute('data-tab-attention');
});

test('a blocked session raises the amber mark on the tab icon', async () => {
  runningSessions.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        sessions: [
          { sessionId: 'blocked-session', startedAt: 1_700_000_000_000, canInterrupt: true, pendingPermissions: [{ requestId: 'req-1', toolName: 'Bash' }] },
        ],
      },
    }),
  });

  const { unmount } = renderHook(() => useTabAttentionFavicon(), { wrapper });

  await waitFor(() => assert.equal(document.documentElement.getAttribute('data-tab-attention'), 'approval'));
  assert.equal(faviconHref(), '/icons/favicon-approval-32.png');

  unmount();
  setApprovalIndicator(false);
  assert.equal(document.documentElement.getAttribute('data-tab-attention'), null);
});

test('an idle poll leaves the appearance icon alone', async () => {
  runningSessions.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        sessions: [
          { sessionId: 'busy-session', startedAt: 1_700_000_000_000, canInterrupt: true, pendingPermissions: [] },
        ],
      },
    }),
  });

  const { unmount } = renderHook(() => useTabAttentionFavicon(), { wrapper });

  await waitFor(() => assert.equal(runningSessions.mock.calls.length, 1));
  assert.equal(document.documentElement.getAttribute('data-tab-attention'), null);
  assert.equal(faviconHref(), '/icons/favicon-light-32.png');

  unmount();
});
