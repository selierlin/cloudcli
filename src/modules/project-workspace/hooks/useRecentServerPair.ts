import { Preferences } from '@capacitor/preferences';
import { useEffect, useState } from 'react';

import type { SavedServer } from '@/shared/types';
import { findSavedServerByOrigin, isCapacitorNativeShell } from '@/shared/utils';

/**
 * Origins of the servers this device showed most recently, newest first. Shared
 * across every live WebView because preferences are native storage, which is
 * what lets the copy in the hidden WebView stay untouched: only the visible one
 * records, mirroring the RestoreTargetTracker guard.
 */
const RECENT_SERVERS_KEY = 'cloudcli.recentServers';

/** Keeps only entries that look like an origin, so a corrupt list cannot poison the MRU. */
function isOrigin(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * The server the user was on before this one, for the workspace switcher's
 * back-and-forth tap. Records this WebView's origin as "most recent" whenever it
 * becomes visible, keeping the last two — the same two the native shell keeps
 * alive, so toggling between them costs no load.
 *
 * Returns undefined until a previous server is known (first run, or the entry
 * was deleted from the picker), leaving the caller to fall back to list order.
 */
export function useRecentServerPair(servers: readonly SavedServer[]): SavedServer | undefined {
  // Async read of the shared MRU; held in state so the button re-renders with a
  // label once the previous server is known.
  const [recentOrigins, setRecentOrigins] = useState<string[]>([]);
  const currentOrigin = window.location.origin;

  useEffect(() => {
    if (!isCapacitorNativeShell()) {
      return undefined;
    }

    let disposed = false;

    const record = async () => {
      // A hidden sibling WebView keeps running its JS; letting it record would
      // make it look like the most recent server while the user sees another.
      if (document.visibilityState !== 'visible') {
        return;
      }

      try {
        const { value } = await Preferences.get({ key: RECENT_SERVERS_KEY });
        if (disposed) {
          return;
        }

        const saved: unknown = value ? JSON.parse(value) : [];
        const previous = Array.isArray(saved) ? saved.filter(isOrigin) : [];
        const next = [currentOrigin, ...previous.filter((origin) => origin !== currentOrigin)].slice(0, 2);

        setRecentOrigins(next);
        await Preferences.set({ key: RECENT_SERVERS_KEY, value: JSON.stringify(next) });
      } catch {
        // The MRU only chooses which server to offer next; a failure leaves the
        // caller on list order rather than breaking the button.
      }
    };

    void record();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void record();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [currentOrigin]);

  const previousOrigin = recentOrigins.find((origin) => origin !== currentOrigin);
  return previousOrigin ? findSavedServerByOrigin(servers, previousOrigin) : undefined;
}
