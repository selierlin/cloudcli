import { Preferences } from '@capacitor/preferences';
import { useEffect, useState } from 'react';

import { CLOUDCLI_SERVERS_KEY } from '@/shared/constants';
import type { SavedServer } from '@/shared/types';
import { isCapacitorNativeShell } from '@/shared/utils';

/**
 * The server list the iOS picker saved in native preferences, empty outside the
 * native shell. Used by the sidebar server menu and the workspace switcher,
 * which both need the same current entry and the same "next" neighbour.
 *
 * The list is re-read whenever this WebView becomes visible again, not just on
 * mount: a switch only hides the previous WebView, so coming back from the
 * picker after adding or deleting a server would otherwise show a stale list.
 */
export function useSavedServers(): SavedServer[] {
  // Async storage, so the list arrives after the first render; keeping it in
  // state lets both consumers re-render once it does.
  const [servers, setServers] = useState<SavedServer[]>([]);

  useEffect(() => {
    if (!isCapacitorNativeShell()) {
      return undefined;
    }

    let disposed = false;

    const read = async () => {
      try {
        const { value } = await Preferences.get({ key: CLOUDCLI_SERVERS_KEY });
        if (disposed) {
          return;
        }
        if (!value) {
          // The picker removes the key when the last server is deleted; an
          // empty answer must clear the list, not keep the deleted entries
          // clickable.
          setServers([]);
          return;
        }

        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          setServers(parsed.filter(isSavedServer));
        }
      } catch {
        // A corrupt or unreadable list only hides the switchers; it must never
        // break the page that renders them.
      }
    };

    void read();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void read();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return servers;
}

/** Narrows one parsed preferences entry to the saved-server shape the switchers read. */
function isSavedServer(item: unknown): item is SavedServer {
  return typeof item === 'object' && item !== null && typeof (item as SavedServer).url === 'string';
}
