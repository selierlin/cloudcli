import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api } from '@/shared/api';
import type { MarkSessionIdle, SessionActivityMap,Project,ProjectSession,LLMProvider,NormalizedMessage,ChatMessage,DiffCalculator,TranscriptRevealRequest } from '@/shared/types';
import type { SessionSlot, SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { SESSION_MESSAGES_PAGE_SIZE } from '@/modules/chat/utils/sessionMessagePagination';
import { createMessageHistoryRefreshCoordinator } from '@/modules/chat/utils/messageHistoryRefreshCoordinator';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { findSearchTargetIndex, resolveSearchWindowSize } from '@/modules/chat/utils/searchTargetLocator';
import { readSelectedProvider } from '@/shared/selectedProvider';
import { noteScrollWrite, noteTranscriptEvent } from '@/shared/debug/scrollDiagnostics';
import type { SearchTarget } from '@/modules/chat/utils/searchTargetLocator';

const INITIAL_VISIBLE_MESSAGES = 100;

/**
 * Whether rows after the loaded window still wait to be fetched.
 *
 * A transcript can be partial in two independent directions: opening on the
 * latest page leaves older rows behind (`hasMore`), and a search jump opens a
 * window in the middle whose continuation cursor points forward. Anything that
 * claims "this is the whole transcript" has to check both.
 */
const hasNewerPageLeft = (slot: Pick<SessionSlot, 'turnPageInfo'>): boolean => (
  Boolean(slot.turnPageInfo?.newerCursor)
);

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
 * below this — which is also the tolerance for a residual gap at the tail, where
 * a pane reporting a couple of pixels below the clamp is the tail.
 */
const SCROLL_UP_EPSILON_PX = 2;

/**
 * How far the viewport has to end up past the tail before the back-to-bottom
 * button is offered, and how close it has to come back before the button is
 * withdrawn.
 *
 * The ownership latch cannot decide this on its own: it sets after the first
 * couple of pixels so the follow loop never fights a drag, and a button at that
 * point lands over the message the reader has only just started to re-read. Two
 * thresholds rather than one keep a coast or a slow drag resting near the edge
 * from blinking the button in and out.
 */
const TAIL_AFFORDANCE_SHOW_GAP_PX = 120;
const TAIL_AFFORDANCE_HIDE_GAP_PX = 40;

/**
 * Pinned-row drift below which the restore's settle loop counts a frame as
 * stable.
 *
 * Two pixels, not one. iOS stores the scroll offset in device pixels and hands
 * back a value a fraction short of the one that was written, so a 1 px
 * tolerance turns every sub-pixel difference into a write; the offset then
 * overshoots by a pixel, the next frame measures the same difference the other
 * way, and the two trade places at frame rate. A phone recording showed exactly
 * that: 32 consecutive frames of `…1184 / …1185 / …1184` while the loop kept
 * writing the identical 1185.046875. Two pixels keeps that disagreement inside
 * the tolerance, where it is invisible, while a real placeholder settling by
 * hundreds of pixels still gets followed.
 */
const ANCHOR_SETTLE_EPSILON_PX = 2;

/**
 * Consecutive stable frames the restore's settle loop needs before it stands
 * down.
 *
 * Two frames is not enough. A phone's scroll view keeps its own offset while a
 * fling is still coasting or a rubber band is springing back, and it puts that
 * offset back one or two frames *after* the restore's write — later still if the
 * momentum is slow. A report from a real device showed the write surviving for
 * 18-36 ms and then being replaced by the platform's offset, with the loop
 * already gone. Ten frames (~170 ms) outlasts that window, and costs nothing
 * while the geometry is genuinely stable: the loop only reads a rect.
 */
const ANCHOR_SETTLE_STABLE_FRAMES = 10;

/**
 * Hard ceiling on the restore's settle loop. Prepended rows land as
 * estimated-height placeholders and settle to real heights within a few
 * hundred milliseconds; anything that takes longer than this is not settling
 * geometry, and the loop must not fight the reader over a stuck layout.
 */
const ANCHOR_SETTLE_MAX_MS = 2500;

/**
 * Frames in a row whose compensation does not fit in the transcript's range
 * before the settle loop stands down.
 *
 * A widened window can leave the rows below the reader as estimated
 * placeholders, so the correction has nowhere to land until those measure; ten
 * frames (~170 ms) lets that settle. A layout that cannot reach the target at
 * all stops the loop instead of retrying for the full ceiling.
 */
const ANCHOR_SETTLE_UNREACHABLE_FRAMES = 10;

/**
 * Writes the platform may swallow, with the drift unchanged, before the settle
 * loop concludes that something else owns the offset.
 *
 * iOS keeps its own scroll offset while the scroll view is decelerating or
 * rubber-banding and lays it back over ours on the next commit. Re-writing the
 * same 1–2 px every frame then becomes a tug of war: the reader sees the content
 * shiver at frame rate for as long as the loop runs, while `correctedPx` grows
 * into the thousands and the row never actually moves. Standing down after
 * three swallowed writes caps that at ~50 ms; the residual drift is a couple of
 * pixels, which nobody can see.
 */
const ANCHOR_SETTLE_CONTENDED_FRAMES = 3;

/**
 * Drift small enough that abandoning it costs the reader nothing. A large drift
 * that the platform keeps overwriting still gets retried for the full ceiling:
 * giving up there would throw the reader thousands of pixels away.
 */
const ANCHOR_SETTLE_CONTENDED_MAX_PX = 32;

/**
 * How far the offset may travel between two frames, without the settle loop
 * having written it, before the movement belongs to something else — a phone
 * keeps decelerating after the finger lifts, and no touch event marks it.
 *
 * Every write made into that animation ends it, so re-pinning at frame rate
 * does not hold the row, it brakes the fling: a recording measured 55 frozen
 * frames (~1.3 s) on a fast flick against 1 frame on a slow one, and the
 * threshold that separated them was the contended cap above, not anything
 * about the movement. Six pixels is far above the sub-pixel disagreement a
 * write leaves behind and far below any momentum frame.
 */
const ANCHOR_SETTLE_MOMENTUM_PX = 6;

/**
 * How close the offset has to be to the value the loop asked for, for a frame to
 * count as landing on that write.
 *
 * WebKit stores `scrollTop` on the device's layout grid rather than as the float
 * it was handed: a write of 2368.859375 read back as 2368. A half-pixel test
 * called that "something else moved the offset", handed the whole page to the
 * momentum branch, and shifted the anchor's target by exactly one page — which
 * the loop then paid again on the next frame, and the next, five times, until
 * the pane was clamped against the tail. 1.5 px covers the quantisation at dpr 3
 * and stays far below a real momentum frame.
 */
const ANCHOR_SETTLE_LANDING_SLOP_PX = 1.5;

/** Downward finger travel that makes a touch a read-up gesture rather than a tap. */
const TOUCH_UP_INTENT_MIN_TRAVEL_PX = 10;

/**
 * How recently the reader must have moved the viewport for a downward move to
 * count as handing it back.
 *
 * Momentum and the layout re-resolving under it both move `scrollTop` with no
 * input behind them, and a fling that has been pushed back near the tail looks
 * exactly like the reader returning to it: a device report showed a release
 * granting the follow 41 px from the bottom, mid-coast, which then fought the
 * deceleration for ten frames. Input arrives while the reader is driving, so the
 * move is only theirs when an input event landed within this window.
 */
const READER_INPUT_LIVE_MS = 300;

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

/**
 * The visible-window size that shows the row at `index` of `total` rows, with
 * a page of context above it; the current size when the row already shows.
 * The window is a tail slice, so a row is visible when at most `count` rows
 * follow it, itself included.
 */
export function visibleCountToReveal(total: number, index: number, current: number): number {
  const needed = total - index;
  return needed <= current ? current : needed + SESSION_MESSAGES_PAGE_SIZE;
}

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
  const containerBounds = container.getBoundingClientRect();
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-message-timestamp]'));
  // A transcript that has not laid out has no position worth restoring: that is
  // the pane mounting before its rows have measured, and a hidden tab. Both
  // report a viewport-tall box at `scrollTop` 0 with no measured row in it, so
  // an anchor taken from one would be the first row of a stack that does not
  // exist yet, and the restore would land on a clamped offset that the
  // session-open scroll-to-bottom then drags away from — the reader sees the
  // transcript jump instead of opening at the bottom.
  //
  // A transcript that merely fits the viewport is a different thing and does
  // need a baseline: the reader can be reading it, and a page prepended above
  // pushes that content off the screen — measured, 2685 px in one frame, with
  // the viewport left at the top. The measured-row test separates the two.
  if (
    container.scrollHeight <= container.clientHeight
    && !rows.some((row) => row.getBoundingClientRect().height > 0)
  ) {
    return null;
  }

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

