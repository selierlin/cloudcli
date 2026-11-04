import { Preferences } from '@capacitor/preferences';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { useSavedServers } from '@/shared/hooks/useSavedServers';

/**
 * The hook backs both server switchers, so it has to stay inert outside the
 * native shell and, inside it, re-read when the WebView becomes visible again —
 * a server switch only hides the previous WebView, so a list read once at mount
 * would never show a server the user just added in the picker.
 */

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn() },
}));

const preferences = Preferences as unknown as { get: Mock };

const FIRST = [{ name: 'Alpha', url: 'https://alpha.example' }];
const SECOND = [...FIRST, { name: 'Beta', url: 'https://beta.example' }];

function setNativeShell(isNative: boolean) {
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor = {
    isNativePlatform: () => isNative,
  };
}

let visibilityState: DocumentVisibilityState = 'visible';

function showWebView() {
  visibilityState = 'visible';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  visibilityState = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  });
});

afterEach(() => {
  preferences.get.mockReset();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('useSavedServers', () => {
  it('returns the saved list inside the native shell', async () => {
    setNativeShell(true);
    preferences.get.mockResolvedValue({ value: JSON.stringify(FIRST) });

    const { result } = renderHook(() => useSavedServers());

    await waitFor(() => expect(result.current).toEqual(FIRST));
  });

  it('drops entries without a url instead of failing the whole list', async () => {
    setNativeShell(true);
    preferences.get.mockResolvedValue({
      value: JSON.stringify([...FIRST, { name: 'Broken' }, 'not-an-object']),
    });

    const { result } = renderHook(() => useSavedServers());

    await waitFor(() => expect(result.current).toEqual(FIRST));
  });

  it('stays empty outside the native shell and never reads preferences', async () => {
    setNativeShell(false);

    const { result } = renderHook(() => useSavedServers());

    expect(result.current).toEqual([]);
    expect(preferences.get).not.toHaveBeenCalled();
  });

  it('re-reads when the WebView becomes visible again', async () => {
    setNativeShell(true);
    preferences.get.mockResolvedValue({ value: JSON.stringify(FIRST) });

    const { result } = renderHook(() => useSavedServers());
    await waitFor(() => expect(result.current).toEqual(FIRST));

    preferences.get.mockResolvedValue({ value: JSON.stringify(SECOND) });
    showWebView();

    await waitFor(() => expect(result.current).toEqual(SECOND));
  });

  it('clears the list when the picker removes the key', async () => {
    setNativeShell(true);
    preferences.get.mockResolvedValue({ value: JSON.stringify(FIRST) });

    const { result } = renderHook(() => useSavedServers());
    await waitFor(() => expect(result.current).toEqual(FIRST));

    preferences.get.mockResolvedValue({ value: null });
    showWebView();

    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('ignores a hidden notification so a sibling WebView does not repopulate this one', async () => {
    setNativeShell(true);
    preferences.get.mockResolvedValue({ value: JSON.stringify(FIRST) });

    const { result } = renderHook(() => useSavedServers());
    await waitFor(() => expect(result.current).toEqual(FIRST));

    const readsBefore = preferences.get.mock.calls.length;
    visibilityState = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(preferences.get).toHaveBeenCalledTimes(readsBefore);
  });
});
