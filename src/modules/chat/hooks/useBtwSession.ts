import { useCallback, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, NormalizedMessage, QueuedSendOptions } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * Where the side-question transcript starts.
 *
 * `forkAnchorId` is the value the provider's fork consumes; `messageId` is the
 * same message's display id, sent along so the server can also resolve an
 * anchor for a provider whose ids are not stable per read.
 */
export type BtwAnchorRequest = {
  forkAnchorId?: string;
  messageId?: string;
} | null;

type BtwAnchorInfo = {
  anchorForkId: string | null;
  anchorMessageId: string | null;
  anchorDegraded: boolean;
  anchorSource: 'default' | 'explicit';
};

/** Why closing failed: the copy is still busy, or the request did not land. */
export type BtwCloseFailure = 'still-running' | 'failed';

export type BtwController = {
  /** The hidden copy, once the first question has created it. */
  sessionId: string | null;
  /** A create request is in flight; the composer stays disabled meanwhile. */
  creating: boolean;
  /** A delete request is in flight; the drawer stays open until it resolves. */
  closing: boolean;
  /** Set when DELETE failed; the drawer keeps the copy and offers a retry. */
  closeFailure: BtwCloseFailure | null;
  /** Server error code from the last failed create, if any. */
  createError: string | null;
  /** The anchor the server actually forked at, once it answered. */
  anchorInfo: BtwAnchorInfo | null;
  /** Sends one question, creating the copy on the first call. */
  send: (text: string) => Promise<boolean>;
  /** Stops the copy's current turn without deleting the copy. */
  abort: () => void;
  /** Deletes the copy. True means the caller may close the drawer. */
  close: () => Promise<boolean>;
  /** Turns the copy into a normal conversation and returns its id. */
  promote: () => Promise<string | null>;
  /** Discards the copy and lets the next question fork again. */
  refork: () => Promise<boolean>;
  /** Forgets the local copy after a promotion; never deletes it. */
  discard: () => void;
  clearCreateError: () => void;
};

type UseBtwSessionArgs = {
  sourceSessionId: string | null;
  provider: LLMProvider;
  anchor: BtwAnchorRequest;
  sendMessage: (message: unknown) => void;
  sessionStore: SessionStore;
  /** The shared option builder, so a drawer send runs with the main composer's settings. */
  buildOptions: (text: string) => QueuedSendOptions;
};

/**
 * Owns the lifetime of one side-question copy: create on the first question,
 * send into it, then either delete it or promote it.
 *
 * Message accumulation is deliberately absent — the copy's rows live in the
 * shared session store slot and are read back from there, so there is exactly
 * one accumulation per event (see the plan's §6.3).
 */