/**
 * Resolves once the pane is back inside its own scroll range.
 *
 * A page that lands while the pane sits past its top edge is measured and paid
 * for against a viewport the platform is still animating: the spring displaces
 * every rect by its own travel (so the insertion can measure as zero) and
 * discards the write that pays for it, which then lands half a second later as
 * a visible jump. `overscroll-behavior-y: none` keeps WebKit from producing
 * that window at all, but iOS 15 and any host that ignores the property still
 * can, so the commit waits for the edge instead. The request has already run by
 * then; the only cost is the few frames the spring needs, and geometry is
 * either clean or the deadline gives up and commits as before.
 */
function waitForScrollableEdge(container: HTMLDivElement, deadlineMs = 600): Promise<void> {
  // The common case: no spring, nothing to wait for. Checked synchronously so
  // the commit is not pushed a frame behind the request on a desktop engine.
  if (!container.isConnected || container.scrollTop >= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (
        !container.isConnected
        || container.scrollTop >= 0
        || Date.now() - startedAt >= deadlineMs
      ) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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
  if (msg.isTaskNotification) {
    return {
      ...base,
      kind: 'task_notification',
      status: msg.taskNotificationStatus || 'completed',
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
  // The forward half of "is this the whole transcript". Kept beside
  // `hasMoreMessages` because every writer sets the two from the same slot;
  // export and share need both ends to call a selection complete, and a row
  // count cannot stand in for either (the UI drops control rows and folds tool
  // results into their call).
  const [hasNewerMessages, setHasNewerMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isUserScrolledUp, setIsUserScrolledUpState] = useState(false);
  /**
   * Whether the back-to-bottom button is on screen. Kept apart from
   * `isUserScrolledUp` because that latch has to set on the first pixel of an
   * upward move, while the button only belongs on screen once the reader has
   * actually left the tail behind; see `TAIL_AFFORDANCE_SHOW_GAP_PX`.
   */
  const [showTailAffordance, setShowTailAffordance] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  /**
   * How many rows the last "load earlier" prepended. The transcript mounts that
   * whole page on the commit which inserts it: a prepended row has never been
   * measured, so its placeholder is only an estimate, and the scroll restore
   * would otherwise compensate against geometry that changes under it once the
   * lazy rows mount their real content.
   */
  const [prependedRowCount, setPrependedRowCount] = useState(0);
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
  /**
   * `scrollTop` as our own code last left the viewport. `handleScroll` reads a
   * fall between samples as the reader pulling away, but the follow is not the
   * only writer: `useBottomEdgeResizeCompensation` moves `scrollTop` *up* by the
   * amount the pane grows (the keyboard dropping, the composer shrinking), and
   * that is the same direction a pull takes. The write's own event is dispatched
   * after whatever content landed in between, so the sample can carry a gap past
   * the latch threshold while the position is exactly the one we wrote. A fall
   * that lands where we put the viewport is therefore ours, not the reader's.
   */
  const programmaticScrollTopRef = useRef<number | null>(null);
  /**
   * Whether the reader has asked for the viewport by pulling the transcript
   * down. It is sticky on purpose: a pull of only a few pixels leaves the gap
   * under the latch threshold, so a time-boxed window would expire while the
   * reader is still holding the transcript away from the bottom and the follow
   * would drag it back. Only a downward move that reaches the bottom, or a send,
   * clears it.
   */
  const upwardIntentRef = useRef(false);
  /** `clientY` where the current touch drag began, or null between drags. */
  const touchOriginYRef = useRef<number | null>(null);
  /**
   * Whether a finger that has not lifted is resting on the pane.
   *
   * A gesture cannot always be read from `scrollTop`: during the iOS rubber
   * band the content keeps moving visually while `scrollTop` stays clamped, so a
   * drag through that region produces `scroll` events that look exactly like a
   * write of our own landing on the clamp. Without this flag the follow treats
   * the rubber band as its own write, keeps writing `scrollTop = scrollHeight`
   * mid-drag, and every write collapses the stretched content back to the clamp
   * — the transcript jumps once, repeatedly, before it settles down and only
   * then starts tracking the finger.
   */
  const touchActiveRef = useRef(false);
  /**
   * Bumped on every reader gesture (wheel or touch) as it arrives. The restore's
   * settle loop captures this at start and stands down only once it changes: a
   * touch's inertia tail keeps writing `scrollTop` for hundreds of ms with no
   * finger on the glass and no further `touchmove`, so reading `scrollTop` alone
   * cannot tell that apart from the reader taking over.
   */
  const readerInputSeqRef = useRef(0);
  /** Wall clock of the last reader input, for `READER_INPUT_LIVE_MS`. */
  const lastReaderInputAtRef = useRef(0);
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
    /** Frames the loop actually ran, and how much it had to correct in total. */
    frames: number;
    correctedPx: number;
    /** Offset the last write asked for, and the drift it was answering. */
    lastTarget: number | null;
    lastDrift: number;
    /** Writes in a row that the offset itself did not keep. */
    contended: number;
    /** Offset seen on the previous frame, or null before the first one. */
    lastOffset: number | null;
    /**
     * Whether the previous frame was spent past the top edge, where the
     * platform owns the offset. The jump that follows is the spring landing,
     * not momentum, so it must not be absorbed.
     */
    bounced: boolean;
    /**
     * What the previous write was for — the distance the pane was moved, where
     * the anchor sat on screen before it, and the document height at the time.
     * A write that lands has to show up in the anchor's screen position or in
     * that height; a recording showed neither (see the responsiveness check in
     * `tick`), and the loop paid the same 2350 px four times over until the
     * pane was pinned against the end of the transcript.
     */
    lastWrite: { delta: number; anchorTop: number; scrollHeight: number } | null;
    /** Frames in a row whose compensation did not fit in the transcript's range. */
    unreachable: number;
    /**
     * Whether the previous frame actually wrote an offset. A page-sized drift
     * that comes back unchanged after a write is the same debt being measured
     * again — a target the offset never kept, or a rect that absorbed the write
     * somewhere else — and paying it once per frame walks the reader down the
     * document; a phone recording put five 2368 px writes in a row that way.
     */
    wroteLastFrame: boolean;
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
    } else {
      // Giving the viewport back also withdraws the button, whoever asked for
      // it: a jump to the tail can land without a `scroll` event, and leaving
      // the flag set would show the button on the next pixel of an upward drag.
      setShowTailAffordance(false);
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
    setHasNewerMessages(false);
    setTotalMessages(0);

    setTokenBudget(null);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setPrependedRowCount(0);
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
  // placeholder entry exists anymore. Background-only work shows in the
  // indicator but is not a response in flight: the composer can send.
  const sessionActivity = (activeSessionId && processingSessions?.get(activeSessionId)) || null;
  const isProcessing = sessionActivity !== null && !sessionActivity.background;
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
      setHasNewerMessages(hasNewerPageLeft(slot));
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
    noteScrollWrite('follow', container);
    // Read back instead of trusting the request: the browser clamps the write to
    // the scrollable range, and the sample has to match what it actually holds.
    programmaticScrollTopRef.current = container.scrollTop;
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
      // A finger on the glass owns the viewport for as long as it is there, in
      // either direction. `isUserScrolledUp` cannot cover the down direction
      // (there is nothing to scroll up to), and the rubber band produces exactly
      // the position our own write would, so nothing else can tell this drag
      // apart from a flush that just landed.
      || touchActiveRef.current
      // The restore's settle loop owns the viewport while it pins a row; a
      // follow write here would race it between frames.
      || anchorSettleRef.current !== null
      || upwardIntentRef.current
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
        || touchActiveRef.current
        || isLoadingMoreRef.current
        || pendingScrollRestoreRef.current
        || searchScrollActiveRef.current
        || anchorSettleRef.current !== null
        || upwardIntentRef.current
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
   *
   * `anchorOffset` is the target this loop holds, not the one the capture took:
   * an offset that travels without a write of ours is folded into it (see the
   * coast handling in `tick`), so what the loop corrects from then on is the
   * geometry the page changed, never the distance the reader travelled.
   */
  const startAnchorSettle = useCallback((
    anchor: HTMLElement,
    anchorOffset: number,
    committedWrite?: {
      delta: number;
      anchorTop: number;
      scrollHeight: number;
      targetOffset: number;
    },
  ) => {
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
      frames: 0,
      correctedPx: 0,
      lastTarget: committedWrite?.targetOffset ?? null,
      lastDrift: 0,
      contended: 0,
      lastOffset: null,
      bounced: false,
      lastWrite: committedWrite ?? null,
      unreachable: 0,
      wroteLastFrame: false,
    };
    noteTranscriptEvent(
      'AS0', container,
      anchor.getAttribute('data-message-timestamp') ?? 'none',
      Math.round(anchorOffset),
    );

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
        // Why the loop stopped decides whether the drift it was holding gets
        // corrected at all: a reader gesture deliberately hands control back,
        // while a disconnected anchor or a session swap means nobody will.
        if (settle && currentContainer) {
          const reason = !settle.anchor.isConnected
            ? 'anchorGone'
            : settle.inputSeq !== readerInputSeqRef.current
              ? 'readerInput'
              : 'sessionGone';
          noteTranscriptEvent(
            'AS1', currentContainer, reason, settle.frames, Math.round(settle.correctedPx),
          );
        }
        anchorSettleRef.current = null;
        return;
      }

      // Past the top edge the platform owns the offset: it is springing the
      // content back and lays its own value over ours a frame later, for as long
      // as the spring runs. Writing through that is the tug of war a phone
      // recording showed — a 2000 px restore re-written on 50 consecutive frames
      // while the offset never left the bounce. Wait for it to come back in
      // range; the correction lands on the first frame after the spring lets go.
      if (currentContainer.scrollTop < 0) {
        settle.stableFrames = 0;
        settle.bounced = true;
        // The offset is the platform's until the spring lets go, so whatever
        // the last write asked for is not comparable to what the next frame
        // will read. Clear all of it: a stale `lastDrift` plus `wroteLastFrame`
        // reads as a stalled write once the spring lands, and the loop then
        // abandons a page-sized correction it still owes.
        settle.lastWrite = null;
        settle.lastTarget = null;
        settle.wroteLastFrame = false;
        settle.lastDrift = 0;
        settle.contended = 0;
        settle.unreachable = 0;
        if (Date.now() - settle.startedAt > ANCHOR_SETTLE_MAX_MS) {
          noteTranscriptEvent(
            'AS1', currentContainer, 'bounce',
            settle.frames, Math.round(settle.correctedPx),
          );
          anchorSettleRef.current = null;
          return;
        }
        anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const offset = currentContainer.scrollTop;
      const previousOffset = settle.lastOffset;
      const springLanded = settle.bounced;
      const wroteLastFrame = settle.wroteLastFrame;
      settle.wroteLastFrame = false;
      settle.bounced = false;
      settle.lastOffset = offset;
      // Has the offset travelled since the previous frame without the loop
      // writing it? A finger lift leaves the scroll view decelerating with no
      // touch event behind it, and a write made into that animation ends it:
      // the old loop re-pinned at frame rate and a recording caught 55 frozen
      // frames (~1.3 s) on a fast flick against 1 frame on a slow one. The
      // travel is the reader's momentum, so it is folded into the target — that
      // keeps the correction owed to the insertion rather than to the fling —
      // and nothing is written until the coast comes to rest, where the drift
      // that is left is geometry and gets paid in one write.
      const landedOnOwnWrite = (
        settle.lastTarget !== null
        && Math.abs(offset - settle.lastTarget) <= ANCHOR_SETTLE_LANDING_SLOP_PX
      );
      const anchorTop = (
        settle.anchor.getBoundingClientRect().top
        - currentContainer.getBoundingClientRect().top
      );
      // A write the pane kept has to move the anchor with it, or the document
      // has to have grown by as much. Neither means the rect is not answering
      // `scrollTop` — a phone recording showed the same 2350 px paid on four
      // consecutive frames while `scrollHeight` never moved a pixel — and every
      // further write only walks the reader away from where they were, until
      // the pane is pinned against the tail.
      const lastWrite = settle.lastWrite;
      settle.lastWrite = null;
      if (landedOnOwnWrite && lastWrite) {
        const travelled = lastWrite.anchorTop - anchorTop;
        const grew = currentContainer.scrollHeight - lastWrite.scrollHeight;
        if (
          Math.abs(travelled - lastWrite.delta) > ANCHOR_SETTLE_EPSILON_PX
          && Math.abs(grew) <= ANCHOR_SETTLE_EPSILON_PX
        ) {
          noteTranscriptEvent(
            'AS1', currentContainer, 'detached',
            settle.frames, Math.round(settle.correctedPx), Math.round(lastWrite.delta),
          );
          anchorSettleRef.current = null;
          return;
        }
      }
      if (
        !springLanded
        && previousOffset !== null
        && !landedOnOwnWrite
        && Math.abs(offset - previousOffset) > ANCHOR_SETTLE_MOMENTUM_PX
      ) {
        settle.anchorOffset -= offset - previousOffset;
        settle.stableFrames = 0;
        settle.lastTarget = null;
        settle.lastDrift = 0;
        settle.contended = 0;
        if (Date.now() - settle.startedAt > ANCHOR_SETTLE_MAX_MS) {
          noteTranscriptEvent(
            'AS1', currentContainer, 'coasting',
            settle.frames, Math.round(settle.correctedPx),
          );
          anchorSettleRef.current = null;
          return;
        }
        anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const drift = anchorTop - settle.anchorOffset;
      settle.frames += 1;
      if (Math.abs(drift) > ANCHOR_SETTLE_EPSILON_PX) {
        // A correction this large coming back at exactly the same size means the
        // previous write never reached the geometry it was paying for. The phone
        // recording behind this: 2368.859 px charged on five consecutive frames,
        // each write a page further down, until the pane was clamped at the
        // tail. One payment stands; an identical second one is a loop, and the
        // loop costs the reader a page every frame it runs.
        const stalled = (
          wroteLastFrame
          && settle.lastDrift !== 0
          && Math.sign(drift) === Math.sign(settle.lastDrift)
          && Math.abs(Math.abs(drift) - Math.abs(settle.lastDrift)) <= ANCHOR_SETTLE_EPSILON_PX
          && Math.abs(drift) > ANCHOR_SETTLE_CONTENDED_MAX_PX
        );
        if (stalled) {
          noteTranscriptEvent(
            'AS1', currentContainer, 'stalled',
            settle.frames, Math.round(settle.correctedPx), Math.round(drift),
          );
          anchorSettleRef.current = null;
          return;
        }
        // Did the previous write survive to this frame? If the offset is not
        // where we put it while the drift still has the same size and sign, the
        // platform is holding an offset of its own (deceleration, rubber band)
        // and writing again only trades the same pixels every frame.
        const swallowed = (
          settle.lastTarget !== null
          && Math.abs(offset - settle.lastTarget) > ANCHOR_SETTLE_LANDING_SLOP_PX
          && Math.sign(drift) === Math.sign(settle.lastDrift)
          && Math.abs(Math.abs(drift) - Math.abs(settle.lastDrift)) < 1
        );
        settle.contended = swallowed ? settle.contended + 1 : 0;
        if (
          Math.abs(drift) <= ANCHOR_SETTLE_CONTENDED_MAX_PX
          && settle.contended >= ANCHOR_SETTLE_CONTENDED_FRAMES
        ) {
          noteTranscriptEvent(
            'AS1', currentContainer, 'contended',
            settle.frames, Math.round(settle.correctedPx), Math.round(drift),
          );
          anchorSettleRef.current = null;
          return;
        }
        settle.stableFrames = 0;
        const target = offset + drift;
        // The compensation can outgrow what the transcript can hold: a widened
        // window that mounts everything above the reader leaves rows below it
        // as estimated placeholders, and their real heights arrive later. A
        // write past the end is clamped by the pane, which parks the reader on
        // the tail and leaves the drift uncorrected, so it is skipped here and
        // re-measured on the next frame instead.
        if (target > currentContainer.scrollHeight - currentContainer.clientHeight) {
          settle.lastTarget = null;
          settle.lastDrift = drift;
          settle.unreachable += 1;
          if (settle.unreachable >= ANCHOR_SETTLE_UNREACHABLE_FRAMES) {
            noteTranscriptEvent(
              'AS1', currentContainer, 'unreachable',
              settle.frames, Math.round(settle.correctedPx), Math.round(drift),
            );
            anchorSettleRef.current = null;
            return;
          }
          anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }
        settle.unreachable = 0;
        const before = currentContainer.scrollTop;
        currentContainer.scrollTop = target;
        // Read the offset back instead of trusting the float that was written:
        // WebKit quantises it to the device's layout grid, and the next frame
        // compares against whatever it actually stored. A read-back that is
        // further off than that grid means the pane kept an offset of its own,
        // and the target is what it will be measured against next frame.
        const landed = currentContainer.scrollTop;
        settle.lastTarget = Math.abs(landed - target) <= ANCHOR_SETTLE_LANDING_SLOP_PX
          ? landed
          : target;
        // The frame's travel is measured from where this write put the offset,
        // not from where it found it: otherwise the next frame reads our own
        // correction as momentum and folds it into the anchor's target again.
        settle.lastOffset = landed;
        settle.lastWrite = {
          delta: landed - before,
          anchorTop,
          scrollHeight: currentContainer.scrollHeight,
        };
        settle.lastDrift = drift;
        settle.correctedPx += drift;
        settle.wroteLastFrame = true;
        noteScrollWrite('anchorSettle', currentContainer);
      } else {
        settle.stableFrames += 1;
        settle.lastTarget = null;
        settle.lastDrift = 0;
        settle.contended = 0;
      }

      if (
        settle.stableFrames >= ANCHOR_SETTLE_STABLE_FRAMES
        || Date.now() - settle.startedAt > ANCHOR_SETTLE_MAX_MS
      ) {
        noteTranscriptEvent(
          'AS1', currentContainer,
          Date.now() - settle.startedAt > ANCHOR_SETTLE_MAX_MS ? 'timeout' : 'stable',
          settle.frames, Math.round(settle.correctedPx), Math.round(drift),
        );
        anchorSettleRef.current = null;
        return;
      }
      anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
    };

    anchorSettleFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelAnchorSettle]);

  /**
   * The reader asked for the tail with the affordance above the composer.
   *
   * Both latches are dropped before the write, exactly as a send does: leaving
   * `isUserScrolledUp` to the scroll handler cannot work, because the jump lands
   * precisely on the offset this writer recorded and `handleScroll` excludes a
   * landing on our own write from the evidence that the reader moved down — the
   * latch would survive and the affordance would stay on screen. Clearing it also
   * hands the position to `followTranscriptLayout`, which keeps the tail pinned
   * while the rows above it settle.
   */
  const scrollToBottomAndReset = useCallback(() => {
    setIsUserScrolledUp(false);
    upwardIntentRef.current = false;
    scrollToBottom();
    if (allMessagesLoaded) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
      setAllMessagesLoaded(false);
      allMessagesLoadedRef.current = false;
    }
  }, [allMessagesLoaded, scrollToBottom, setIsUserScrolledUp]);

  /**
   * Answers a tail press that arrived while the transcript was coasting.
   *
   * iOS stops dispatching touches to the foreground page once its own
   * deceleration starts, so such a press reaches no DOM listener at all: the
   * only native reaction is the brake that stops the coast, which is why the
   * affordance stayed inert until the pane came to rest. The app's native side
   * (see `TailTapPlugin.swift`) forwards the point of every tap it sees, and the
   * hit test below decides whether the finger landed on the affordance — a press
   * anywhere else is the reader stopping the scroll, not asking for the tail.
   */
  useEffect(() => {
    const host = window as Window & { __cloudcliTailTap?: (x: number, y: number) => void };
    const handleTap = (x: number, y: number): void => {
      const target = document.elementFromPoint(x, y);
      if (!target?.closest('[data-transcript-tail-affordance]')) return;
      scrollToBottomAndReset();
    };
    host.__cloudcliTailTap = handleTap;
    return () => {
      if (host.__cloudcliTailTap === handleTap) delete host.__cloudcliTailTap;
    };
  }, [scrollToBottomAndReset]);

  /**
   * Takes the viewport back to the tail because the reader asked for it in the
   * only way that cannot be ambiguous — they sent a message.
   *
   * Two things separate this from a bare `scrollToBottom()`. First, the intent
   * outranks a pull: a send clears the ownership latch *and* the gesture
   * stand-down latch, so a message typed while reading history still lands on
   * the tail instead of staying pinned where the reader left it.
   *
   * Second, it does not settle for one write. The write that reaches the bottom
   * is measured against the geometry of that instant, and a long transcript
   * answers with placeholders and unmeasured rows; the lazy rows, markdown and
   * images then settle to real heights and nothing corrects the position, so the
   * view ends up short of — or nowhere near — the message just sent. This is the
   * same race the session-open scroll lost, and it is answered the same way:
   * hand the position to `followTranscriptLayout`, which re-pins the bottom every
   * frame until the geometry holds still, and still stands down the moment the
   * reader takes the viewport back.
   */
  const scrollToLatest = useCallback(() => {
    setIsUserScrolledUp(false);
    upwardIntentRef.current = false;
    scrollToBottom();
    followTranscriptLayout();
  }, [followTranscriptLayout, scrollToBottom, setIsUserScrolledUp]);

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
      const requestStartedAt = Date.now();
      noteTranscriptEvent('P0', container, SESSION_MESSAGES_PAGE_SIZE);

      try {
        const result = await sessionStore.fetchMore(selectedSession.id, {
          limit: SESSION_MESSAGES_PAGE_SIZE,
          canRequest: () => (
            isActiveRef.current
            && activeSessionIdRef.current === selectedSession.id
          ),
        });
        const { slot, prependedCount } = result;
        // The reader can switch sessions while the page is in flight. These
        // totals describe the transcript that was on screen when the request
        // started; folding them into the new one shows the wrong "showing
        // N / M" and keeps offering pages that do not exist.
        if (!isActiveRef.current || activeSessionIdRef.current !== selectedSession.id) {
          return;
        }
        setHasMoreMessages(slot.hasMore);
        setHasNewerMessages(hasNewerPageLeft(slot));
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
        // Committing inside a spring measures against a viewport that is moving
        // by itself, so wait for the edge first — see `waitForScrollableEdge`.
        await waitForScrollableEdge(container);
        if (!isActiveRef.current || activeSessionIdRef.current !== selectedSession.id) {
          return;
        }
        noteTranscriptEvent(
          'P1', container, prependedCount, Date.now() - requestStartedAt,
          scrollRestoreState ? Math.round(scrollRestoreState.height) : -1,
        );
        armScrollRestore(scrollRestoreState);
        // A Turn page holds however many rows fit the byte budget — often far
        // more than the legacy row-page size — so the render window must grow
        // by the rows actually prepended, or the window top would fall further
        // behind the loaded content on every upward page.
        setVisibleMessageCount((prev) => prev + Math.max(prependedCount, SESSION_MESSAGES_PAGE_SIZE));
        setPrependedRowCount(prependedCount);
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
      // Same rule as the older page: the answer belongs to the session that
      // asked for it (see `loadOlderMessages`).
      if (!isActiveRef.current || activeSessionIdRef.current !== selectedSession.id) {
        return;
      }
      setHasMoreMessages(slot.hasMore);
      setHasNewerMessages(hasNewerPageLeft(slot));
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

    // The button is offered only once the tail is properly out of view, and
    // withdrawn only after the reader has come back close to it. The ownership
    // latch below cannot answer this: it sets on the first pixel of an upward
    // move, which is well before the reader has left anything behind to return
    // to.
    const gapPastTail = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowTailAffordance((wasVisible) => (
      wasVisible
        ? gapPastTail > TAIL_AFFORDANCE_HIDE_GAP_PX
        : gapPastTail > TAIL_AFFORDANCE_SHOW_GAP_PX
    ));

    // A `scroll` event cannot say who moved the viewport. A follow write only
    // ever moves it down to the new bottom, and content arriving below a
    // stationary viewport leaves `scrollTop` untouched, so a mere gap is not
    // evidence that the reader took over — reading it as such is what let a
    // single sample of growth latch the transcript out of following for the rest
    // of the answer. Only a fall since the previous sample, or a gesture that is
    // pulling the transcript down, counts.
    //
    // A fall is the reader's only if it did not land where our own writer put
    // the viewport (see `programmaticScrollTopRef`): the pane-height
    // compensation moves it up when the pane grows, and a fast answer can push
    // the gap past the threshold before that write's own event is dispatched.
    const landedOnOurOwnWrite = (
      // A finger that has not lifted owns the viewport even when the position it
      // produced is one we also wrote. In the rubber band `scrollTop` sits on
      // the clamp for hundreds of ms while the content is visibly away from it,
      // so `landedOnOurOwnWrite` is true the whole time and the gap-based rules
      // below would go on calling the drag ours.
      !touchActiveRef.current
      && programmaticScrollTopRef.current !== null
      && Math.abs(container.scrollTop - programmaticScrollTopRef.current) <= SCROLL_UP_EPSILON_PX
    );
    const movedUp = (
      previousTop !== null
      && container.scrollTop < previousTop - SCROLL_UP_EPSILON_PX
      && !landedOnOurOwnWrite
    );
    // A downward move is how the reader gives the viewport back. It has to be
    // observed directly: the follow stops writing the moment the latch is set,
    // so `scrollTop` can only rise again because the reader pushed it, and
    // `nearBottom` alone would release the latch on the very next event after a
    // pull shorter than the threshold — the viewport would still be a few pixels
    // off the bottom and the follow would yank it back. A landing on our own
    // write is excluded for the mirror-image reason: a shrinking pane (the
    // keyboard rising) compensates `scrollTop` downward, and that is not the
    // reader handing the viewport back either.
    const movedDown = (
      previousTop !== null
      && container.scrollTop > previousTop + SCROLL_UP_EPSILON_PX
      && !landedOnOurOwnWrite
    );
    const readerOwnsViewport = movedUp || upwardIntentRef.current;
    if (isUserScrolledUpRef.current) {
      // Latching stays sticky. The reader may keep reading further up while the
      // answer grows below them, and that growth must not read as "back at the
      // bottom" and drag them down.
      //
      // Only input can hand the viewport back. A coasting fling, or the layout
      // resolving under it, moves `scrollTop` down through the same range, and
      // releasing on that let a release 41 px from the bottom re-arm the follow
      // mid-deceleration.
      if (nearBottom && movedDown && Date.now() - lastReaderInputAtRef.current <= READER_INPUT_LIVE_MS) {
        upwardIntentRef.current = false;
        setIsUserScrolledUp(false);
      }
    } else if (readerOwnsViewport) {
      // The gesture itself is enough. Requiring a gap past the threshold let a
      // slow drag lose the race: the follow wrote the bottom back before the gap
      // could grow, no latch was set, and the transcript snapped back once the
      // gesture window expired.
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
      // Past the top edge the pane is rubber-banding, not sitting still: the
      // position belongs to the platform's spring, and a page inserted into it
      // cannot be compensated until the spring lets go. Waiting for the return
      // to 0 costs the fraction of a second the bounce takes.
      if (container.scrollTop < 0) return;
      if (topLoadLockRef.current) {
        // The reader moved back down through the page that was just inserted, so
        // the next reach for the top is a new request. A latched guard is always
        // releasable here: it is only set by a page that inserted more than this
        // much above the reader (see TOP_LOAD_LOCK_MIN_PROGRESS_PX).
        //
        // The landing on the restore's own write is not that move. Counting it
        // released the guard during the insert itself, so when the platform put
        // `scrollTop` back at the top a moment later (WebKit drops a write made
        // mid-bounce) the next sample started another page — four pages and 413
        // rows in under a second on iOS, each one throwing the reader further up.
        const landingOnRestore = (
          programmaticScrollTopRef.current !== null
          && Math.abs(container.scrollTop - programmaticScrollTopRef.current) <= SCROLL_UP_EPSILON_PX
        );
        if (container.scrollTop > TOP_LOAD_LOCK_MIN_PROGRESS_PX && !landingOnRestore) {
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
      // How far the reader moved the pane themselves while the page was in
      // flight. `top` and `anchorOffset` were sampled when the request started,
      // so a drag in between is counted twice by the rect comparison — once as
      // the row's new offset, which is how the insertion is measured, and once
      // in the offset itself. Left in, the reader's own travel is added to the
      // page's height: a 12 px/frame drag landed the restore 48 px off and a
      // 24 px/frame one 48-72 px off, permanently, because the settle loop then
      // started from the same stale offset. Splitting them keeps the correction
      // to the rows that were actually inserted, and makes every branch below a
      // relative write so the reader's position is not overwritten by `top`.
      const readerShift = container.scrollTop - top;
      let insertedAbove: number;
      if (anchor?.isConnected && anchorOffset !== null) {
        const nextAnchorOffset = (
          anchor.getBoundingClientRect().top
          - container.getBoundingClientRect().top
        );
        insertedAbove = nextAnchorOffset - anchorOffset + readerShift;
        // Where the row has to sit once the page's height is paid for: the
        // offset it has now, less the insertion. Derived rather than read back
        // because the write below is skipped while the pane is past the top
        // edge, and the settle loop still has to know what it is aiming at.
        const anchorTargetOffset = nextAnchorOffset - insertedAbove;
        // A pane past the top edge is mid-spring: the platform owns the offset
        // and discards any write made there, and a write also ends the spring so
        // the content lands in one frame instead of animating home. Leave the
        // offset alone and let the settle loop land the compensation once the
        // spring releases.
        if (container.scrollTop >= 0) {
          container.scrollTop += insertedAbove;
          noteScrollWrite('restoreAnchor', container);
          // Recorded so the pager's guard can tell a landing on this write from
          // the reader moving down again (see the guard in `handleScroll`).
          programmaticScrollTopRef.current = container.scrollTop;
        }
        noteTranscriptEvent(
          'RS', container, 'anchor', Math.round(insertedAbove),
          Math.round(anchorOffset), Math.round(nextAnchorOffset),
        );
        // The page just mounted as estimated-height placeholders (see
        // ChatMessagesPane's lazy rows), so this compensation is measured
        // against estimated geometry. The settle loop re-pins the anchor while
        // the real heights land; on WebKit nothing else will. The write itself
        // is handed over, so the loop's first frame can tell a repeat of this
        // insertion from geometry that is still settling.
        startAnchorSettle(
          anchor,
          anchorTargetOffset,
          container.scrollTop >= 0
            ? {
                delta: insertedAbove,
                anchorTop: nextAnchorOffset,
                scrollHeight: container.scrollHeight,
                targetOffset: container.scrollTop,
              }
            : undefined,
        );
      } else if (tailAnchor?.isConnected && tailAnchorOffset !== null) {
        // No pinned row survived to the commit. The tail wrapper's top only
        // moves when content is inserted above it, so its displacement is the
        // above-insertion without the streaming growth a scrollHeight delta
        // would wrongly include.
        insertedAbove = Math.max(
          (tailAnchor.getBoundingClientRect().top - container.getBoundingClientRect().top)
            - tailAnchorOffset + readerShift,
          0,
        );
        container.scrollTop += insertedAbove;
        noteScrollWrite('restoreTail', container);
        programmaticScrollTopRef.current = container.scrollTop;
        noteTranscriptEvent('RS', container, 'tail', Math.round(insertedAbove), top);
      } else {
        // `scrollHeight` growth is the insertion plus whatever lazy rows above
        // measured, and no part of it is the reader's own travel.
        insertedAbove = Math.max(container.scrollHeight - height, 0);
        container.scrollTop += insertedAbove;
        noteScrollWrite('restoreHeight', container);
        programmaticScrollTopRef.current = container.scrollTop;
        noteTranscriptEvent('RS', container, 'height', Math.round(insertedAbove), top);
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
    setPrependedRowCount(0);
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    cancelAnchorSettle();
    wasNearTopRef.current = false;
    lastScrollTopSampleRef.current = null;
    programmaticScrollTopRef.current = null;
    upwardIntentRef.current = false;
    touchOriginYRef.current = null;
    touchActiveRef.current = false;
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
      // Opening a session pins the tail while the transcript settles, but the
      // reader's first gesture has to win: a pull that arrives during those
      // frames must not be written back to the bottom.
      if (isUserScrolledUpRef.current || upwardIntentRef.current) {
        pendingInitialScrollRef.current = false;
        return;
      }
      container.scrollTop = container.scrollHeight;
      noteScrollWrite('initialScroll', container);
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

  /**
   * Pagination the top chrome and the near-top loader read belongs to the
   * session whose transcript is on screen. Every field here is written from
   * that session's slot, so a switch has to clear it in the same commit that
   * swaps the rows: the load effect below runs after paint, and until it did,
   * the first frame paired the new (short) transcript with the previous
   * session's `hasMoreMessages`/`totalMessages` — the bar read "显示 3 / 1181
   * 条消息" for a three-message conversation, and because `scrollTop` is 0 in a
   * transcript shorter than the pane, the near-top handler could also spend a
   * page request on the old cursor, showing "正在加载更早的消息".
   */
  const resetPaginationState = useCallback(() => {
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setHasNewerMessages(false);
    setTotalMessages(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setPrependedRowCount(0);
    setIsLoadingMoreMessages(false);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    wasNearTopRef.current = false;
    // The lock is a promise about the page that was just inserted above the
    // reader; a different transcript has no such page.
    topLoadLockRef.current = false;
    if (loadAllOverlayTimerRef.current) {
      clearTimeout(loadAllOverlayTimerRef.current);
      loadAllOverlayTimerRef.current = null;
    }
    if (loadAllFinishedTimerRef.current) {
      clearTimeout(loadAllFinishedTimerRef.current);
      loadAllFinishedTimerRef.current = null;
    }
  }, []);

  const paginatedSessionIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const nextSessionId = selectedSession?.id ?? null;
    if (paginatedSessionIdRef.current === nextSessionId) return;
    paginatedSessionIdRef.current = nextSessionId;
    resetPaginationState();
  }, [resetPaginationState, selectedSession?.id]);

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
      // next render). Keep the active view intact instead of wiping it — but
      // only for a response in flight: a session whose turn has ended with
      // background work still running has a canonical id, so a missing
      // selection there is a real navigation away.
      const activity = currentSessionId ? processingSessionsRef.current?.get(currentSessionId) : undefined;
      if (activity && !activity.background) {
        return;
      }

      setCurrentSessionId(null);
      messagesOffsetRef.current = 0;
      setHasMoreMessages(false);
      setHasNewerMessages(false);
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

    // Reset pagination/scroll state. The layout effect above has already done
    // this before the switch painted; repeating it keeps the other entry
    // points (a project change under the same session id) on the same path.
    resetPaginationState();

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
      // A slower first page can land after the reader moved on; its totals
      // belong to the session that asked for them.
      if (slot && isActiveRef.current && activeSessionIdRef.current === selectedSessionId) {
        setHasMoreMessages(slot.hasMore);
        setHasNewerMessages(hasNewerPageLeft(slot));
        setTotalMessages(slot.total);
        messagesOffsetRef.current = slot.offset;
        if (slot.tokenUsage !== undefined) {
          setTokenBudget((slot.tokenUsage as Record<string, unknown> | null) ?? null);
        }
      }
      if (activeSessionIdRef.current === selectedSessionId) {
        setIsLoadingSessionMessages(false);
      }
    }).catch(() => {
      if (activeSessionIdRef.current === selectedSessionId) {
        setIsLoadingSessionMessages(false);
      }
    });
  }, [
    isActive,
    requestLatestMessages,
    resetPaginationState,
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
              const loadedEveryDirection = !slot.hasMore && !slot.turnPageInfo?.newerCursor;
              setHasMoreMessages(slot.hasMore);
              setHasNewerMessages(hasNewerPageLeft(slot));
              setTotalMessages(slot.total);
              messagesOffsetRef.current = slot.offset;
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
      // The gesture is already known to be a pull, even if the `scroll` event
      // that latches it has not been dispatched yet. Writing here would put the
      // viewport back at the bottom before that event can measure the gap.
      || upwardIntentRef.current
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
    //
    // The intent is a latch, not a deadline: a pull shorter than the gap
    // threshold leaves `scrollTop` a few pixels off the bottom, so a window
    // would expire while the reader is still holding the transcript away from
    // the bottom and the follow would snap it back. It is cleared by the
    // opposite gesture (pushing the transcript back down) or, in `handleScroll`,
    // when the reader actually reaches the bottom again.
    const armUpwardIntent = () => {
      upwardIntentRef.current = true;
    };
    const releaseUpwardIntent = () => {
      upwardIntentRef.current = false;
    };
    const handleWheel = (event: WheelEvent) => {
      readerInputSeqRef.current += 1;
      lastReaderInputAtRef.current = Date.now();
      if (event.deltaY < 0) armUpwardIntent();
      if (event.deltaY > 0) {
        releaseUpwardIntent();
        if (isNearBottom()) void loadNewerMessages();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      touchActiveRef.current = true;
      // A finger that lands while the pane is still coasting brakes it without
      // emitting a move; that press is reader input too.
      lastReaderInputAtRef.current = Date.now();
      touchOriginYRef.current = event.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      readerInputSeqRef.current += 1;
      lastReaderInputAtRef.current = Date.now();
      const originY = touchOriginYRef.current;
      const currentY = event.touches[0]?.clientY;
      // A finger travelling down pulls the transcript down, so the reader is
      // heading toward older messages.
      if (originY !== null && currentY !== undefined && currentY - originY > TOUCH_UP_INTENT_MIN_TRAVEL_PX) {
        armUpwardIntent();
      }
      // Travelling back up is the reader returning to the tail. Releasing the
      // latch itself still waits for the viewport to reach the bottom, so a
      // brief downward flick mid-read does not hand the viewport back.
      if (originY !== null && currentY !== undefined && originY - currentY > TOUCH_UP_INTENT_MIN_TRAVEL_PX) {
        releaseUpwardIntent();
        if (isNearBottom()) void loadNewerMessages();
      }
    };
    const handleTouchEnd = () => {
      touchActiveRef.current = false;
      touchOriginYRef.current = null;
      // Lifting the finger hands the viewport back. If the answer went quiet
      // while the finger was down, nothing else asks for the tail again: every
      // flush was refused by `touchActiveRef`, and a stationary finger emits no
      // `scroll` event afterwards to release anything. A reader who is actually
      // up in the transcript keeps their position — the latch and the upward
      // intent both still stand the follow down.
      // Nothing to close when the pane is already on the tail, and the write
      // would not be free: past the end of the range the rubber band is springing
      // the content back, and any write to `scrollTop` — including the clamp the
      // viewport is parked on — ends that gesture, so the blank the drag opened
      // disappears in one frame instead of animating home.
      const container = scrollContainerRef.current;
      const gap = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight
        : 0;
      if (gap > SCROLL_UP_EPSILON_PX && !isUserScrolledUpRef.current) {
        followTranscriptLayout();
      }
    };

    // Dragging the desktop scrollbar emits no wheel event, so the drag has to
    // count as reader input on its own; otherwise dragging back to the tail
    // never releases the latch and the follow stays off until the affordance is
    // tapped.
    const handlePointerDown = () => {
      lastReaderInputAtRef.current = Date.now();
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    container.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [followTranscriptLayout, handleScroll, isNearBottom, loadNewerMessages]);

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
    // The affordance only appears at the top of the transcript, so the reader is
    // reading history, not following the tail. Latching here keeps the follow
    // out of the commit: widening the window can make an intermediate commit
    // report a much shorter document, and a phone recording showed the follow
    // parking the pane 2400 px lower the moment that commit landed.
    setIsUserScrolledUp(true);
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
        setHasNewerMessages(false);
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
  }, [armScrollRestore, isActive, selectedSession, selectedProject, isLoadingAllMessages, currentSessionId, sessionStore, setIsUserScrolledUp]);

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

  // Brings one row into view even when it is outside the visible window or
  // sits in a lazy row that has not mounted: widen the window to include it,
  // then scroll to the row's wrapper, which is in the DOM as soon as the row
  // is inside the window, mounted or not.
  const revealMessage = useCallback((message: ChatMessage) => {
    const index = chatMessages.indexOf(message);
    if (index >= 0) {
      setVisibleMessageCount((prev) => visibleCountToReveal(chatMessages.length, index, prev));
    }

    const attempt = (remaining: number) => {
      const container = scrollContainerRef.current;
      // The widened window commits after this frame, so the row can be absent
      // on the first attempts; only the last one may settle for the nearest
      // row (a hit collapsed inside a tool group carries the group's
      // timestamp), or the first attempt scrolls to an unrelated row and the
      // retries never run.
      const element = container ? findRenderedMessageElement(container, message.timestamp, remaining === 0) : null;
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (remaining > 0) {
        requestAnimationFrame(() => attempt(remaining - 1));
      }
    };
    requestAnimationFrame(() => attempt(10));
  }, [chatMessages]);

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
    hasNewerMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    showTailAffordance,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    prependedRowCount,
    visibleMessages,
    loadEarlierMessages,
    revealMessage,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    programmaticScrollTopRef,
    scrollToLatest,
    scrollToBottomAndReset,
    followTranscriptLayout,
    handleScroll,
    requestLatestMessages,
    searchRevealRequest,
  };
}
