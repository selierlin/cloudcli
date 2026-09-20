import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api } from '@/shared/api';
import type { MarkSessionIdle, SessionActivityMap,Project,ProjectSession,LLMProvider,NormalizedMessage,ChatMessage,DiffCalculator,TranscriptRevealRequest } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { SESSION_MESSAGES_PAGE_SIZE } from '@/modules/chat/utils/sessionMessagePagination';
import { createMessageHistoryRefreshCoordinator } from '@/modules/chat/utils/messageHistoryRefreshCoordinator';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { findSearchTargetIndex, resolveSearchWindowSize } from '@/modules/chat/utils/searchTargetLocator';
import { readSelectedProvider } from '@/shared/selectedProvider';
import type { SearchTarget } from '@/modules/chat/utils/searchTargetLocator';

const INITIAL_VISIBLE_MESSAGES = 100;

/**
 * Height a page must insert above the reader before the pager latches its
 * one-page-per-visit guard, and the distance the reader must move back down to
 * release it.
 *
 * Both sides are the same number on purpose: latching on a page that the reader
 * cannot scroll through would make the release condition unreachable and the
 * pager would never serve another page. A page can insert nothing at all — a
 * truncated window collapses every execution row into a `display:none` member of
 * its turn's process group, and that group's summary row is drawn at its first
 * member, which lives in an older page that is not loaded yet. The store then
 * grows while the screen does not move, the reader stays pinned at the top, and
 * every later wheel/touch event is swallowed by the guard while the "showing N
 * of M" bar stays on screen.
 */
const TOP_LOAD_LOCK_MIN_PROGRESS_PX = 20;

/** Messages kept below a search hit so it lands mid-viewport rather than at the edge. */
const SEARCH_TARGET_CONTEXT_MESSAGES = 20;

/**
 * Widening the window can commit thousands of rows on an old hit, each running
 * the markdown pipeline, so the scroll waits about three seconds for that render
 * — the same budget the previous DOM scan used.
 */
const SEARCH_SCROLL_RETRIES = 20;
const SEARCH_SCROLL_RETRY_DELAY_MS = 150;

/**
 * How far `scrollTop` must fall between two `scroll` samples before the move
 * counts as the reader scrolling up rather than geometry changing underneath a
 * stationary viewport. Sub-pixel jitter and momentum rounding both sit well
 * below this.
 */
const SCROLL_UP_EPSILON_PX = 2;

/**
 * How long a gesture that pulls the transcript down keeps counting as upward
 * intent. Streaming can grow the transcript faster than a slow drag moves the
 * viewport, so between two samples `scrollTop` may not fall at all even though
 * the reader is deliberately pulling away from the bottom; the gesture is then
 * the only evidence that the reader, not the layout, owns the viewport.
 */
const SCROLL_UP_INTENT_WINDOW_MS = 800;

/**
 * Pinned-row drift below which the restore's settle loop counts a frame as
 * stable. Matches the follow loop's tolerance for sub-pixel jitter.
 */
const ANCHOR_SETTLE_EPSILON_PX = 1;

/**
 * Consecutive stable frames the restore's settle loop needs before it stands
 * down, so one clean frame cannot end the pin while more lazy rows are still
 * mounting real content above the reader.
 */
const ANCHOR_SETTLE_STABLE_FRAMES = 2;

/**
 * Hard ceiling on the restore's settle loop. Prepended rows land as
 * estimated-height placeholders and settle to real heights within a few
 * hundred milliseconds; anything that takes longer than this is not settling
 * geometry, and the loop must not fight the reader over a stuck layout.
 */
const ANCHOR_SETTLE_MAX_MS = 2500;

/** Downward finger travel that makes a touch a read-up gesture rather than a tap. */
const TOUCH_UP_INTENT_MIN_TRAVEL_PX = 10;

/**
 * Finds the rendered row for a resolved search target.
 *
 * Only an exact timestamp match counts while retries remain: the widened window
 * may not be committed yet, and accepting the nearest row then would scroll to
 * an arbitrary message and flash the highlight on it — the silent wrong answer
 * this rewrite exists to remove. `allowNearest` is used on the final attempt
 * because a hit on the second or later call of a collapsed tool group has no row
 * of its own; groupConsecutiveTools stamps the group with the run's FIRST
 * timestamp, so the group row is the nearest, not an exact, match.
 */
