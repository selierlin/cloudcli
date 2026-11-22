import { useEffect, useRef, useState } from 'react';

import type { SessionActivity, SessionActivityMap } from '@/shared/types';
import { isCapacitorNativeShell } from '@/shared/utils';

/**
 * How long a run must have lasted before the island appears. A one-shot question
 * would otherwise flash a Live Activity and end it a second later; waiting costs
 * nothing on the runs that are long enough to be worth showing.
 */
const START_DELAY_MS = 2000;

/**
 * Minutes without an update before the system greys the island out. The app is
 * suspended a few seconds after it leaves the foreground and nothing refreshes
 * the content after that, so this is the only honest "this may be stale" signal
 * the reader gets.
 */
const STALE_AFTER_MINUTES = 15;

/** The island's four visual states; mirrors `CloudCLIActivityAttributes.Phase` in the iOS project. */
type LiveActivityPhase = 'running' | 'waiting' | 'done' | 'failed';

/** One rendered snapshot of a run, in the shape both the native bridge and the widget use. */
type ActivitySnapshot = {
  phase: LiveActivityPhase;
  detail: string;
};

/**
 * The four methods of the app-local `CloudCLIActivity` native plugin
 * (ios/App/App/CloudCLIActivityPlugin.swift) this module calls. Only iOS 16.2 and
 * later register it; `isSupported` is how we learn that without feature-sniffing
 * the platform version.
 */
type LiveActivityPlugin = {
  isSupported: () => Promise<{ supported: boolean; hasActivity: boolean }>;
  start: (options: {
    sessionTitle: string;
    serverLabel: string;
    deepLink: string;
    phase: LiveActivityPhase;
    detail: string;
    startedAt: number;
    staleAfterMinutes: number;
  }) => Promise<unknown>;
  update: (options: {
    phase: LiveActivityPhase;
    detail: string;
    staleAfterMinutes: number;
  }) => Promise<unknown>;
  end: (options: { phase: LiveActivityPhase; detail: string }) => Promise<unknown>;
};

type LiveActivityTrackerProps = {
  /** The session the reader is looking at. Only this session's run may open a new island. */
  sessionId: string | null;
  /** Session title shown on the island; an empty string falls back to the app name natively. */
  sessionTitle: string;
  /** Every busy session on the server, so a run survives switching conversations mid-flight. */
  activities: SessionActivityMap;
};

/**
 * Rendered by ChatInterface to mirror the run the reader is watching onto the iOS
 * Dynamic Island / Lock Screen as a Live Activity. Renders nothing, and is inert
 * in a browser, on desktop, and on iOS builds without ActivityKit.
 *
 * Why the mapping lives here rather than in the chat hooks: it is a presentation
 * concern of the mobile shell, it must outlive a conversation switch, and it has
 * to stay off the critical path of the chat turn (every bridge failure is swallowed).
 */
