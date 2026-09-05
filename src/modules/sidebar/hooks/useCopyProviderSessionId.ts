import { useRef, useState } from 'react';
import { Check, Copy, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';
import { copyTextToClipboard } from '@/shared/utils';

export type CopySessionIdState = 'loading' | 'idle' | 'copying' | 'copied' | 'error';

type UseCopyProviderSessionIdArgs = {
  sessionId: string;
  providerLabel: string;
  t: TFunction;
};

/**
 * Fetches and copies the provider session id for a session, sharing the
 * loading/copied/error state machine between the project-list session menu and
 * the recent-conversations menu.
 */
export function useCopyProviderSessionId({
  sessionId,
  providerLabel,
  t,
}: UseCopyProviderSessionIdArgs) {
  const [copyState, setCopyState] = useState<CopySessionIdState>('idle');
  const [providerSessionId, setProviderSessionId] = useState<string | null>(null);
  const providerIdRequestRef = useRef(0);

  const loadProviderSessionId = async () => {
    const requestId = ++providerIdRequestRef.current;
    setCopyState('loading');
    try {
      const response = await api.providerSessionId(sessionId);
      const payload = await response.json();
      const loadedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof loadedSessionId !== 'string' || !loadedSessionId) {
        throw new Error('Provider session ID is unavailable');
      }

      if (requestId !== providerIdRequestRef.current) return;
      setProviderSessionId(loadedSessionId);
      setCopyState('idle');
    } catch {
      if (requestId !== providerIdRequestRef.current) return;
      setProviderSessionId(null);
      setCopyState('error');
    }
  };

  const resetCopyState = () => {
    providerIdRequestRef.current += 1;
    setCopyState('idle');
    setProviderSessionId(null);
  };

  // Fetch the id lazily when the menu opens and clear stale state on close.
  const onOptionsOpen = (open: boolean) => {
    if (open) {
      setProviderSessionId(null);
      void loadProviderSessionId();
    } else {
      resetCopyState();
    }
  };

  const copyProviderSessionId = async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }

    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  };

  const handleCopyAction = () => {
    if (copyState === 'error' && !providerSessionId) {
      void loadProviderSessionId();
    } else {
      void copyProviderSessionId();
    }
  };

  const isCopyPending = copyState === 'loading' || copyState === 'copying';
  const CopyStateIcon: LucideIcon = copyState === 'copied' ? Check : Copy;
  const copyLabel = copyState === 'loading'
    ? t('sessions.loadingSessionId', { provider: providerLabel })
    : copyState === 'copied'
      ? t('sessions.sessionIdCopied', { provider: providerLabel })
      : copyState === 'error'
        ? providerSessionId
          ? t('sessions.copySessionIdFailed', { provider: providerLabel })
          : t('sessions.sessionIdUnavailable', { provider: providerLabel })
        : t('sessions.copySessionId', { provider: providerLabel });

  return {
    copyState,
    copyLabel,
    isCopyPending,
    CopyStateIcon,
    handleCopyAction,
    onOptionsOpen,
  };
}
