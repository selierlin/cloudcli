import { useEffect, useState } from 'react';

import type { ProjectSession } from '../../../types/app';
import { useSessionStore } from '../../../stores/useSessionStore';
import { normalizedToChatMessages } from '../../chat/hooks/useChatMessages';
import type { ChatMessage } from '../../chat/types/types';

type UseSessionOutlineDataOptions = {
  isOpen: boolean;
  selectedSession: ProjectSession | null;
};

/**
 * Loads the selected session's full transcript for the QuickSettings panel
 * (outline + export) using a panel-local store instance. Kept deliberately
 * isolated from the chat's own store so no chat data flow is disturbed.
 */
export function useSessionOutlineData({ isOpen, selectedSession }: UseSessionOutlineDataOptions) {
  const sessionStore = useSessionStore();
  const [isLoading, setIsLoading] = useState(false);
  const sessionId = selectedSession?.id ?? null;

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    let cancelled = false;
    // Reuse the cached full transcript when it's already complete and fresh,
    // so re-opening the panel doesn't re-download the whole conversation.
    // Stale sessions (active within the last 30s) still re-fetch to stay current.
    const cached = sessionStore.getSessionSlot(sessionId);
    if (
      cached &&
      cached.serverMessages.length > 0 &&
      !cached.hasMore &&
      !sessionStore.isStale(sessionId)
    ) {
      return;
    }
    setIsLoading(true);
    sessionStore.setActiveSession(sessionId);
    void sessionStore
      .fetchFromServer(sessionId, {
        limit: null,
        offset: 0,
        canRequest: () => !cancelled,
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId, sessionStore]);

  const chatMessages: ChatMessage[] = sessionId
    ? normalizedToChatMessages(sessionStore.getMessages(sessionId))
    : [];

  return { chatMessages, isLoading };
}