export function LiveActivityTracker({ sessionId, sessionTitle, activities }: LiveActivityTrackerProps) {
  // Which run the island currently represents. Not derivable from props: the
  // reader can switch conversations while that run continues, and the island
  // must keep following the original session until it goes idle.
  const [watchedSessionId, setWatchedSessionId] = useState<string | null>(null);
  // The last snapshot handed to the bridge, so re-renders only cross the bridge
  // when the island's visible content actually changes. `null` means "nothing
  // known to be on screen", which re-sends after a teardown.
  const lastSentRef = useRef<string | null>(null);
  // Sticky "this build/device will not show activities" flag (iOS < 16.2, or the
  // per-app Live Activities switch is off). Retrying on every frame is pointless.
  const unsupportedRef = useRef(false);

  // Opens the island once the viewed session has been running long enough. A run
  // that finishes inside START_DELAY_MS never shows anything at all.
  useEffect(() => {
    if (unsupportedRef.current || watchedSessionId || !sessionId) return;
    const activity = activities.get(sessionId);
    if (!activity || activity.background) return;

    const remaining = Math.max(0, START_DELAY_MS - (Date.now() - activity.startedAt));
    const timer = window.setTimeout(() => {
      void (async () => {
        const plugin = resolvePlugin();
        if (!plugin) return;

        try {
          const support = await plugin.isSupported();
          if (!support.supported) {
            unsupportedRef.current = true;
            return;
          }

          const snapshot = describeActivity(activity);
          await plugin.start({
            sessionTitle,
            serverLabel: window.location.host,
            deepLink: buildDeepLink(),
            phase: snapshot.phase,
            detail: snapshot.detail,
            // The run's own start, not "now": a Live Activity opened for a run that
            // is already 40s old must show 0:40, not 0:00.
            startedAt: Math.floor(activity.startedAt / 1000),
            staleAfterMinutes: STALE_AFTER_MINUTES,
          });
          lastSentRef.current = snapshotKey(snapshot);
          setWatchedSessionId(sessionId);
        } catch (error) {
          // A missing entitlement, a system switch, or a race with the session ending:
          // never let the island break the chat turn it is describing.
          console.warn('[live-activity] unable to open the Live Activity:', error);
        }
      })();
    }, remaining);

    return () => window.clearTimeout(timer);
  }, [activities, sessionId, sessionTitle, watchedSessionId]);

  // Keeps the watched run's island in step, and closes it once that session stops
  // working — even if the reader has moved on to another conversation.
  useEffect(() => {
    if (!watchedSessionId) return;

    const activity = activities.get(watchedSessionId);
    if (!activity || activity.background) {
      lastSentRef.current = null;

      void (async () => {
        const plugin = resolvePlugin();
        try {
          // `done` unconditionally: the client never learns whether a turn failed,
          // and a wrong ✓ is milder than an island frozen on "running".
          if (plugin) await plugin.end({ phase: 'done', detail: '' });
        } catch (error) {
          console.warn('[live-activity] unable to close the Live Activity:', error);
        }
        // Released after the bridge settles, never synchronously inside the effect:
        // that would re-render this null component in the middle of the same pass.
        setWatchedSessionId(null);
      })();
      return;
    }

    const snapshot = describeActivity(activity);
    const key = snapshotKey(snapshot);
    if (key === lastSentRef.current) return;

    void (async () => {
      const plugin = resolvePlugin();
      if (!plugin) return;
      try {
        await plugin.update({ ...snapshot, staleAfterMinutes: STALE_AFTER_MINUTES });
        lastSentRef.current = key;
      } catch (error) {
        // Swiped away by the reader, or the app's Live Activities switch was turned
        // off mid-run. Keep the state as-is: the run's end still calls `end` (which
        // clears the watch) and the next run can open a fresh activity.
        console.warn('[live-activity] unable to update the Live Activity:', error);
      }
    })();
  }, [activities, watchedSessionId]);

  return null;
}

/**
 * The app-local `CloudCLIActivity` bridge, or null in a browser/desktop bundle and
 * on iOS builds too old to register it.
 */
function resolvePlugin(): LiveActivityPlugin | null {
  if (!isCapacitorNativeShell()) return null;
  const capacitor = (window as unknown as {
    Capacitor?: { registerPlugin?: (name: string) => unknown };
  }).Capacitor;
  const plugin = capacitor?.registerPlugin?.('CloudCLIActivity');
  return (plugin as LiveActivityPlugin | undefined) ?? null;
}

/** Maps a busy session onto the island's phases; a pending tool approval outranks "running". */
function describeActivity(activity: SessionActivity): ActivitySnapshot {
  const isWaiting = Boolean(activity.pendingPermissions && activity.pendingPermissions.length > 0);
  return {
    phase: isWaiting ? 'waiting' : 'running',
    // The provider's own status line is the only per-run text worth showing; the
    // widget falls back to the phase label when it is empty.
    detail: activity.statusText ?? '',
  };
}

/** Identity of a snapshot, to tell a real change from a re-render. */
function snapshotKey(snapshot: ActivitySnapshot): string {
  return `${snapshot.phase}|${snapshot.detail}`;
}

/**
 * Tap-through target. Bark's notifications already use this custom scheme, and the
 * native side validates the origin against the saved servers before loading it, so
 * the island reuses it instead of inventing a second deep-link format.
 */
function buildDeepLink(): string {
  if (typeof window === 'undefined' || !window.location?.href) return '';
  return `cloudcli://open?url=${encodeURIComponent(window.location.href)}`;
}
