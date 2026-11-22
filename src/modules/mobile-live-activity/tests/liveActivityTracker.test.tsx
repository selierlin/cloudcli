import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { LiveActivityTracker } from '@/modules/mobile-live-activity';
import type { SessionActivity, SessionActivityMap } from '@/shared/types';

/**
 * The tracker is the client half of the iOS Dynamic Island: it opens a Live
 * Activity for the run the reader is watching, keeps it in step, and closes it
 * when that run stops. It must stay inert in a browser, never open an island for
 * a run that is over before the start delay, and keep following the original
 * session when the reader switches conversations mid-flight.
 */

const START_DELAY_MS = 2000;
const BASE_TIME = new Date('2026-11-22T10:00:00Z').getTime();

function makeActivity(overrides: Partial<SessionActivity> = {}): SessionActivity {
  return {
    statusText: null,
    canInterrupt: true,
    startedAt: BASE_TIME,
    ...overrides,
  };
}

function makeActivities(entries: Array<[string, SessionActivity]>): SessionActivityMap {
  return new Map(entries);
}

let plugin: {
  isSupported: Mock;
  start: Mock;
  update: Mock;
  end: Mock;
};

function setNativeShell(enabled: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = enabled
    ? {
        isNativePlatform: () => true,
        registerPlugin: () => plugin,
      }
    : undefined;
}

/** Advances past the start delay and lets the resulting promise chain settle. */
async function advanceStartDelay(ms = START_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('LiveActivityTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    plugin = {
      isSupported: vi.fn().mockResolvedValue({ supported: true, hasActivity: false }),
      start: vi.fn().mockResolvedValue({ id: 'activity-1' }),
      update: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue({ ended: true }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setNativeShell(false);
  });

  it('stays inert outside the native shell', async () => {
    setNativeShell(false);

    render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([['session-a', makeActivity()]])}
      />,
    );
    await advanceStartDelay();

    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('opens an activity carrying the run start time and a deep link', async () => {
    setNativeShell(true);

    render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([['session-a', makeActivity({ statusText: 'Editing files' })]])}
      />,
    );

    // Nothing appears for runs that finish inside the delay.
    expect(plugin.start).not.toHaveBeenCalled();

    await advanceStartDelay();

    expect(plugin.start).toHaveBeenCalledTimes(1);
    expect(plugin.start.mock.calls[0][0]).toMatchObject({
      sessionTitle: 'Session A',
      phase: 'running',
      detail: 'Editing files',
      // The run is already underway when the island opens; it must not restart at 0:00.
      startedAt: Math.floor(BASE_TIME / 1000),
    });
    expect(plugin.start.mock.calls[0][0].deepLink).toBe(
      `cloudcli://open?url=${encodeURIComponent(window.location.href)}`,
    );
  });

  it('never opens an island for a run that ends inside the delay', async () => {
    setNativeShell(true);

    const sessionId = 'session-a';
    const sessionTitle = 'Session A';
    const { rerender } = render(
      <LiveActivityTracker
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        activities={makeActivities([[sessionId, makeActivity()]])}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(START_DELAY_MS - 500);
    });

    rerender(
      <LiveActivityTracker sessionId={sessionId} sessionTitle={sessionTitle} activities={makeActivities([])} />,
    );
    await advanceStartDelay(START_DELAY_MS);

    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('reports a pending tool approval as the waiting phase', async () => {
    setNativeShell(true);

    render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([
          ['session-a', makeActivity({ pendingPermissions: [{ requestId: 'r1', toolName: 'Bash' }] })],
        ])}
      />,
    );
    await advanceStartDelay();

    expect(plugin.start.mock.calls[0][0]).toMatchObject({ phase: 'waiting' });
  });

  it('ignores background-only work, which leaves the composer usable', async () => {
    setNativeShell(true);

    render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([['session-a', makeActivity({ background: true })]])}
      />,
    );
    await advanceStartDelay();

    expect(plugin.start).not.toHaveBeenCalled();
  });

  it('keeps following the original run after the reader switches sessions', async () => {
    setNativeShell(true);

    const activity = makeActivity({ statusText: 'Running tests' });
    const { rerender } = render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([['session-a', activity]])}
      />,
    );
    await advanceStartDelay();

    // Reader moves to another conversation while session A keeps working.
    rerender(
      <LiveActivityTracker
        sessionId="session-b"
        sessionTitle="Session B"
        activities={makeActivities([['session-a', makeActivity({ statusText: 'Writing files' })]])}
      />,
    );
    await act(async () => {});

    expect(plugin.update).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'running', detail: 'Writing files' }),
    );
    expect(plugin.end).not.toHaveBeenCalled();
  });

  it('closes the island once the watched run is no longer busy', async () => {
    setNativeShell(true);

    const { rerender } = render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([['session-a', makeActivity()]])}
      />,
    );
    await advanceStartDelay();

    rerender(
      <LiveActivityTracker sessionId="session-b" sessionTitle="Session B" activities={makeActivities([])} />,
    );
    await act(async () => {});

    expect(plugin.end).toHaveBeenCalledWith({ phase: 'done', detail: '' });
  });

  it('swallows bridge failures so the chat turn is never affected', async () => {
    setNativeShell(true);
    plugin.start.mockRejectedValue(new Error('no entitlement'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <LiveActivityTracker
        sessionId="session-a"
        sessionTitle="Session A"
        activities={makeActivities([['session-a', makeActivity()]])}
      />,
    );

    await expect(advanceStartDelay()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
