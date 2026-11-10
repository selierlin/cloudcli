import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { api } from '@/shared/api';
import type { BtwAnchorRequest, BtwController } from '@/modules/chat/hooks/useBtwSession';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { StreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import {
  clearBtwSnapshot,
  extractStreamingSeed,
  readBtwSnapshot,
  writeBtwSnapshot,
} from '@/modules/chat/utils/btwSnapshot';

type UseBtwRestoreArgs = {
  btw: BtwController;
  sessionStore: SessionStore;
  lastSeqRef: MutableRefObject<Map<string, number>>;
  streamBuffers: StreamingBufferRegistry;
  sendMessage: (message: unknown) => void;
  /** Whether the copy is running a turn right now; a finished turn is a save point. */
  processing: boolean;
  /** The conversation on screen. A snapshot only restores onto its own source. */
  sourceSessionId: string | null;
  /** The cut point the drawer holds, so it survives the reload too. */
  anchor: BtwAnchorRequest;
  minimized: boolean;
  /** Auth and socket are prerequisites: a 401 must not read as "the copy is gone". */
  isAuthReady: boolean;
  isConnected: boolean;
  /** Puts the restored drawer back on screen. */
  onRestored: (state: { anchor: BtwAnchorRequest; minimized: boolean; truncated: boolean }) => void;
};

/**
 * Brings the side-question drawer back after a reload.
 *
 * The drawer's id lives only in React state, and the copy's transcript is only
 * ever accumulated in the session store, so nothing about it survives on its
 * own. This hook writes a snapshot to `sessionStorage` while the drawer is
 * open and, on the next load, replays it into the same places: the copy id into
 * `useBtwSession`, the rows into the store, the in-flight prose into the
 * streaming buffer, and a subscription so the server keeps streaming into it.
 *
 * See docs/research/CloudCLI侧边提问刷新恢复方案.md.
 */
export function useBtwRestore({
  btw,
  sessionStore,
  lastSeqRef,
  streamBuffers,
  sendMessage,
  processing,
  sourceSessionId,
  anchor,
  minimized,
  isAuthReady,
  isConnected,
  onRestored,
}: UseBtwRestoreArgs): {
  /** Feeds the ack of a restored copy's subscription back in. */
  handleSubscribeAck: (sessionId: string, isProcessing: boolean) => void;
} {
  // idle → waiting (snapshot belongs to another conversation) → attempted.
  // Once attempted, this tab stops trying: a drawer the reader closed must not
  // come back on the next session switch.
  const phaseRef = useRef<'idle' | 'waiting' | 'attempted'>('idle');
  // Set when the snapshot carried half a reply. Its ack decides whether that
  // reply is still running or froze at the reload.
  const pendingSealRef = useRef<string | null>(null);
  // Whether this tab has ever had to drop turns to fit; the notice survives
  // later saves of an already-trimmed transcript.
  const truncatedRef = useRef(false);
  // Which copy the flag above describes, so forking a new one clears it.
  const truncatedForRef = useRef<string | null>(null);

  // Read at save/probe time, so neither depends on the render that started it.
  // Filled in an effect rather than during render: both readers (a lifecycle
  // event and an awaited probe continuation) run long after paint.
  const latestRef = useRef({ btw, anchor, minimized, onRestored });
  useEffect(() => {
    latestRef.current = { btw, anchor, minimized, onRestored };
  });

  const aliveRef = useRef(true);
  useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  const writeSnapshot = useCallback(() => {
    const { btw: current, anchor: currentAnchor, minimized: currentMinimized } = latestRef.current;
    if (!current.sessionId || !current.forkSourceSessionId) {
      return;
    }
    if (truncatedForRef.current !== current.sessionId) {
      truncatedRef.current = false;
      truncatedForRef.current = current.sessionId;
    }
    truncatedRef.current = writeBtwSnapshot({
      forkSourceSessionId: current.forkSourceSessionId,
      sessionId: current.sessionId,
      lastSeq: lastSeqRef.current.get(current.sessionId) ?? 0,
      anchor: currentAnchor,
      anchorInfo: current.anchorInfo,
      runParams: current.runParams,
      minimized: currentMinimized,
      messages: sessionStore.getMessages(current.sessionId),
      truncated: truncatedRef.current,
    });
  }, [lastSeqRef, sessionStore]);

  useEffect(() => {
    // `pagehide` covers a reload, a close and back/forward. `visibilitychange`
    // is the iOS fallback, where a backgrounded tab can be killed without
    // ever firing `pagehide`. Both write synchronously: an await in here would
    // lose the race with the freeze.
    const onPageHide = () => writeSnapshot();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        writeSnapshot();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [writeSnapshot]);

  // A finished turn is the cheap save point for a tab killed without any
  // lifecycle event: it is the last moment the transcript is complete and
  // nothing else is about to change it.
  const wasProcessingRef = useRef(processing);
  useEffect(() => {
    const was = wasProcessingRef.current;
    wasProcessingRef.current = processing;
    if (was && !processing) {
      writeSnapshot();
    }
  }, [processing, writeSnapshot]);

  /** Whether this drawer already holds a copy; the restore effect keys off it. */
  const liveSessionId = btw.sessionId;

  useEffect(() => {
    if (phaseRef.current === 'attempted') {
      return;
    }
    if (!isAuthReady || !isConnected || !sourceSessionId) {
      return;
    }
    if (liveSessionId) {
      // This drawer is already live — nothing to bring back.
      phaseRef.current = 'attempted';
      return;
    }

    const snapshot = readBtwSnapshot();
    if (!snapshot) {
      phaseRef.current = 'attempted';
      return;
    }
    if (snapshot.forkSourceSessionId !== sourceSessionId) {
      // Another conversation is open. The snapshot stays put: switching to its
      // source is exactly how the reader gets the drawer back.
      phaseRef.current = 'waiting';
      return;
    }

    phaseRef.current = 'attempted';

    void (async () => {
      try {
        // No transport error is treated as "gone": only a definite answer that
        // the row is missing may discard the snapshot.
        const response = await api.sessionDetails(snapshot.sessionId);
        if (!response.ok) {
          if (response.status === 404) {
            clearBtwSnapshot();
            return;
          }
          const payload = await response.json().catch(() => null);
          if (payload?.error?.code === 'SESSION_NOT_FOUND') {
            clearBtwSnapshot();
          }
          return;
        }
      } catch {
        return;
      }

      if (!aliveRef.current) {
        return;
      }

      const { btw: current, onRestored: restoreUi } = latestRef.current;
      const id = snapshot.sessionId;

      // 1. The id first: the drawer reads its transcript through it, and the
      //    ack of the subscription below is matched against the rendered one.
      current.restore({
        sessionId: id,
        forkSourceSessionId: snapshot.forkSourceSessionId,
        anchorInfo: snapshot.anchorInfo ?? null,
        runParams: snapshot.runParams,
      });
      // 2. The rows, in one merge and one repaint.
      sessionStore.seedSession(id, snapshot.messages);
      // 3. Resume the replay where this tab left off, not at the buffer start.
      lastSeqRef.current.set(id, snapshot.lastSeq);
      // 4. Hand the in-flight prose to the buffer, so the next delta extends it
      //    instead of replacing it.
      const seed = extractStreamingSeed(snapshot.messages);
      if (seed) {
        streamBuffers.seed(id, seed.text, seed.thinking, seed.provider);
        pendingSealRef.current = id;
      }
      // 5. The copy is not the selected conversation, but it must repaint.
      sessionStore.setObservedSession(id, true);
      // 6. And the server must replay what this tab missed while it reloaded.
      sendMessage({
        type: 'chat.subscribe',
        sessions: [{ sessionId: id, lastSeq: snapshot.lastSeq }],
      });
      // 7. Finally the drawer itself. Always tucked away: a panel that pops
      //    open on load is not what reloading a hidden drawer should do, so
      //    the saved `minimized` is recorded but not replayed.
      truncatedRef.current = snapshot.truncated;
      truncatedForRef.current = id;
      restoreUi({ anchor: snapshot.anchor, minimized: true, truncated: snapshot.truncated });
    })();
  }, [isAuthReady, isConnected, lastSeqRef, liveSessionId, sendMessage, sessionStore, sourceSessionId, streamBuffers]);

  useEffect(() => {
    if (!liveSessionId) {
      pendingSealRef.current = null;
    }
  }, [liveSessionId]);

  const handleSubscribeAck = useCallback((sessionId: string, isProcessing: boolean) => {
    if (pendingSealRef.current !== sessionId) {
      return;
    }
    if (isProcessing) {
      // Still running: the buffer stays and the live deltas keep extending it.
      return;
    }
    pendingSealRef.current = null;
    // The turn ended inside the reload window, so no `stream_end` will ever
    // arrive for it: settle the half row here or it stays "generating" until
    // the drawer is closed.
    sessionStore.finalizeStreaming(sessionId);
    streamBuffers.drop(sessionId);
  }, [sessionStore, streamBuffers]);

  return { handleSubscribeAck };
}
