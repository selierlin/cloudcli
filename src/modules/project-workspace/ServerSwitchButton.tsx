import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSavedServers } from '@/shared/hooks/useSavedServers';
import { findSavedServerByOrigin, isCapacitorNativeShell, switchToSavedServer } from '@/shared/utils';
import { useRecentServerPair } from '@/modules/project-workspace/hooks/useRecentServerPair';

/**
 * Rendered by WorkspaceHeader beside the workspace tab strip: one tap returns to
 * the server the user was on before, so two servers can be flipped between
 * without the sidebar → project → menu detour. The native shell keeps exactly
 * two WebViews alive, so this pair usually costs no load. Falls back to the next
 * server in list order until a previous one is known.
 *
 * Native shell only — the ServerSession bridge this relies on does not exist in
 * a desktop browser, where the sidebar menu is one click away anyway.
 */
export default function ServerSwitchButton() {
  const { t } = useTranslation();
  const servers = useSavedServers();
  const previousServer = useRecentServerPair(servers);
  // Cleared in a finally: on success this WebView is already hidden so the reset
  // is invisible, and on failure it re-enables the tap for a retry.
  const [isSwitching, setIsSwitching] = useState(false);

  const currentServer = findSavedServerByOrigin(servers, window.location.origin);
  const currentIndex = currentServer ? servers.indexOf(currentServer) : -1;
  // Two or more servers are needed for a target to exist; with one, the tap
  // would just reload the server already on screen.
  const nextInList =
    servers.length > 1 ? servers[(currentIndex + 1) % servers.length] : undefined;
  const targetServer = previousServer ?? nextInList;

  if (!isCapacitorNativeShell() || !targetServer) {
    return null;
  }

  const nextLabel = targetServer.name || targetServer.url;
  const accessibleLabel = t('serverSwitch', { name: nextLabel });

  const handleSwitch = async () => {
    if (isSwitching) {
      return;
    }

    setIsSwitching(true);
    try {
      await switchToSavedServer(targetServer);
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleSwitch()}
      disabled={isSwitching}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="mr-3 flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-accent disabled:opacity-60 sm:mr-0"
    >
      {isSwitching ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <ArrowLeftRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  );
}
