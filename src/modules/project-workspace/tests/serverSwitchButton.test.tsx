import { Preferences } from '@capacitor/preferences';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import '@/modules/i18n';
import ServerSwitchButton from '@/modules/project-workspace/ServerSwitchButton';

/**
 * The workspace switcher exists so a second server is one tap away from the
 * chat header instead of the sidebar → project → menu path. It returns to the
 * server the user was on before, so two servers can be flipped between with no
 * load; until such a pair exists it walks the picker's list order and wraps.
 */

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

const preferences = Preferences as unknown as { get: Mock; set: Mock };

/** The MRU key the hook owns; spelled out here because it is a stored contract. */
const RECENT_KEY = 'cloudcli.recentServers';

type Server = { name: string; url: string };

const CURRENT = { name: 'Current', url: window.location.origin };
const OTHER = { name: 'Other', url: 'https://other.example' };
const THIRD = { name: 'Third', url: 'https://third.example' };

let switchToServer: Mock;
let savedServers: Server[] = [];
let savedRecent: string[] = [];

function setNativeShell(isNative: boolean) {
  (window as unknown as {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      registerPlugin?: (name: string) => unknown;
    };
  }).Capacitor = {
    isNativePlatform: () => isNative,
    registerPlugin: (name) => (name === 'ServerSession' ? { switchToServer } : undefined),
  };
}

/** Drains the hooks' fire-and-forget preferences reads and the render they trigger. */
async function settleSavedList() {
  await waitFor(() => expect(preferences.get).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Renders the button against the given saved list and recent-server history. */
async function renderSwitchButton(servers: Server[], recent: string[] = []) {
  savedServers = servers;
  savedRecent = recent;
  const view = render(<ServerSwitchButton />);
  await settleSavedList();
  return view;
}

beforeEach(() => {
  switchToServer = vi.fn().mockResolvedValue(undefined);
  savedServers = [];
  savedRecent = [];
  preferences.get.mockImplementation(({ key }: { key: string }) =>
    Promise.resolve({ value: JSON.stringify(key === RECENT_KEY ? savedRecent : savedServers) }),
  );
  setNativeShell(true);
});

afterEach(() => {
  preferences.get.mockReset();
  preferences.set.mockReset();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('ServerSwitchButton', () => {
  it('returns to the server used just before this one', async () => {
    // Opened Third, then landed on Current: the pair is Third ⇄ Current, so the
    // first tap must go back to Third even though Current is first in the list.
    await renderSwitchButton([CURRENT, OTHER, THIRD], [CURRENT.url, THIRD.url]);

    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(THIRD.name);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(switchToServer).toHaveBeenCalledWith({ url: THIRD.url }));
  });

  it('ignores servers opened longer ago than the previous one', async () => {
    await renderSwitchButton([CURRENT, OTHER, THIRD], [CURRENT.url, THIRD.url, OTHER.url]);

    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(THIRD.name);
  });

  it('records this WebView as the most recent once it is visible', async () => {
    await renderSwitchButton([CURRENT, OTHER], [OTHER.url, CURRENT.url]);

    expect(preferences.set).toHaveBeenCalledWith(
      expect.objectContaining({ value: JSON.stringify([CURRENT.url, OTHER.url]) }),
    );
  });

  it('labels and switches to that server, recording its name first', async () => {
    await renderSwitchButton([CURRENT, OTHER, THIRD], [CURRENT.url, OTHER.url]);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(switchToServer).toHaveBeenCalledWith({ url: OTHER.url }));
    expect(preferences.set).toHaveBeenCalledWith(
      expect.objectContaining({ value: OTHER.name }),
    );
  });

  it('marks this server, not the target, in a swatch of its own colour', async () => {
    // Two servers look alike in the chat view, so the button carries the colour
    // and initial of the one on screen; the aria-label says where the tap goes.
    await renderSwitchButton([CURRENT, OTHER], [CURRENT.url, OTHER.url]);

    const swatch = screen.getByRole('button').querySelector<HTMLElement>('span[aria-hidden="true"]');

    expect(swatch?.textContent).toBe('C');
    expect(swatch?.style.borderColor).toBeTruthy();
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(OTHER.name);
  });

  it('falls back to list order when the previous server was removed from the picker', async () => {
    await renderSwitchButton([CURRENT, OTHER], ['https://gone.example', CURRENT.url]);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(switchToServer).toHaveBeenCalledWith({ url: OTHER.url }));
  });

  it('walks list order and wraps until a previous server is known', async () => {
    await renderSwitchButton([OTHER, CURRENT]);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(switchToServer).toHaveBeenCalledWith({ url: OTHER.url }));
  });

  it('falls back to the first server when the current origin was never saved', async () => {
    // Neither entry matches this page, e.g. a hand-typed address.
    await renderSwitchButton([THIRD, OTHER]);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(switchToServer).toHaveBeenCalledWith({ url: THIRD.url }));
  });

  it('renders nothing with a single saved server', async () => {
    await renderSwitchButton([CURRENT]);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing outside the native shell', async () => {
    setNativeShell(false);
    savedServers = [CURRENT, OTHER];
    render(<ServerSwitchButton />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(preferences.get).not.toHaveBeenCalled();
  });

  it('restores the button after a refused switch so the tap can be retried', async () => {
    switchToServer.mockRejectedValueOnce(new Error('bridge unavailable'));
    await renderSwitchButton([CURRENT, OTHER], [CURRENT.url, OTHER.url]);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(OTHER.name);
  });
});
