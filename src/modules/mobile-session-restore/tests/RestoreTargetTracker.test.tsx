import { Preferences } from '@capacitor/preferences';
import { act, render, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { RestoreTargetTracker } from '@/modules/mobile-session-restore';

/**
 * The tracker is the client half of iOS cold-start session restore: it mirrors the visible
 * session URL into the native store, and must stay inert outside the native shell, while its
 * WebView is hidden, or on an origin that is not a saved server.
 */

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

const preferences = Preferences as unknown as { get: Mock; set: Mock };

const SAVED_ORIGIN = window.location.origin;
const SAVED_SERVERS = JSON.stringify([{ name: 'A', url: SAVED_ORIGIN }]);

function setNativeShell(isNative: boolean) {
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
    isNativePlatform: () => isNative,
  };
}

let visibilityState: DocumentVisibilityState = 'visible';

/** Renders the tracker on a real (memory) router so a test can navigate it. */
function renderTracker() {
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId', element: <RestoreTargetTracker /> }],
    { initialEntries: ['/session/one'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Drains the pending microtasks of the tracker's fire-and-forget write. */
async function drainAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Waits until the tracker has read the saved servers, then drains the rest of its async write. */
async function settleFirstWrite() {
  await waitFor(() => expect(preferences.get).toHaveBeenCalled());
  await drainAsyncWork();
}

beforeEach(() => {
  visibilityState = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  });
  setNativeShell(true);
  preferences.get.mockResolvedValue({ value: SAVED_SERVERS });
  preferences.set.mockResolvedValue(undefined);
});

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(window, 'Capacitor');
});

describe('RestoreTargetTracker', () => {
  it('persists the visible session URL when the origin is a saved server', async () => {
    renderTracker();

    await waitFor(() =>
      expect(preferences.set).toHaveBeenCalledWith({
        key: 'cloudcli.restoreTarget',
        value: JSON.stringify({ url: window.location.href }),
      }),
    );
  });

  it('stays inert outside the native shell', async () => {
    setNativeShell(false);
    renderTracker();

    await drainAsyncWork();
    expect(preferences.get).not.toHaveBeenCalled();
    expect(preferences.set).not.toHaveBeenCalled();
  });

  it('skips origins that are not in the saved server list', async () => {
    preferences.get.mockResolvedValue({
      value: JSON.stringify([{ name: 'B', url: 'http://other.example' }]),
    });
    renderTracker();

    await settleFirstWrite();
    expect(preferences.set).not.toHaveBeenCalled();
  });

  it('ignores a saved-server value it cannot parse', async () => {
    preferences.get.mockResolvedValue({ value: 'not-json' });
    renderTracker();

    await settleFirstWrite();
    expect(preferences.set).not.toHaveBeenCalled();
  });

  it('re-persists after a route change', async () => {
    const router = renderTracker();
    await waitFor(() => expect(preferences.set).toHaveBeenCalledTimes(1));

    await act(async () => {
      await router.navigate('/session/two');
    });

    await waitFor(() => expect(preferences.set).toHaveBeenCalledTimes(2));
  });

  it('does not overwrite the target while hidden, and re-asserts once visible again', async () => {
    renderTracker();
    await waitFor(() => expect(preferences.set).toHaveBeenCalledTimes(1));
    preferences.set.mockClear();

    act(() => {
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await drainAsyncWork();
    expect(preferences.set).not.toHaveBeenCalled();

    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(preferences.set).toHaveBeenCalledTimes(1));
  });
});