function findRenderedMessageElement(
  container: HTMLElement,
  timestamp: unknown,
  allowNearest: boolean,
): HTMLElement | null {
  const targetTimestamp = String(timestamp);
  const targetTime = new Date(targetTimestamp).getTime();
  const candidates = container.querySelectorAll<HTMLElement>('[data-message-timestamp]');

  let nearest: HTMLElement | null = null;
  let nearestDistance = Infinity;

  for (const candidate of candidates) {
    const candidateTimestamp = candidate.getAttribute('data-message-timestamp');
    if (!candidateTimestamp) {
      continue;
    }
    if (candidateTimestamp === targetTimestamp) {
      return candidate;
    }

    if (!allowNearest) {
      continue;
    }

    const candidateTime = new Date(candidateTimestamp).getTime();
    if (!Number.isFinite(candidateTime) || !Number.isFinite(targetTime)) {
      continue;
    }

    const distance = Math.abs(candidateTime - targetTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }

  return nearest;
}
/** Stable empty list so `chatMessages` keeps its identity while no session is selected. */
const NO_MESSAGES: NormalizedMessage[] = [];

type UseChatSessionStateArgs = {
  isActive: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  processingSessions?: SessionActivityMap;
  onSessionIdle?: MarkSessionIdle;
  /** When each session's `chat.subscribe` was last sent; guards stale idle acks. */
  statusCheckSentAtRef: MutableRefObject<Map<string, number>>;
  /** Highest live seq observed per session; sent as `lastSeq` on subscribe. */
  lastSeqRef: MutableRefObject<Map<string, number>>;
  sessionStore: SessionStore;
};

type ScrollRestoreState = {
  height: number;
  top: number;
  /**
   * Pinned row wrapper (carries `data-message-timestamp`), the first one at or
   * below the viewport top. The wrapper — not the `.chat-message` inside it —
   * is the anchor because it stays in the DOM across lazy unmounts, so the
   * baseline survives the fetch and the settle loop that follows the restore.
   */
  anchor: HTMLElement | null;
  anchorOffset: number | null;
  /**
   * Last row wrapper, kept so the anchor-less fallback can still isolate the
   * above-insertion: its top is displaced only by content inserted above it,
   * never by streaming growth at the tail, which a whole-container
   * `scrollHeight` delta cannot distinguish.
   */
  tailAnchor: HTMLElement | null;
  tailAnchorOffset: number | null;
};

function captureScrollRestoreState(container: HTMLDivElement): ScrollRestoreState | null {
  // A transcript that cannot scroll has no position worth restoring. That is
  // the pane mounting before its rows have measured, and a hidden tab: both
  // report a viewport-tall box at `scrollTop` 0, so an anchor taken from it
  // would be the first row of a stack that has not been laid out, and the
  // restore would land on a clamped offset that the session-open
  // scroll-to-bottom then drags away from — the reader sees the transcript
  // jump instead of opening at the bottom. Returning no baseline leaves that
  // commit to its real owner.
  if (container.scrollHeight <= container.clientHeight) return null;

  const containerBounds = container.getBoundingClientRect();
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-message-timestamp]'));
  const anchor = rows
    .find((element) => element.getBoundingClientRect().bottom >= containerBounds.top)
    ?? null;
  const tailAnchor = rows.length > 0 ? rows[rows.length - 1] : null;
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top - containerBounds.top : null;
  const tailAnchorOffset = tailAnchor
    ? tailAnchor.getBoundingClientRect().top - containerBounds.top
    : null;

  return {
    height: container.scrollHeight,
    top: container.scrollTop,
    anchor,
    anchorOffset,
    tailAnchor,
    tailAnchorOffset,
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: Convert a ChatMessage to a NormalizedMessage for the store */
/* ------------------------------------------------------------------ */

function chatMessageToNormalized(
  msg: ChatMessage,
  sessionId: string,
  provider: LLMProvider,
): NormalizedMessage | null {
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = msg.timestamp instanceof Date
    ? msg.timestamp.toISOString()
    : typeof msg.timestamp === 'number'
      ? new Date(msg.timestamp).toISOString()
      : String(msg.timestamp);
  const base = { id, sessionId, timestamp: ts, provider };

  if (msg.isToolUse) {
    return {
      ...base,
      kind: 'tool_use',
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      toolId: msg.toolId || id,
    } as NormalizedMessage;
  }
  if (msg.isThinking) {
    return { ...base, kind: 'thinking', content: msg.content || '' } as NormalizedMessage;
  }
  if ((msg as any).isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: (msg as any).taskStatus || 'completed',
      summary: msg.content || '',
    } as NormalizedMessage;
  }
  if (msg.type === 'error') {
    return { ...base, kind: 'error', content: msg.content || '' } as NormalizedMessage;
  }
  return {
    ...base,
    kind: 'text',
    role: msg.type === 'user' ? 'user' : 'assistant',
    content: msg.content || '',
    // Keep attachment references on the local echo so the user bubble shows
    // its files immediately, before the server-backed copy replaces it.
    images: Array.isArray(msg.images) && msg.images.length > 0 ? msg.images : undefined,
    files: Array.isArray(msg.files) && msg.files.length > 0 ? msg.files : undefined,
    // Survives the truncation that follows an edit, which clears every other
    // live row.
    replacesAnchorId: msg.replacesAnchorId,
  } as NormalizedMessage;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatSessionState({
  isActive,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  externalMessageUpdate,
  newSessionTrigger,
  processingSessions,
  onSessionIdle,
  statusCheckSentAtRef,
  lastSeqRef,
  sessionStore,
}: UseChatSessionStateArgs) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUpState] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  /**
   * Bumped by every arm of `pendingScrollRestoreRef`.
   *
   * It is the consuming layout effect's dependency because the restore must land
   * on the commit that mounts the widened render window, and nothing else in the
   * dependency space reliably changes then: widening the window (pagination,
   * "load earlier", "load all") changes geometry while the store — and therefore
   * `chatMessages.length` — stays the same. Keying the effect on that length left
   * the armed state alive past its own commit, so it fired on a later, unrelated
   * one (a streamed row) and moved the viewport.
   */
  const [scrollRestoreEpoch, setScrollRestoreEpoch] = useState(0);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wasNearTopRef = useRef(false);
  // The sidebar-search hit this transcript still owes the user a scroll to.
  // State rather than a ref because resolving it widens the render window,
  // and it is cleared once the row is on screen or the retries run out.
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  // Identifies the search hit the pane must reveal (expand its process run
  // and tool group) before the scroll/highlight step runs; the rising
  // requestId lets the pane distinguish a new hit from a repeated one.
  const [searchRevealRequest, setSearchRevealRequest] = useState<TranscriptRevealRequest | null>(null);
  const searchRevealRequestIdRef = useRef(0);
  const searchScrollActiveRef = useRef(false);
  /**
   * The pending step of the search-jump retry chain, so a session change can
   * cancel a jump that belongs to the transcript the user just left.
   */
  const searchScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest user scroll ownership, read synchronously by queued animation frames. */
  const isUserScrolledUpRef = useRef(false);
  /**
   * `scrollTop` at the previous `scroll` sample. A programmatic follow write and
   * content growth both produce `scroll` events, and neither means the reader
   * asked to stop following; a fall between samples does.
   */
  const lastScrollTopSampleRef = useRef<number | null>(null);
  /** Deadline until which a reader gesture counts as upward intent. */
  const upwardIntentUntilRef = useRef(0);
  /** `clientY` where the current touch drag began, or null between drags. */
  const touchOriginYRef = useRef<number | null>(null);
  /**
   * Bumped on every reader gesture (wheel or touch) as it arrives. The restore's
   * settle loop captures this at start and stands down only once it changes: a
   * touch's inertia tail keeps writing `scrollTop` for hundreds of ms with no
   * finger on the glass and no further `touchmove`, so reading `scrollTop` alone
   * cannot tell that apart from the reader taking over.
   */
  const readerInputSeqRef = useRef(0);
  /** The sole queued streaming follow write, shared across transcript updates. */
  const followFrameRef = useRef<number | null>(null);
  /** Minimum deadline before an animated handoff may be considered settled. */
  const followUntilRef = useRef(0);
  /** Last post-write geometry observed by the single transcript follow loop. */
  const followGeometryRef = useRef<string | null>(null);
  /** Consecutive rendered frames whose post-write geometry matched. */
  const followStableFramesRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  /** The queued frame of the restore's pinned-row settle loop. */
  const anchorSettleFrameRef = useRef<number | null>(null);
  /**
   * Live state of the restore's pinned-row settle loop: the wrapper row to
   * hold at `anchorOffset` while prepended placeholder rows settle to real
   * heights, plus the reader-input counter captured when the loop started, so
   * only a gesture that arrives after the restore stands the loop down.
   */
  const anchorSettleRef = useRef<{
    sessionId: string;
    anchor: HTMLElement;
    anchorOffset: number;
    inputSeq: number;
    stableFrames: number;
    startedAt: number;
  } | null>(null);
  /** Stands the pinned-row settle loop down, e.g. on a session change. */
  const cancelAnchorSettle = useCallback(() => {
    if (anchorSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(anchorSettleFrameRef.current);
      anchorSettleFrameRef.current = null;
    }
    anchorSettleRef.current = null;
  }, []);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedSessionKeyRef = useRef<string | null>(null);

  const setIsUserScrolledUp = useCallback((next: boolean) => {
    isUserScrolledUpRef.current = next;
    if (next) {
      followUntilRef.current = 0;
      followGeometryRef.current = null;
      followStableFramesRef.current = 0;
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    }
    setIsUserScrolledUpState(next);
  }, []);
  /**
   * Tracks the last processed value from `useProjectsState.newSessionTrigger`.
   *
   * The trigger itself is intentionally increment-only and routed via:
   * useProjectsState -> ProjectWorkspaceRoute -> WorkspaceMain -> ChatInterface -> this hook.
   * We compare values to ensure each explicit New Session click runs exactly one
   * reset pass in this local chat state domain.
   */
  const previousNewSessionTriggerRef = useRef(newSessionTrigger ?? 0);

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  useLayoutEffect(() => {
    const trigger = newSessionTrigger ?? 0;
    if (trigger === previousNewSessionTriggerRef.current) {
      return;
    }
    previousNewSessionTriggerRef.current = trigger;

    setCurrentSessionId(null);
    setPendingUserMessage(null);
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);

    setTokenBudget(null);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setSearchTarget(null);
    wasNearTopRef.current = false;
    searchScrollActiveRef.current = false;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    cancelAnchorSettle();
    pendingInitialScrollRef.current = true;
    lastLoadedSessionKeyRef.current = null;

    if (loadAllOverlayTimerRef.current) {
      clearTimeout(loadAllOverlayTimerRef.current);
      loadAllOverlayTimerRef.current = null;
    }
    if (loadAllFinishedTimerRef.current) {
      clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = null;
    }
  }, [newSessionTrigger, onSessionIdle, cancelAnchorSettle]);

  /* ---------------------------------------------------------------- */
  /*  Derive processing state for the viewed session                  */
  /* ---------------------------------------------------------------- */

  const activeSessionId = selectedSession?.id || currentSessionId || null;

  // The activity indicator always reflects the latest status of the session
  // being viewed — never stale local UI state from the last time it was
  // open. Session ids are concrete before any send, so no pending
  // placeholder entry exists anymore.
  const sessionActivity = (activeSessionId && processingSessions?.get(activeSessionId)) || null;
  const isProcessing = sessionActivity !== null;
  const canAbortSession = isProcessing && sessionActivity.canInterrupt;

  // Ref mirror so effects can read the latest map without re-running on
  // every activity transition.
  const processingSessionsRef = useRef(processingSessions);
  processingSessionsRef.current = processingSessions;

  const isActiveRef = useRef(isActive);
  const activeSessionIdRef = useRef(activeSessionId);
  isActiveRef.current = isActive;
  activeSessionIdRef.current = activeSessionId;

  const latestRefreshExecutorRef = useRef<(sessionId: string) => Promise<boolean | void>>(
    async () => true,
  );
  latestRefreshExecutorRef.current = async (sessionId: string) => {
    const result = await sessionStore.refreshLatestFromServer(sessionId, {
      limit: SESSION_MESSAGES_PAGE_SIZE,
      canRequest: () => (
        isActiveRef.current
        && activeSessionIdRef.current === sessionId
      ),
    });
    const slot = result.slot;
    if (slot && activeSessionIdRef.current === sessionId) {
      setHasMoreMessages(slot.hasMore);
      setTotalMessages(slot.total);
      messagesOffsetRef.current = slot.offset;
      if (slot.tokenUsage !== undefined) {
        setTokenBudget((slot.tokenUsage as Record<string, unknown> | null) ?? null);
      }
    }
    return !result.deferred;
  };

  const refreshCoordinatorRef = useRef<ReturnType<typeof createMessageHistoryRefreshCoordinator> | null>(null);
  if (!refreshCoordinatorRef.current) {
    refreshCoordinatorRef.current = createMessageHistoryRefreshCoordinator(
      (sessionId) => latestRefreshExecutorRef.current(sessionId),
      (sessionId) => isActiveRef.current && activeSessionIdRef.current === sessionId,
    );
  }

  const requestLatestMessages = useCallback((sessionId: string, allowNetwork = isActiveRef.current) => (
    refreshCoordinatorRef.current?.request(sessionId, allowNetwork) ?? Promise.resolve()
  ), []);

  /* ---------------------------------------------------------------- */
  /*  Derive chatMessages from the store                              */
  /* ---------------------------------------------------------------- */
  const [pendingUserMessage, setPendingUserMessage] = useState<ChatMessage | null>(null);
  const flushedPendingUserMessageRef = useRef<ChatMessage | null>(null);

  // Hidden Chat tabs keep collecting realtime rows without re-rendering the
  // CSS-hidden tree. Activation itself renders once and reads the latest cache.
  const activeSessionForStore = isActive ? activeSessionId : null;
  const prevActiveForStoreRef = useRef<string | null>(null);
  if (activeSessionForStore !== prevActiveForStoreRef.current) {
    prevActiveForStoreRef.current = activeSessionForStore;
    sessionStore.setActiveSession(activeSessionForStore);
  }

  useEffect(() => {
    if (!pendingUserMessage) {
      flushedPendingUserMessageRef.current = null;
      return;
    }

    if (!activeSessionId) {
      return;
    }

    if (flushedPendingUserMessageRef.current === pendingUserMessage) {
      return;
    }

    const prov = readSelectedProvider();
    const normalized = chatMessageToNormalized(pendingUserMessage, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }

    flushedPendingUserMessageRef.current = pendingUserMessage;
    setPendingUserMessage(null);
  }, [activeSessionId, pendingUserMessage, sessionStore]);

  const storeMessages = activeSessionId ? sessionStore.getMessages(activeSessionId) : NO_MESSAGES;

  const chatMessages = useMemo(() => {
    const all = normalizedToChatMessages(storeMessages);
    // Show pending user message when no session data exists yet (new session, pre-backend-response)
    if (pendingUserMessage && all.length === 0) {
      return [pendingUserMessage];
    }
    return all;
  }, [storeMessages, pendingUserMessage]);

  /* ---------------------------------------------------------------- */
  /*  addMessage                                                       */
  /* ---------------------------------------------------------------- */

  const addMessage = useCallback((msg: ChatMessage) => {
    if (!activeSessionId) {
      // No session yet — show as pending until the backend creates one
      setPendingUserMessage(msg);
      return;
    }
    const prov = readSelectedProvider();
    const normalized = chatMessageToNormalized(msg, activeSessionId, prov);
    if (normalized) {
      sessionStore.appendRealtime(activeSessionId, normalized);
    }
  }, [activeSessionId, sessionStore]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  const followTranscriptLayout = useCallback((durationMs = 0) => {
    const scheduledSessionId = activeSessionIdRef.current;
    // The gesture term keeps this writer out of the reader's way. A wheel notch
    // or a drag is applied to `scrollTop` before the browser dispatches the
    // `scroll` event, and the event is dispatched after this commit — so a write
    // here puts the reader back at the bottom first, and `handleScroll` then
    // measures a zero gap and never learns that they moved. A deliberate pull
    // must therefore survive until it can be measured: standing down leaves the
    // gap in place, and the ordinary rule latches on it once it passes 50 px.
    // Only the input's own direction arms this, so growth on its own never can.
    const cannotFollow = (
      !isActiveRef.current
      || !scheduledSessionId
      || !scrollContainerRef.current
      || isLoadingMoreRef.current
      || pendingScrollRestoreRef.current !== null
      || searchScrollActiveRef.current
      || isUserScrolledUpRef.current
      // The restore's settle loop owns the viewport while it pins a row; a
      // follow write here would race it between frames.
      || anchorSettleRef.current !== null
      || Date.now() < upwardIntentUntilRef.current
    );
    if (cannotFollow) return;

    followUntilRef.current = Math.max(
      followUntilRef.current,
      Date.now() + Math.max(0, durationMs),
    );
    followGeometryRef.current = null;
    followStableFramesRef.current = 0;
    // Requests triggered from a layout effect must correct the newly committed
    // geometry before the browser can paint a one-frame tail gap.
    scrollToBottom();
    if (followFrameRef.current !== null) return;

    const tick = () => {
      followFrameRef.current = null;
      if (
        !isActiveRef.current
        || activeSessionIdRef.current !== scheduledSessionId
        || isUserScrolledUpRef.current
        || isLoadingMoreRef.current
        || pendingScrollRestoreRef.current
        || searchScrollActiveRef.current
        || anchorSettleRef.current !== null
        || Date.now() < upwardIntentUntilRef.current
      ) {
        followUntilRef.current = 0;
        followGeometryRef.current = null;
        followStableFramesRef.current = 0;
        return;
      }

      scrollToBottom();
      const container = scrollContainerRef.current;
      const geometry = container
        ? `${container.scrollTop}:${container.scrollHeight}:${container.clientHeight}`
        : null;
      if (geometry !== null && geometry === followGeometryRef.current) {
        followStableFramesRef.current += 1;
      } else {
        followGeometryRef.current = geometry;
        followStableFramesRef.current = 0;
      }

      // Wall time is only a minimum window. Completion requires stable
      // post-write geometry across separate rendered frames, so a blocked main
      // thread cannot skip straight past the coordination period.
      if (Date.now() < followUntilRef.current || followStableFramesRef.current < 2) {
        followFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        followUntilRef.current = 0;
        followGeometryRef.current = null;
        followStableFramesRef.current = 0;
      }
    };

    followFrameRef.current = window.requestAnimationFrame(tick);
  }, [scrollToBottom]);

  /**
   * Holds the restore's pinned row at the offset the reader was reading at
   * while the just-prepended rows settle.
   *
   * A prepended page mounts as estimated-height placeholders, so the restore's
   * initial compensation is measured against estimated geometry. The lazy-row
   * observer then mounts real content within the viewport band and the anchor
   * moves again — on WebKit, where the browser has no scroll anchoring of its
   * own, by thousands of pixels on a long page. This loop re-pins the anchor
   * every frame until that geometry is stable, and stands down the moment a
   * gesture arrives that the restore did not precede (`inputSeq`). It does not
   * stand down on a `scrollTop` it did not write: on a phone the touch that
   * reached the top is still coasting when the page lands, and WKWebView keeps
   * overwriting the restore's write from that animation, which is not the
   * reader steering and must not end the pin.
   */
  const startAnchorSettle = useCallback((anchor: HTMLElement, anchorOffset: number) => {
    cancelAnchorSettle();
    const scheduledSessionId = activeSessionIdRef.current;
    const container = scrollContainerRef.current;
    if (!scheduledSessionId || !container) return;

    anchorSettleRef.current = {
      sessionId: scheduledSessionId,
      anchor,
      anchorOffset,
      inputSeq: readerInputSeqRef.current,
      stableFrames: 0,
      startedAt: Date.now(),
    };

    const tick = () => {
      anchorSettleFrameRef.current = null;
      const settle = anchorSettleRef.current;
      const currentContainer = scrollContainerRef.current;
      if (
        !settle
        || !currentContainer
        || !isActiveRef.current
        || activeSessionIdRef.current !== settle.sessionId
        || !settle.anchor.isConnected
        || settle.inputSeq !== readerInputSeqRef.current
      ) {
        anchorSettleRef.current = null;
        return;
      }

      const drift = (
        settle.anchor.getBoundingClientRect().top
        - currentContainer.getBoundingClientRect().top
      ) - settle.anchorOffset;
      if (Math.abs(drift) > ANCHOR_SETTLE_EPSILON_PX) {
        settle.stableFrames = 0;
        currentContainer.scrollTop += drift;
      } else {
        settle.stableFrames += 1;
      }

      if (
        settle.stableFrames >= ANCHOR_SETTLE_STABLE_FRAMES
        || Date.now() - settle.startedAt > ANCHOR_SETTLE_MAX_MS
      ) {
        anchorSettleRef.current = null;
        return;
      }
      anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
    };

    anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelAnchorSettle]);

  const scrollToBottomAndReset = useCallback(() => {
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return false;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  /**
   * Arms the one-shot restore that every render-window change needs: pagination
   * widening, "load earlier", and "load all" all insert rows and change the
   * transcript's geometry, and the reader's position must survive that.
   *
   * The state captured by `captureScrollRestoreState` is the baseline, so it is
   * taken before the window is widened — the caller may hold it across an await
   * and hand it in once the page has landed. Bumping the epoch is what makes the
   * restore land on that commit (see `scrollRestoreEpoch`). A capture that found
   * no baseline (`null`) arms nothing: the window still widens, it just does so
   * without this commit owing the viewport a position.
   */
  const armScrollRestore = useCallback((state: ScrollRestoreState | null) => {
    if (!state) return;
    pendingScrollRestoreRef.current = state;
    setScrollRestoreEpoch((previous) => previous + 1);
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!isActive) return;
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) return;
      if (allMessagesLoadedRef.current) return;
      if (!hasMoreMessages || !selectedSession || !selectedProject) return;

      isLoadingMoreRef.current = true;
      setIsLoadingMoreMessages(true);
      const scrollRestoreState = captureScrollRestoreState(container);

      try {
        const result = await sessionStore.fetchMore(selectedSession.id, {
          limit: SESSION_MESSAGES_PAGE_SIZE,
          canRequest: () => (
            isActiveRef.current
            && activeSessionIdRef.current === selectedSession.id
          ),
        });
        const { slot, prependedCount } = result;
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.offset;
        if (slot.tokenUsage !== undefined) {
          setTokenBudget((slot.tokenUsage as Record<string, unknown> | null) ?? null);
        }

        if (prependedCount === 0) {
          if (!slot.hasMore && !slot.turnPageInfo?.newerCursor) {
            allMessagesLoadedRef.current = true;
            setAllMessagesLoaded(true);
            if (loadAllOverlayTimerRef.current) {
              clearTimeout(loadAllOverlayTimerRef.current);
              loadAllOverlayTimerRef.current = null;
            }
            setShowLoadAllOverlay(false);
          }
          return;
        }

        // The lock that keeps this to one page per visit is applied by the
        // restore, once the page's geometry is known (see `armScrollRestore`).
        armScrollRestore(scrollRestoreState);
        // A Turn page holds however many rows fit the byte budget — often far
        // more than the legacy row-page size — so the render window must grow
        // by the rows actually prepended, or the window top would fall further
        // behind the loaded content on every upward page.
        setVisibleMessageCount((prev) => prev + Math.max(prependedCount, SESSION_MESSAGES_PAGE_SIZE));
        if (!slot.hasMore && !slot.turnPageInfo?.newerCursor) {
          allMessagesLoadedRef.current = true;
          setAllMessagesLoaded(true);
          if (loadAllOverlayTimerRef.current) {
            clearTimeout(loadAllOverlayTimerRef.current);
            loadAllOverlayTimerRef.current = null;
          }
          setShowLoadAllOverlay(false);
        }
      } finally {
        isLoadingMoreRef.current = false;
        setIsLoadingMoreMessages(false);
      }
    },
    [armScrollRestore, hasMoreMessages, isActive, isLoadingMoreMessages, selectedProject, selectedSession, sessionStore],
  );

  const loadNewerMessages = useCallback(async () => {
    if (!isActive || !selectedSession || !selectedProject) return;
    if (isLoadingMoreRef.current || isLoadingMoreMessages) return;
    const currentSlot = sessionStore.getSessionSlot(selectedSession.id);
    if (!currentSlot?.turnPageInfo?.newerCursor) return;

    isLoadingMoreRef.current = true;
    setIsLoadingMoreMessages(true);
    try {
      const { slot, appendedCount } = await sessionStore.fetchNewer(selectedSession.id, {
        canRequest: () => (
          isActiveRef.current
          && activeSessionIdRef.current === selectedSession.id
        ),
      });
      setHasMoreMessages(slot.hasMore);
      setTotalMessages(slot.total);
      messagesOffsetRef.current = slot.offset;
      if (slot.tokenUsage !== undefined) {
        setTokenBudget((slot.tokenUsage as Record<string, unknown> | null) ?? null);
      }
      if (appendedCount > 0) {
        setVisibleMessageCount((previous) => previous + appendedCount);
      }

      const loadedEveryDirection = !slot.hasMore && !slot.turnPageInfo?.newerCursor;
      allMessagesLoadedRef.current = loadedEveryDirection;
      setAllMessagesLoaded(loadedEveryDirection);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMoreMessages(false);
    }
  }, [isActive, isLoadingMoreMessages, selectedProject, selectedSession, sessionStore]);

  const handleScroll = useCallback(async () => {
    if (!isActive) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const nearBottom = isNearBottom();
    const previousTop = lastScrollTopSampleRef.current;
    lastScrollTopSampleRef.current = container.scrollTop;

    // A `scroll` event cannot say who moved the viewport. A follow write only
    // ever moves it down to the new bottom, and content arriving below a
    // stationary viewport leaves `scrollTop` untouched, so a mere gap is not
    // evidence that the reader took over — reading it as such is what let a
    // single sample of growth latch the transcript out of following for the rest
    // of the answer. Only a fall since the previous sample, or a gesture that is
    // pulling the transcript down, counts.
    const movedUp = (
      previousTop !== null
      && container.scrollTop < previousTop - SCROLL_UP_EPSILON_PX
    );
    const readerOwnsViewport = movedUp || Date.now() < upwardIntentUntilRef.current;
    if (isUserScrolledUpRef.current) {
      // Latching stays sticky. The reader may keep reading further up while the
      // answer grows below them, and that growth must not read as "back at the
      // bottom" and drag them down.
      if (nearBottom) setIsUserScrolledUp(false);
    } else if (!nearBottom && readerOwnsViewport) {
      setIsUserScrolledUp(true);
    }

    scrollPositionRef.current = {
      height: container.scrollHeight,
      top: container.scrollTop,
    };

    const scrolledNearTop = container.scrollTop < 100;

    // "Load all" prompt: appear (with fade-in) when the user reaches the top
    if (scrolledNearTop && hasMoreMessages && !allMessagesLoadedRef.current) {
      if (!wasNearTopRef.current) {
        wasNearTopRef.current = true;
        if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);

        setShowLoadAllOverlay(true);
        loadAllOverlayTimerRef.current = setTimeout(() => {
          setShowLoadAllOverlay(false);
          loadAllOverlayTimerRef.current = null;
        }, 2500);
      }
    } else if (!scrolledNearTop) {
      wasNearTopRef.current = false;
    }

    if (!allMessagesLoadedRef.current) {
      if (!scrolledNearTop) { topLoadLockRef.current = false; return; }
      if (topLoadLockRef.current) {
        // The reader moved back down through the page that was just inserted, so
        // the next reach for the top is a new request. A latched guard is always
        // releasable here: it is only set by a page that inserted more than this
        // much above the reader (see TOP_LOAD_LOCK_MIN_PROGRESS_PX).
        if (container.scrollTop > TOP_LOAD_LOCK_MIN_PROGRESS_PX) {
          topLoadLockRef.current = false;
        }
        return;
      }
      await loadOlderMessages(container);
    }
  }, [hasMoreMessages, isActive, isNearBottom, loadOlderMessages, setIsUserScrolledUp]);

  const wasChatActiveRef = useRef(isActive);
  // Consumes the armed restore on the commit that follows arming. The epoch (not
  // the store length) is the driver: the window can be widened without the store
  // changing, and an armed state that outlives its own commit would move the
  // viewport on some later one.
  useLayoutEffect(() => {
    const becameActive = isActive && !wasChatActiveRef.current;
    wasChatActiveRef.current = isActive;
    if (!isActive || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    if (pendingScrollRestoreRef.current) {
      const { height, top, anchor, anchorOffset, tailAnchor, tailAnchorOffset } = pendingScrollRestoreRef.current;
      let insertedAbove: number;
      if (anchor?.isConnected && anchorOffset !== null) {
        const nextAnchorOffset = (
          anchor.getBoundingClientRect().top
          - container.getBoundingClientRect().top
        );
        insertedAbove = nextAnchorOffset - anchorOffset;
        container.scrollTop += insertedAbove;
        // The page just mounted as estimated-height placeholders (see
        // ChatMessagesPane's lazy rows), so this compensation is measured
        // against estimated geometry. The settle loop re-pins the anchor while
        // the real heights land; on WebKit nothing else will.
        startAnchorSettle(anchor, anchorOffset);
      } else if (tailAnchor?.isConnected && tailAnchorOffset !== null) {
        // No pinned row survived to the commit. The tail wrapper's top only
        // moves when content is inserted above it, so its displacement is the
        // above-insertion without the streaming growth a scrollHeight delta
        // would wrongly include.
        insertedAbove = Math.max(
          (tailAnchor.getBoundingClientRect().top - container.getBoundingClientRect().top)
            - tailAnchorOffset,
          0,
        );
        container.scrollTop = top + insertedAbove;
      } else {
        insertedAbove = Math.max(container.scrollHeight - height, 0);
        container.scrollTop = top + insertedAbove;
      }
      // Latching the pager's guard belongs to this commit rather than to the
      // request that armed it: only here is the page's geometry known, and only
      // a page the reader can actually scroll through may latch it.
      topLoadLockRef.current = insertedAbove > TOP_LOAD_LOCK_MIN_PROGRESS_PX;
      pendingScrollRestoreRef.current = null;
      return;
    }

    if (becameActive) {
      container.scrollTop = isUserScrolledUp
        ? scrollPositionRef.current.top
        : container.scrollHeight;
    }
  }, [isActive, isUserScrolledUp, scrollRestoreEpoch, startAnchorSettle]);

  // Reset scroll/pagination state on session change
  useEffect(() => {
    // A search jump belongs to the transcript it was requested against. Left
    // armed across a session change it did two visible things to the session
    // the user actually opened: the initial scroll bailed (it declines while a
    // jump is pending) so the transcript opened part-way up, and then, once the
    // retries ran out and started accepting the nearest row by timestamp, it
    // scrolled to an unrelated message and flashed the search highlight on it.
    //
    // Clearing it here is safe for the jump itself: the effect that reads
    // `__searchTargetSnippet` off the newly selected session runs after this
    // one, so a session opened *from* a search result re-arms immediately.
    if (searchScrollTimerRef.current) {
      clearTimeout(searchScrollTimerRef.current);
      searchScrollTimerRef.current = null;
    }
    searchScrollActiveRef.current = false;
    setSearchTarget(null);

    pendingInitialScrollRef.current = true;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    cancelAnchorSettle();
    wasNearTopRef.current = false;
    lastScrollTopSampleRef.current = null;
    upwardIntentUntilRef.current = 0;
    touchOriginYRef.current = null;
    setIsUserScrolledUp(false);
  }, [selectedProject?.projectId, selectedSession?.id, setIsUserScrolledUp, cancelAnchorSettle]);

  // Initial scroll to bottom — robust to lazy content reflow.
  // The previous implementation fired one scrollToBottom() at +200ms and
  // cleared the pending flag. When markdown blocks, code highlighting, or
  // images finished rendering after that window, scrollHeight grew but
  // nothing re-anchored the viewport, leaving the chat tab visually
  // "scrolled way up" with the latest assistant message off-screen.
  //
  // This version re-scrolls every animation frame while scrollHeight is
  // still growing, capped at ~1s (60 frames) or 3 consecutive stable
  // frames. Cancels cleanly on session change via the pending flag.
  useEffect(() => {
    if (!isActive) return;
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) return;
    if (chatMessages.length === 0) { pendingInitialScrollRef.current = false; return; }
    if (searchScrollActiveRef.current) { pendingInitialScrollRef.current = false; return; }

    const container = scrollContainerRef.current;
    let frame = 0;
    let lastHeight = 0;
    let stableCount = 0;
    let rafId = 0;

    const scheduledSessionId = activeSessionId;
    const tick = () => {
      if (
        !pendingInitialScrollRef.current
        || !scrollContainerRef.current
        || !isActiveRef.current
        || activeSessionIdRef.current !== scheduledSessionId
      ) return;
      if (isUserScrolledUpRef.current) {
        pendingInitialScrollRef.current = false;
        return;
      }
      container.scrollTop = container.scrollHeight;
      if (container.scrollHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = container.scrollHeight;
      }
      frame++;
      if (stableCount < 3 && frame < 60) {
        rafId = requestAnimationFrame(tick);
      } else {
        pendingInitialScrollRef.current = false;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeSessionId, chatMessages.length, isActive, isLoadingSessionMessages, scrollToBottom]);

  // Session replay/subscription remains active regardless of which main tab is
  // visible. Only persisted-history HTTP traffic is visibility-gated below.
  useEffect(() => {
    if (!selectedSession || !selectedProject || !ws) return;

    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [lastSeqRef, selectedProject, selectedSession, sendMessage, statusCheckSentAtRef, ws]);

  // Main session loading effect — store-based.
  //
  // The dependency list is deliberately narrower than the values the body
  // reads. `selectedSession` is tracked by id only, so a websocket-driven list
  // refresh that hands back a new object for the same session does not reload
  // it; `currentSessionId` is read as the previously-loaded session (the body
  // itself is what advances it), so listing it would re-enter the effect right
  // after every load. Both are always current when the effect does run,
  // because React recreates the closure on each render.
  useEffect(() => {
    if (!selectedSession || !selectedProject) {
      // A freshly created session can be mid-run before the router has a
      // canonical selectedSession (the URL effect synthesizes one on the
      // next render). Keep the active view intact instead of wiping it.
      if (currentSessionId && processingSessionsRef.current?.has(currentSessionId)) {
        return;
      }

      setCurrentSessionId(null);
      messagesOffsetRef.current = 0;
      setHasMoreMessages(false);
      setTotalMessages(0);
      setTokenBudget(null);
      lastLoadedSessionKeyRef.current = null;
      return;
    }

    if (!isActive) {
      setIsLoadingSessionMessages(false);
      return;
    }

    const selectedSessionId = selectedSession.id;
    const sessionKey = `${selectedSessionId}:${selectedProject.projectId}`;

    const existingSlot = sessionStore.getSessionSlot(selectedSessionId);
    const isCurrentHydratedSession =
      lastLoadedSessionKeyRef.current === sessionKey
      && Boolean(existingSlot?.fetchedAt);

    // Returning from another tab must not reset pagination or scroll. Refresh
    // a stale hydrated session through the bounded tail path instead.
    if (isCurrentHydratedSession) {
      if (sessionStore.isStale(selectedSessionId)) {
        void requestLatestMessages(selectedSessionId);
      }
      return;
    }

    const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSessionId;

    // Reset pagination/scroll state
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    wasNearTopRef.current = false;
    if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);

    if (sessionChanged) {
      setTokenBudget(null);
    }

    setCurrentSessionId(selectedSessionId);

    lastLoadedSessionKeyRef.current = sessionKey;

    // Fetch from server → store updates → chatMessages re-derives automatically
    setIsLoadingSessionMessages(true);
    sessionStore.fetchFromServer(selectedSessionId, {
      pageMode: 'turns',
      canRequest: () => (
        isActiveRef.current
        && activeSessionIdRef.current === selectedSessionId
      ),
    }).then(slot => {
      if (slot) {
        setHasMoreMessages(slot.hasMore);
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.offset;
        if (slot.tokenUsage !== undefined) {
          setTokenBudget((slot.tokenUsage as Record<string, unknown> | null) ?? null);
        }
      }
      setIsLoadingSessionMessages(false);
    }).catch(() => {
      setIsLoadingSessionMessages(false);
    });
  }, [
    isActive,
    requestLatestMessages,
    selectedProject,
    selectedSession?.id,
    sessionStore,
  ]);

  // Hidden refresh signals are coalesced. An initial page load supersedes a
  // pending latest refresh for an unhydrated/loading slot; otherwise activation
  // flushes exactly one request for the selected session.
  useEffect(() => {
    if (!isActive || !activeSessionId) return;

    const slot = sessionStore.getSessionSlot(activeSessionId);
    if (!slot?.fetchedAt || slot.status === 'loading') {
      refreshCoordinatorRef.current?.discardPending(activeSessionId);
      return;
    }

    void refreshCoordinatorRef.current?.flushPending(activeSessionId);
  }, [activeSessionId, isActive, sessionStore]);

  // External message update (e.g. WebSocket reconnect, background refresh)
  useEffect(() => {
    if (!externalMessageUpdate || !selectedSession || !selectedProject) return;

    const reloadExternalMessages = async () => {
      try {
        // Skip store refresh during active streaming
        if (!isProcessing) {
          const shouldStickToBottom = isActiveRef.current && isNearBottom();
          await requestLatestMessages(selectedSession.id);

          if (shouldStickToBottom) {
            setTimeout(() => {
              if (!isUserScrolledUpRef.current) {
                scrollToBottom();
              }
            }, 200);
          }
        }
      } catch (error) {
        console.error('Error reloading messages from external update:', error);
      }
    };

    reloadExternalMessages();
  }, [
    externalMessageUpdate,
    requestLatestMessages,
    scrollToBottom,
    selectedProject,
    selectedSession,
    isProcessing,
  ]);

  // Search navigation target
  useEffect(() => {
    const session = selectedSession as Record<string, unknown> | null;
    const targetSnippet = session?.__searchTargetSnippet;
    const targetTimestamp = session?.__searchTargetTimestamp;
    const targetAnchorId = session?.__searchTargetAnchorId;
    if (typeof targetSnippet === 'string' && targetSnippet) {
      searchScrollActiveRef.current = true;
      setSearchTarget({
        snippet: targetSnippet,
        timestamp: typeof targetTimestamp === 'string' ? targetTimestamp : undefined,
        ...(typeof targetAnchorId === 'string'
          ? { transcriptAnchorId: targetAnchorId }
          : {}),
      });
    }
  }, [selectedSession]);

  // Scroll to search target
  useEffect(() => {
    if (!isActive || !searchTarget || chatMessages.length === 0 || isLoadingSessionMessages) return;

    const target = searchTarget;
    setSearchTarget(null);

    const scrollToTarget = async () => {
      if (!allMessagesLoadedRef.current && selectedSession && selectedProject) {
          try {
            // Open one bounded Turn window around the hit. The page carries
            // independent older/newer cursors, so search never needs to pull
            // the entire transcript into the browser.
            const slot = await sessionStore.fetchFromServer(selectedSession.id, {
              pageMode: 'turns',
              seek: target,
              canRequest: () => (
                isActiveRef.current
                && activeSessionIdRef.current === selectedSession.id
              ),
            });
            if (slot) {
              const hasNewerMessages = Boolean(slot.turnPageInfo?.newerCursor);
              setHasMoreMessages(slot.hasMore);
              setTotalMessages(slot.total);
              messagesOffsetRef.current = slot.offset;
              const loadedEveryDirection = !slot.hasMore && !hasNewerMessages;
              setAllMessagesLoaded(loadedEveryDirection);
              allMessagesLoadedRef.current = loadedEveryDirection;
            } else if (!isActiveRef.current) {
              setSearchTarget(target);
              return;
            }
          } catch {
            // Fall through and scroll in current messages
          }
      }
      // Resolve the target against the loaded transcript rather than the DOM.
      // The store is the freshest source here: the `fetchFromServer` above has
      // landed but `chatMessages` is from the render that scheduled this effect.
      const messagesForSearch = activeSessionIdRef.current
        ? normalizedToChatMessages(sessionStore.getMessages(activeSessionIdRef.current))
        : chatMessages;
      const targetIndex = findSearchTargetIndex(messagesForSearch, target);
      if (targetIndex < 0) {
        // The target is not in the transcript at all. Scrolling somewhere
        // plausible would claim a hit that does not exist.
        searchScrollActiveRef.current = false;
        return;
      }

      // Widen the window so the target is rendered. `visibleMessages` is a tail
      // slice, so covering index N means rendering everything after it.
      const requiredVisibleCount = resolveSearchWindowSize(
        messagesForSearch.length,
        targetIndex,
        SEARCH_TARGET_CONTEXT_MESSAGES,
      );
      setVisibleMessageCount((previous) => Math.max(previous, requiredVisibleCount));

      const targetTimestamp = messagesForSearch[targetIndex].timestamp;
      if (selectedSession) {
        searchRevealRequestIdRef.current += 1;
        setSearchRevealRequest({
          sessionId: selectedSession.id,
          timestamp: targetTimestamp,
          requestId: searchRevealRequestIdRef.current,
        });
      }

      const scrollToRenderedTarget = (retriesLeft: number) => {
        const container = scrollContainerRef.current;
        if (!container) return;

        // The target is inside the window by construction, so this only waits
        // for React to commit the widened list. A target collapsed inside a
        // tool group resolves to that group, which carries the same timestamp.
        const targetElement = findRenderedMessageElement(
          container,
          targetTimestamp,
          retriesLeft === 0,
        );

        if (targetElement) {
          targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          targetElement.classList.add('search-highlight-flash');
          setTimeout(() => targetElement.classList.remove('search-highlight-flash'), 4000);
          searchScrollTimerRef.current = null;
          searchScrollActiveRef.current = false;
          return;
        }

        if (retriesLeft > 0) {
          searchScrollTimerRef.current = setTimeout(
            () => scrollToRenderedTarget(retriesLeft - 1),
            SEARCH_SCROLL_RETRY_DELAY_MS,
          );
          return;
        }

        searchScrollTimerRef.current = null;
        searchScrollActiveRef.current = false;
      };

      searchScrollTimerRef.current = setTimeout(
        () => scrollToRenderedTarget(SEARCH_SCROLL_RETRIES),
        150,
      );
    };

    scrollToTarget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages.length, isActive, isLoadingSessionMessages, searchTarget]);

  // Initial token usage fetch for providers with file-backed usage data.
  useEffect(() => {
    if (!selectedSession?.id) {
      setTokenBudget(null);
      return;
    }
    const fetchInitialTokenUsage = async () => {
      try {
        // The provider module resolves storage and provider details from the session id.
        const response = await api.providers.sessionTokenUsage(selectedSession.id);
        if (response.ok) {
          const payload = await response.json();
          setTokenBudget(payload.data ?? null);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };
    fetchInitialTokenUsage();
  }, [selectedSession?.id]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) return chatMessages;
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    if (!isActive) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    scrollPositionRef.current = { height: container.scrollHeight, top: container.scrollTop };
  });

  useLayoutEffect(() => {
    const cannotFollow = (
      !isActive
      || !activeSessionId
      || !scrollContainerRef.current
      || chatMessages.length === 0
      || isLoadingMoreRef.current
      || isLoadingMoreMessages
      || pendingScrollRestoreRef.current !== null
      || searchScrollActiveRef.current
      || isUserScrolledUpRef.current
    );
    if (cannotFollow) {
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
      followUntilRef.current = 0;
      followGeometryRef.current = null;
      followStableFramesRef.current = 0;
      return;
    }

    followTranscriptLayout();

    // Cancel the frame loop when any dependency changes; the next effect run
    // (or the unmount effect below) is what restarts or stops it. The tick
    // itself self-cancels, but an explicit cleanup keeps a pending frame from
    // outliving the state that scheduled it.
    return () => {
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    };
  }, [activeSessionId, chatMessages, followTranscriptLayout, isActive, isLoadingMoreMessages, isUserScrolledUp]);

  useEffect(() => () => {
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
    followUntilRef.current = 0;
    followGeometryRef.current = null;
    followStableFramesRef.current = 0;
    if (anchorSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(anchorSettleFrameRef.current);
      anchorSettleFrameRef.current = null;
    }
    anchorSettleRef.current = null;
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // A sample only means something relative to the previous one, so the attach
    // that starts the stream of samples is also what seeds the first of them.
    lastScrollTopSampleRef.current = container.scrollTop;
    container.addEventListener('scroll', handleScroll);

    // Gestures are the one piece of evidence a `scroll` sample cannot always
    // carry: a follow write landing between the reader's movement and the event
    // puts `scrollTop` back at the bottom, and a fast stream can grow the
    // transcript faster than a slow drag moves it. Both leave a sample that
    // looks untouched, so the gesture is tracked separately.
    const armUpwardIntent = () => {
      upwardIntentUntilRef.current = Date.now() + SCROLL_UP_INTENT_WINDOW_MS;
    };
    const handleWheel = (event: WheelEvent) => {
      readerInputSeqRef.current += 1;
      if (event.deltaY < 0) armUpwardIntent();
      if (event.deltaY > 0 && isNearBottom()) void loadNewerMessages();
    };
    const handleTouchStart = (event: TouchEvent) => {
      touchOriginYRef.current = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      readerInputSeqRef.current += 1;
      const originY = touchOriginYRef.current;
      const currentY = event.touches[0]?.clientY;
      // A finger travelling down pulls the transcript down, so the reader is
      // heading toward older messages.
      if (originY !== null && currentY !== undefined && currentY - originY > TOUCH_UP_INTENT_MIN_TRAVEL_PX) {
        armUpwardIntent();
      }
      if (originY !== null && currentY !== undefined && originY - currentY > TOUCH_UP_INTENT_MIN_TRAVEL_PX && isNearBottom()) {
        void loadNewerMessages();
      }
    };
    const handleTouchEnd = () => {
      touchOriginYRef.current = null;
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [handleScroll, isNearBottom, loadNewerMessages]);

  // "Load all" overlay visibility is driven by scroll-to-top in handleScroll;
  // timers are cleared on session change via the reset effect above.

  const loadAllMessages = useCallback(async () => {
    if (!isActive) return;
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessages) return;
    const requestSessionId = selectedSession.id;
    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    setIsLoadingAllMessages(true);
    setShowLoadAllOverlay(true);
    if (loadAllOverlayTimerRef.current) {
      clearTimeout(loadAllOverlayTimerRef.current);
      loadAllOverlayTimerRef.current = null;
    }

    const container = scrollContainerRef.current;
    const scrollRestoreState = container ? captureScrollRestoreState(container) : null;

    try {
      const slot = await sessionStore.fetchFromServer(requestSessionId, {
        limit: null,
        offset: 0,
        canRequest: () => (
          isActiveRef.current
          && activeSessionIdRef.current === requestSessionId
        ),
      });

      if (currentSessionId !== requestSessionId) return;

      if (slot) {
        armScrollRestore(scrollRestoreState);

        setHasMoreMessages(false);
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.offset;
        setVisibleMessageCount(Infinity);
        setAllMessagesLoaded(true);

        setLoadAllJustFinished(true);
        if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
        loadAllFinishedTimerRef.current = setTimeout(() => {
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
          loadAllFinishedTimerRef.current = null;
        }, 2500);
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingAllMessages(false);
    }
  }, [armScrollRestore, isActive, selectedSession, selectedProject, isLoadingAllMessages, currentSessionId, sessionStore]);

  const loadEarlierMessages = useCallback(() => {
    // Pure render-window growth: the store already holds every message, so this
    // only inserts rows above the viewport. Without a captured baseline the
    // widened commit leaves the reader looking at a row they never chose — the
    // browser's own scroll anchoring is the only thing covering WebKit, and it
    // does not exist there.
    const container = scrollContainerRef.current;
    armScrollRestore(container ? captureScrollRestoreState(container) : null);
    setVisibleMessageCount((prev) => prev + 100);
  }, [armScrollRestore]);

  return {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    followTranscriptLayout,
    handleScroll,
    requestLatestMessages,
    searchRevealRequest,
  };
}