export function useBtwSession({
  sourceSessionId,
  provider,
  anchor,
  sendMessage,
  sessionStore,
  buildOptions,
}: UseBtwSessionArgs): BtwController {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeFailure, setCloseFailure] = useState<BtwCloseFailure | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [anchorInfo, setAnchorInfo] = useState<BtwAnchorInfo | null>(null);

  // The anchor is read inside async continuations, which outlive the render
  // they began in. A ref keeps the create call on the anchor the reader chose
  // even when a later render replaced the prop.
  const anchorRef = useRef<BtwAnchorRequest>(anchor);
  anchorRef.current = anchor;
  // Blocks two submissions from forking two copies while the first POST is
  // still in flight (the send button is re-enabled by the next render only).
  const createInFlightRef = useRef(false);
  // The in-flight create, so `close()` can wait for it: a fork is slow enough
  // that the reader can shut the drawer mid-request, and deleting a copy that
  // does not exist yet would leave the fork running unwatched.
  const createPromiseRef = useRef<Promise<string | null> | null>(null);
  // Set when `close()` arrived during that create; the question waiting on it
  // must be dropped, or it would race the DELETE and resurrect the copy.
  const closedDuringCreateRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;

  const discard = useCallback(() => {
    const id = sessionIdRef.current;
    if (id) {
      sessionStore.setObservedSession(id, false);
      sessionStore.dropSession(id);
    }
    sessionIdRef.current = null;
    setSessionId(null);
    setAnchorInfo(null);
  }, [sessionStore]);

  /**
   * Creates the copy once; a second submission while the first POST is in
   * flight is dropped, and the promise is published so `close()` can join it.
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }
    if (!sourceSessionId || createInFlightRef.current) {
      return null;
    }

    createInFlightRef.current = true;
    setCreating(true);
    setCreateError(null);

    const pending = (async (): Promise<string | null> => {
      try {
        const requested = anchorRef.current;
        const response = await api.btwSession(sourceSessionId, {
          ...(requested?.forkAnchorId ? { anchorForkId: requested.forkAnchorId } : {}),
          ...(requested?.messageId ? { anchorMessageId: requested.messageId } : {}),
        });
        const payload = await response.json().catch(() => null);
        const created = payload?.data;

        if (!response.ok || typeof created?.sessionId !== 'string') {
          setCreateError(typeof payload?.error?.code === 'string' ? payload.error.code : 'BTW_CREATE_FAILED');
          return null;
        }

        const id = created.sessionId as string;
        sessionIdRef.current = id;
        setSessionId(id);
        setAnchorInfo({
          anchorForkId: typeof created.anchorForkId === 'string' ? created.anchorForkId : null,
          anchorMessageId: typeof created.anchorMessageId === 'string' ? created.anchorMessageId : null,
          anchorDegraded: created.anchorDegraded === true,
          anchorSource: created.anchorSource === 'explicit' ? 'explicit' : 'default',
        });

        // The copy is not the selected conversation, so the store needs to know
        // it must repaint for this slot, and the server needs a subscribe to
        // replay anything the run emitted before this point.
        sessionStore.setObservedSession(id, true);
        sendMessage({
          type: 'chat.subscribe',
          sessions: [{ sessionId: id, lastSeq: 0 }],
        });

        return id;
      } catch (error) {
        console.error('[btw] Failed to create the aside session:', error);
        setCreateError('BTW_CREATE_FAILED');
        return null;
      } finally {
        createInFlightRef.current = false;
        setCreating(false);
      }
    })();

    // Published before awaiting: a close that lands mid-fork reads this ref to
    // learn there is a copy on the way that it has to delete.
    createPromiseRef.current = pending;
    try {
      return await pending;
    } finally {
      createPromiseRef.current = null;
    }
  }, [sendMessage, sessionStore, sourceSessionId]);

  const send = useCallback(async (text: string): Promise<boolean> => {
    const content = text.trim();
    if (!content) {
      return false;
    }

    const id = await ensureSession();
    // A close that landed while the fork was in flight owns the copy now:
    // sending would both resurrect a session nobody can see and beat the DELETE.
    const closedWhileCreating = closedDuringCreateRef.current;
    closedDuringCreateRef.current = false;
    if (!id || closedWhileCreating) {
      return false;
    }

    // The server does not echo the question back to the sender, so the copy's
    // transcript would stay one turn behind until a reload. The optimistic row
    // is reconciled away once the persisted row arrives (store's
    // `removeOptimisticUserEchoes`).
    const optimistic: NormalizedMessage = {
      id: `btw-question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: id,
      timestamp: new Date().toISOString(),
      provider,
      kind: 'text',
      role: 'user',
      content,
    };
    sessionStore.appendRealtime(id, optimistic);

    sendMessage({
      type: 'chat.send',
      sessionId: id,
      content,
      options: buildOptions(content),
    });
    return true;
  }, [buildOptions, ensureSession, provider, sendMessage, sessionStore]);

  const abort = useCallback(() => {
    const id = sessionIdRef.current;
    if (!id) {
      return;
    }
    sendMessage({ type: 'chat.abort', sessionId: id });
  }, [sendMessage]);

  const close = useCallback(async (): Promise<boolean> => {
    setClosing(true);
    setCloseFailure(null);
    try {
      // Mid-fork there is no id yet, and returning "nothing to close" would
      // leave the copy to be created after the drawer is gone. Join the create
      // instead, then delete what it produced.
      const pendingCreate = createPromiseRef.current;
      if (pendingCreate) {
        closedDuringCreateRef.current = true;
        await pendingCreate.catch(() => null);
      }

      const id = sessionIdRef.current;
      if (!id) {
        return true;
      }

      const response = await api.deleteBtwSession(id);
      if (response.ok) {
        discard();
        return true;
      }

      const payload = await response.json().catch(() => null);
      // The copy is still unwinding: keep it observable so the reader can stop
      // it or retry, instead of hiding the only control that can settle it.
      setCloseFailure(payload?.error?.code === 'BTW_STILL_RUNNING' ? 'still-running' : 'failed');
      return false;
    } catch (error) {
      console.error('[btw] Failed to delete the aside session:', error);
      setCloseFailure('failed');
      return false;
    } finally {
      setClosing(false);
    }
  }, [discard]);

  const promote = useCallback(async (): Promise<string | null> => {
    const id = sessionIdRef.current;
    if (!id) {
      return null;
    }

    try {
      const response = await api.promoteBtwSession(id);
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        setCloseFailure('failed');
        return null;
      }
      // From here the row is a normal conversation: forgetting the local copy
      // must not delete it, or promoting would remove what the reader kept.
      discard();
      return id;
    } catch (error) {
      console.error('[btw] Failed to keep the aside session:', error);
      setCloseFailure('failed');
      return null;
    }
  }, [discard]);

  const refork = useCallback(async (): Promise<boolean> => {
    const closed = await close();
    if (!closed) {
      return false;
    }
    setCreateError(null);
    setCloseFailure(null);
    setAnchorInfo(null);
    return true;
  }, [close]);

  const clearCreateError = useCallback(() => setCreateError(null), []);

  return {
    sessionId,
    creating,
    closing,
    closeFailure,
    createError,
    anchorInfo,
    send,
    abort,
    close,
    promote,
    refork,
    discard,
    clearCreateError,
  };
}
