import { useEffect, useRef, useState } from 'react';

import { normalizedToChatMessages, useSessionStore } from '@/modules/chat';
import { api } from '@/shared/api';
import type { ChatMessage, ProjectSession, SessionOutlineItem } from '@/shared/types';

type QuickSettingsTab = 'settings' | 'outline';

type UseSessionOutlineDataOptions = {
  isOpen: boolean;
  selectedSession: ProjectSession | null;
  activeTab: QuickSettingsTab;
  /** Whether the "Export conversation" section is expanded (needs the full transcript). */
  exportExpanded: boolean;
};

/** Outline cache freshness window; mirrors the session store's stale threshold. */
const OUTLINE_STALE_MS = 30_000;

/**
 * Loads the selected session's data for the QuickSettings panel.
 *
 * - Outline tab: a lightweight `{ timestamp, snippet }` list from the outline
 *   endpoint. Opening the panel never downloads the full transcript just to
 *   show the outline.
 * - Export section expanded: the full transcript via the session store, reused
 *   from the existing per-session cache when complete and fresh.
 */
export function useSessionOutlineData({
  isOpen,
  selectedSession,
  activeTab,
  exportExpanded,
}: UseSessionOutlineDataOptions) {
  const sessionStore = useSessionStore();
  const [outlineItems, setOutlineItems] = useState<SessionOutlineItem[]>([]);
  const [isOutlineLoading, setIsOutlineLoading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const outlineCacheRef = useRef(new Map<string, { items: SessionOutlineItem[]; fetchedAt: number }>());
  const sessionId = selectedSession?.id ?? null;
  const needsFullTranscript = isOpen && exportExpanded;

  // Full transcript — only fetched when the export section is expanded.
  useEffect(() => {
    if (!needsFullTranscript || !sessionId) {
      setIsChatLoading(false);
      return;
    }
    let cancelled = false;
    // Reuse the cached full transcript when it's already complete and fresh,
    // so re-expanding export doesn't re-download the whole conversation.
    const cached = sessionStore.getSessionSlot(sessionId);
    if (
      cached &&
      cached.serverMessages.length > 0 &&
      !cached.hasMore &&
      !sessionStore.isStale(sessionId)
    ) {
      setIsChatLoading(false);
      return;
    }
    setIsChatLoading(true);
    sessionStore.setActiveSession(sessionId);
    void sessionStore
      .fetchFromServer(sessionId, {
        limit: null,
        offset: 0,
        canRequest: () => !cancelled,
      })
      .finally(() => {
        if (!cancelled) setIsChatLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsFullTranscript, sessionId, sessionStore]);

  // Lightweight outline — fetched on the outline tab, cached per sessionId for
  // OUTLINE_STALE_MS so tab switches stay instant.
  useEffect(() => {
    if (!isOpen || !sessionId || activeTab !== 'outline') {
      setIsOutlineLoading(false);
      return;
    }
    let cancelled = false;
    const cached = outlineCacheRef.current.get(sessionId);
    if (cached && Date.now() - cached.fetchedAt < OUTLINE_STALE_MS) {
      setOutlineItems(cached.items);
      setIsOutlineLoading(false);
      return;
    }
    setOutlineItems([]);
    setIsOutlineLoading(true);
    void api.providers
      .sessionOutline(sessionId)
      .then((response) => (cancelled || !response.ok ? undefined : response.json()))
      .then((payload) => {
        if (cancelled) return;
        const items = payload?.data;
        if (Array.isArray(items)) {
          outlineCacheRef.current.set(sessionId, { items, fetchedAt: Date.now() });
          setOutlineItems(items);
        }
      })
      .catch(() => {
        // Keep the previous outline (or the empty state) on network errors.
      })
      .finally(() => {
        if (!cancelled) setIsOutlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId, activeTab]);

  const chatMessages: ChatMessage[] = sessionId
    ? normalizedToChatMessages(sessionStore.getMessages(sessionId))
    : [];

  return {
    outlineItems,
    chatMessages,
    isLoading: activeTab === 'outline' ? isOutlineLoading : isChatLoading,
  };
}
