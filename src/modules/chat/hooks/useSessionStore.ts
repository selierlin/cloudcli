/**
 * Session-keyed message store.
 *
 * Holds per-session state in a Map keyed by sessionId.
 * Session switch = change activeSessionId pointer. No clearing. Old data stays.
 * WebSocket handler = store.appendRealtime(msg.sessionId, msg). One line.
 * No localStorage for messages. Backend JSONL is the source of truth.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type {
  LLMProvider,
  NormalizedMessage,
  SessionMessagesRequestOptions,
  StreamChannel,
  StreamingChannelUpdate,
  TurnHistoryPageInfo,
} from '@/shared/types';
import { removeOptimisticUserEchoes, upsertRealtimeMessages } from '@/modules/chat/utils/sessionMessageReconciliation';
import {
  findLatestPageOverlapLength,
  hasReachedCachedTailTimeBoundary,
  isOlderPageShifted,
  mergeLatestServerPage,
  mergeOlderServerPage,
  olderPagePrecedesCachedHistory,
  planLatestPageBridge,
  resolveLatestPagePagination,
  SESSION_MESSAGES_PAGE_SIZE,
} from '@/modules/chat/utils/sessionMessagePagination';

// ─── NormalizedMessage (mirrors server/adapters/types.js) ────────────────────


// ─── Per-session slot ────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'error';

export type SessionSlot = {
  serverMessages: NormalizedMessage[];
  realtimeMessages: NormalizedMessage[];
  merged: NormalizedMessage[];
  /** @internal Cache-invalidation refs for computeMerged */
  _lastServerRef: NormalizedMessage[];
  _lastRealtimeRef: NormalizedMessage[];
  /**
   * @internal Serializes history reads for this session so an older-page
   * request calculates its offset after any latest-page refresh completes.
   */
  _historyMutationQueue: Promise<void>;
  status: SessionStatus;
  fetchedAt: number;
  total: number;
  hasMore: boolean;
  offset: number;
  tokenUsage: unknown;
  /** Continuation state for the active snapshot when this slot was loaded through Turn pagination. */
  turnPageInfo: TurnHistoryPageInfo | null;
  /** Byte budget repeated on continuation requests so every page uses the same policy. */
  turnPageByteBudget?: number;
};

const EMPTY: NormalizedMessage[] = [];
const SESSION_HISTORY_REQUEST_TIMEOUT_MS = 30_000;

function createEmptySlot(): SessionSlot {
  return {
    serverMessages: EMPTY,
    realtimeMessages: EMPTY,
    merged: EMPTY,
    _lastServerRef: EMPTY,
    _lastRealtimeRef: EMPTY,
    status: 'idle',
    fetchedAt: 0,
    total: 0,
    hasMore: false,
    offset: 0,
    turnPageInfo: null,
    // `undefined` means "no page has reported usage for this session yet", and
    // every consumer distinguishes that from a reported `null`. Initialising it
    // to `null` made the two indistinguishable, so a provider whose history
    // payload carries no usage looked like one reporting zero — and every
    // history refresh overwrote the value fetched from the token-usage
    // endpoint with it.
    tokenUsage: undefined,
    _historyMutationQueue: Promise.resolve(),
  };
}

type SessionHistoryPage = {
  messages: NormalizedMessage[];
  total: number;
  hasMore: boolean;
  tokenUsage?: unknown;
  pageInfo?: TurnHistoryPageInfo;
};

class SessionHistoryRequestError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(status: number, code?: string) {
    super(`HTTP ${status}`);
    this.name = 'SessionHistoryRequestError';
    this.status = status;
    this.code = code;
  }
}

function readTurnHistoryPageInfo(value: unknown): TurnHistoryPageInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const pageInfo = value as Record<string, unknown>;
  const partial = pageInfo.partial;
  const newerCursor = pageInfo.newerCursor;
  if (
    pageInfo.mode !== 'turns'
    || typeof pageInfo.snapshotVersion !== 'string'
    || (typeof pageInfo.nextCursor !== 'string' && pageInfo.nextCursor !== null)
    || (newerCursor !== undefined && typeof newerCursor !== 'string' && newerCursor !== null)
    || !partial
    || typeof partial !== 'object'
  ) {
    return undefined;
  }
  const partialRecord = partial as Record<string, unknown>;
  if (typeof partialRecord.older !== 'boolean' || typeof partialRecord.newer !== 'boolean') {
    return undefined;
  }
  return {
    mode: 'turns',
    snapshotVersion: pageInfo.snapshotVersion,
    nextCursor: pageInfo.nextCursor,
    newerCursor: typeof newerCursor === 'string' ? newerCursor : null,
    partial: {
      older: partialRecord.older,
      newer: partialRecord.newer,
    },
  };
}

function enqueueHistoryMutation<T>(
  slot: SessionSlot,
  operation: () => Promise<T>,
): Promise<T> {
  const result = slot._historyMutationQueue.then(operation);
  slot._historyMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function requestSessionHistoryPage(
  sessionId: string,
  options: SessionMessagesRequestOptions,
): Promise<SessionHistoryPage> {
  const response = await api.providers.sessionMessages(sessionId, options, {
    signal: AbortSignal.timeout(SESSION_HISTORY_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    let code: string | undefined;
    try {
      const errorBody = await response.json();
      code = typeof errorBody?.error?.code === 'string' ? errorBody.error.code : undefined;
    } catch {
      // A non-JSON failure still carries its HTTP status.
    }
    throw new SessionHistoryRequestError(response.status, code);
  }

  const body = await response.json();
  const data = body?.data ?? body;
  const messages: NormalizedMessage[] = Array.isArray(data.messages) ? data.messages : [];
  const pageInfo = readTurnHistoryPageInfo(data.pageInfo);

  return {
    messages,
    total: typeof data.total === 'number' ? data.total : messages.length,
    hasMore: Boolean(data.hasMore),
    ...(pageInfo ? { pageInfo } : {}),
    ...(
      data && typeof data === 'object' && 'tokenUsage' in data
        ? { tokenUsage: data.tokenUsage }
        : {}
    ),
  };
}

/**
 * Compute merged messages: server + realtime, deduped by id and adjacent
 * assistant echo (same trimmed text), so finalized stream rows do not stack
 * on top of the persisted copy before realtime is cleared.
 */
function readMessageTime(m: NormalizedMessage): number | null {
  const time = Date.parse(m.timestamp);
  return Number.isFinite(time) ? time : null;
}

function compareMessagesChronologically(a: NormalizedMessage, b: NormalizedMessage): number {
  const timeA = readMessageTime(a) ?? 0;
  const timeB = readMessageTime(b) ?? 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  return 0;
}

/**
 * The time a row sorts by, which is its own except for one case.
 *
 * The optimistic echo of an edited message is the row whose clock cannot be
 * trusted against the rows around it. Providers that rewind by branching —
 * Codex has no way to resume a transcript partway, so an edit copies the kept
 * history into a new one — write the copy with the timestamps of the copy. So
 * every turn that survived the cut comes back from the next refresh stamped a
 * moment *after* the replacement was typed, and the message the user just sent
 * jumps to the top of the conversation.
 *
 * A replacement is by definition the newest thing in the conversation, so it
 * is sorted as such instead of by what the clock said when it was typed.
 */
function readSortTime(message: NormalizedMessage, replacementFloor: number): number {
  const time = readMessageTime(message) ?? 0;
  return message.replacesAnchorId ? Math.max(time, replacementFloor) : time;
}

/**
 * Count how many user turns precede `message` in a chronologically merged view
 * of server + realtime rows. Used to match a realtime row to the correct turn
 * on disk when several turns share identical assistant text.
 */
function getUserTurnOrdinalBefore(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): number {
  const messageTime = readMessageTime(message);
  let userCount = 0;

  for (const candidate of [...serverMessages, ...realtimeMessages].sort(compareMessagesChronologically)) {
    if (candidate.id === message.id) {
      break;
    }

    const candidateTime = readMessageTime(candidate);
    if (
      messageTime !== null
      && candidateTime !== null
      && candidateTime > messageTime
    ) {
      break;
    }

    if (candidate.kind === 'text' && candidate.role === 'user') {
      userCount++;
    }
  }

  return Math.max(0, userCount - 1);
}

function findServerTurnRangeByOrdinal(
  serverMessages: NormalizedMessage[],
  turnOrdinal: number,
): { start: number; end: number } | null {
  let userCount = -1;
  let start = -1;

  for (let index = 0; index < serverMessages.length; index++) {
    const message = serverMessages[index];
    if (message.kind === 'text' && message.role === 'user') {
      userCount++;
      if (userCount === turnOrdinal) {
        start = index;
        break;
      }
    }
  }

  if (start < 0) {
    return null;
  }

  let end = serverMessages.length;
  for (let index = start + 1; index < serverMessages.length; index++) {
    if (serverMessages[index].kind === 'text' && serverMessages[index].role === 'user') {
      end = index;
      break;
    }
  }

  return { start, end };
}

function findContentEchoInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
  matchesServerRow: (serverMessage: NormalizedMessage) => boolean,
): NormalizedMessage | undefined {
  const assistantText = (message.content || '').trim();
  if (!assistantText) {
    return undefined;
  }

  const turnOrdinal = getUserTurnOrdinalBefore(message, serverMessages, realtimeMessages);
  const turnRange = findServerTurnRangeByOrdinal(serverMessages, turnOrdinal);
  if (!turnRange) {
    return undefined;
  }

  return serverMessages
    .slice(turnRange.start + 1, turnRange.end)
    .find((serverMessage) =>
      matchesServerRow(serverMessage)
      && (serverMessage.content || '').trim() === assistantText,
    );
}

function isAssistantTextEchoedInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): boolean {
  return Boolean(findContentEchoInSameTurnOnServer(
    message,
    serverMessages,
    realtimeMessages,
    (serverMessage) => serverMessage.kind === 'text' && serverMessage.role === 'assistant',
  ));
}

/**
 * Reasoning traces live on their own `thinking` rows, so the text echo check
 * never matches them. Without this, a thinking row streamed live stays beside
 * the persisted row it later becomes — the same duplicate the text channel
 * already guards against, just invisible until the panel is expanded.
 */
function isThinkingEchoedInSameTurnOnServer(
  message: NormalizedMessage,
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): boolean {
  return Boolean(findContentEchoInSameTurnOnServer(
    message,
    serverMessages,
    realtimeMessages,
    (serverMessage) => serverMessage.kind === 'thinking',
  ));
}

/** Keeps the UI segment mounted when a persisted row replaces its live echo. */
function carrySegmentIdentitiesIntoServerMessages(
  serverMessages: NormalizedMessage[],
  previousServerMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  const previousSegmentIds = new Map(
    previousServerMessages
      .filter((message) => message.segmentId)
      .map((message) => [message.id, message.segmentId] as const),
  );
  let next = serverMessages.map((message) => {
    const segmentId = previousSegmentIds.get(message.id);
    return segmentId && message.segmentId !== segmentId
      ? { ...message, segmentId }
      : message;
  });

  for (const realtimeMessage of realtimeMessages) {
    if (!realtimeMessage.segmentId) continue;
    const persistedMatch = realtimeMessage.kind === 'thinking'
      ? findContentEchoInSameTurnOnServer(
          realtimeMessage,
          next,
          realtimeMessages,
          (message) => message.kind === 'thinking',
        )
      : realtimeMessage.kind === 'text' && realtimeMessage.role === 'assistant'
        ? findContentEchoInSameTurnOnServer(
            realtimeMessage,
            next,
            realtimeMessages,
            (message) => message.kind === 'text' && message.role === 'assistant',
          )
        : undefined;
    if (!persistedMatch || persistedMatch.segmentId === realtimeMessage.segmentId) continue;
    next = next.map((message) => message === persistedMatch
      ? { ...message, segmentId: realtimeMessage.segmentId }
      : message);
  }

  return next;
}

/**
 * After `finalizeStreaming`, the client holds a synthetic assistant `text` row
 * while the sessions API soon returns the same reply with a different id.
 * Those sit back-to-back in merged order and look like duplicate bubbles until
 * A persisted-tail refresh reconciles realtime. Collapse same-text assistant rows and
 * stream_placeholder → text when content matches.
 */
function dedupeAdjacentAssistantEchoes(merged: NormalizedMessage[]): NormalizedMessage[] {
  const out: NormalizedMessage[] = [];
  for (const m of merged) {
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.kind === 'stream_delta' && m.kind === 'text' && m.role === 'assistant') {
        const ps = (prev.content || '').trim();
        const ms = (m.content || '').trim();
        if (ps.length > 0 && ps === ms) {
          out[out.length - 1] = prev.segmentId && !m.segmentId
            ? { ...m, segmentId: prev.segmentId }
            : m;
          continue;
        }
      }
      if (
        prev.kind === 'stream_delta'
        && prev.streamChannel === 'thinking'
        && m.kind === 'thinking'
      ) {
        const ps = (prev.content || '').trim();
        const ms = (m.content || '').trim();
        if (ps.length > 0 && ps === ms) {
          out[out.length - 1] = prev.segmentId && !m.segmentId
            ? { ...m, segmentId: prev.segmentId }
            : m;
          continue;
        }
      }
      if (
        m.kind === 'text'
        && prev.kind === 'text'
        && m.role === 'assistant'
        && prev.role === 'assistant'
      ) {
        const ms = (m.content || '').trim();
        if (ms.length > 0 && ms === (prev.content || '').trim()) {
          continue;
        }
      }
      if (prev.kind === 'thinking' && m.kind === 'thinking') {
        const ms = (m.content || '').trim();
        if (ms.length > 0 && ms === (prev.content || '').trim()) {
          continue;
        }
      }
    }
    out.push(m);
  }
  return out;
}

/**
 * After a server refresh, drop only the realtime rows the persisted transcript
 * already owns. Anything not yet on disk (common right after `complete`, while
 * JSONL indexing lags) stays in `realtimeMessages` so the chat pane never
 * flashes the empty "Continue your conversation" state.
 */
function pruneRealtimeSupersededByServer(
  serverMessages: NormalizedMessage[],
  realtimeMessages: NormalizedMessage[],
): NormalizedMessage[] {
  if (realtimeMessages.length === 0) {
    return realtimeMessages;
  }

  const serverIds = new Set(serverMessages.map((message) => message.id));
  const reconciledRealtimeMessages = removeOptimisticUserEchoes(serverMessages, realtimeMessages);

  return reconciledRealtimeMessages.filter((message) => {
    if (serverIds.has(message.id)) {
      return false;
    }

    // A live reasoning row is superseded by the persisted `thinking` row the
    // same way a reply is; without this it survives every refresh and doubles.
    const isThinkingRow = message.kind === 'thinking'
      || (message.kind === 'stream_delta' && message.streamChannel === 'thinking');
    if (isThinkingRow) {
      return !isThinkingEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages);
    }

    if (message.kind === 'stream_delta' || message.id === `__streaming_${message.sessionId}`) {
      if (isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'assistant') {
      if (isAssistantTextEchoedInSameTurnOnServer(message, serverMessages, realtimeMessages)) {
        return false;
      }
      return true;
    }

    if (message.kind === 'text' && message.role === 'user') {
      return true;
    }

    if (message.kind === 'tool_use' && message.toolId) {
      if (serverMessages.some((serverMessage) => serverMessage.kind === 'tool_use' && serverMessage.toolId === message.toolId)) {
        return false;
      }
    }

    return true;
  });
}

function computeMerged(server: NormalizedMessage[], realtime: NormalizedMessage[]): NormalizedMessage[] {
  if (realtime.length === 0) {
    return dedupeAdjacentAssistantEchoes(server);
  }
  if (server.length === 0) {
    return dedupeAdjacentAssistantEchoes(realtime);
  }

  const serverIds = new Set(server.map((message) => message.id));
  const reconciledRealtime = removeOptimisticUserEchoes(server, realtime);
  const extra = reconciledRealtime.filter((message) => {
    if (serverIds.has(message.id)) {
      return false;
    }
    return true;
  });

  if (extra.length === 0) {
    return dedupeAdjacentAssistantEchoes(server);
  }

  // Interleave by timestamp so live rows stay with their turn instead of
  // piling up at the bottom after every refresh. Sorting is stable and the
  // live rows come second, so a replacement that ties with the newest server
  // row still lands after it.
  const newestServerTime = server.reduce(
    (newest, message) => Math.max(newest, readMessageTime(message) ?? 0),
    0,
  );
  return dedupeAdjacentAssistantEchoes(
    [...server, ...extra].sort(
      (a, b) => readSortTime(a, newestServerTime) - readSortTime(b, newestServerTime),
    ),
  );
}

/**
 * Recompute slot.merged only when the input arrays have actually changed
 * (by reference). Returns true if merged was recomputed.
 */
function recomputeMergedIfNeeded(slot: SessionSlot): boolean {
  if (slot.serverMessages === slot._lastServerRef && slot.realtimeMessages === slot._lastRealtimeRef) {
    return false;
  }
  slot._lastServerRef = slot.serverMessages;
  slot._lastRealtimeRef = slot.realtimeMessages;
  slot.merged = computeMerged(slot.serverMessages, slot.realtimeMessages);
  return true;
}

type LatestHistoryRefreshResult = {
  applied: boolean;
  changed: boolean;
  deferred: boolean;
};

type CanRequestHistory = () => boolean;

// Token usage is JSON response data, so compare its serialized value instead
// of treating each freshly parsed response object as a state change.
function hasEquivalentTokenUsage(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Fetches and atomically applies a bounded persisted-tail reconciliation.
 * Every request is finite. Claude/Codex bridge discovery may use more than one
 * bounded chunk because their response `total` omits paginated tool results.
 */
async function refreshLatestSlotFromServer(
  sessionId: string,
  slot: SessionSlot,
  limit: number,
  canRequest: CanRequestHistory = () => true,
): Promise<LatestHistoryRefreshResult> {
  if (!canRequest()) {
    return { applied: false, changed: false, deferred: true };
  }

  const previousServerMessages = slot.serverMessages;
  const previousTotal = slot.total;
  const previousHasMore = slot.hasMore;
  const latestPage = await requestSessionHistoryPage(sessionId, {
    limit,
    offset: 0,
  });

  let nextServerMessages: NormalizedMessage[] | null = null;
  let nextHasMore = previousHasMore;

  // A page with no older rows is the complete authoritative transcript. This
  // also removes cached rows after a provider-side truncation.
  if (!latestPage.hasMore) {
    nextServerMessages = latestPage.messages;
    nextHasMore = false;
  } else if (previousServerMessages.length === 0) {
    nextServerMessages = latestPage.messages;
    nextHasMore = true;
  } else {
    let fetchedWindow = latestPage.messages;
    let oldestFetchedPage = latestPage;
    let bridgeRowsFetched = 0;
    let reachedStartOfHistory = false;
    let mergedPage = mergeLatestServerPage(previousServerMessages, fetchedWindow);

    while (
      mergedPage.overlapLength === 0
      && !hasReachedCachedTailTimeBoundary(previousServerMessages, fetchedWindow)
    ) {
      const bridgeRequest = planLatestPageBridge(
        previousServerMessages,
        latestPage.messages,
        previousTotal,
        latestPage.total,
        bridgeRowsFetched,
      );
      if (!bridgeRequest) break;
      if (!canRequest()) {
        return { applied: false, changed: false, deferred: true };
      }

      const bridgePage = await requestSessionHistoryPage(sessionId, bridgeRequest);
      if (bridgePage.total !== latestPage.total) {
        console.warn(`[SessionStore] History changed while bridging ${sessionId}; retaining cached suffix.`);
        return { applied: false, changed: false, deferred: false };
      }
      if (bridgePage.messages.length === 0) break;

      const bridgeMerge = mergeOlderServerPage(fetchedWindow, bridgePage.messages);
      if (
        bridgeMerge.overlapLength > 0
        || !olderPagePrecedesCachedHistory(bridgePage.messages, fetchedWindow)
      ) {
        console.warn(`[SessionStore] History shifted while bridging ${sessionId}; retaining cached suffix.`);
        return { applied: false, changed: false, deferred: false };
      }

      fetchedWindow = bridgeMerge.messages;
      oldestFetchedPage = bridgePage;
      bridgeRowsFetched += bridgePage.messages.length;
      mergedPage = mergeLatestServerPage(previousServerMessages, fetchedWindow);

      if (!bridgePage.hasMore) {
        reachedStartOfHistory = true;
        break;
      }
    }

    if (reachedStartOfHistory) {
      nextServerMessages = fetchedWindow;
      nextHasMore = false;
    } else if (mergedPage.overlapLength > 0) {
      nextServerMessages = mergedPage.messages;
      nextHasMore = resolveLatestPagePagination(
        previousServerMessages.length,
        nextServerMessages.length,
        previousHasMore,
        oldestFetchedPage.hasMore,
      ).hasMore;
    }
  }

  let changed = false;
  if (
    latestPage.tokenUsage !== undefined
    && !hasEquivalentTokenUsage(latestPage.tokenUsage, slot.tokenUsage)
  ) {
    slot.tokenUsage = latestPage.tokenUsage;
    changed = true;
  }

  if (!nextServerMessages) {
    console.warn(`[SessionStore] Could not bridge latest history for ${sessionId}; retaining cached suffix.`);
    return { applied: false, changed, deferred: false };
  }

  slot.serverMessages = carrySegmentIdentitiesIntoServerMessages(
    nextServerMessages,
    previousServerMessages,
    slot.realtimeMessages,
  );
  slot.total = latestPage.total;
  slot.offset = nextServerMessages.length;
  slot.hasMore = nextHasMore;
  slot.fetchedAt = Date.now();
  slot.realtimeMessages = pruneRealtimeSupersededByServer(
    slot.serverMessages,
    slot.realtimeMessages,
  );
  recomputeMergedIfNeeded(slot);

  return { applied: true, changed: true, deferred: false };
}

// ─── Stale threshold ─────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30_000;

const MAX_REALTIME_MESSAGES = 500;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSessionStore() {
  const storeRef = useRef(new Map<string, SessionSlot>());
  // Allocates a new stable projected identity for each streaming cycle in a channel.
  const streamingSegmentSequenceRef = useRef(new Map<string, number>());
  const activeSessionIdRef = useRef<string | null>(null);
  // Bump to force re-render — only when the active session's data changes.
  // Session ids are stable for the whole conversation lifetime (the backend
  // allocates them before the first send), so slots are keyed directly with
  // no alias/redirect indirection.
  const [, setTick] = useState(0);
  const notify = useCallback((sessionId: string) => {
    if (sessionId === activeSessionIdRef.current) {
      setTick(n => n + 1);
    }
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId;
  }, []);

  const getSlot = useCallback((sessionId: string): SessionSlot => {
    const store = storeRef.current;
    if (!store.has(sessionId)) {
      store.set(sessionId, createEmptySlot());
    }
    return store.get(sessionId)!;
  }, []);

  /**
   * Fetch messages from the provider sessions endpoint and populate serverMessages.
   *
   * Provider and project metadata are resolved server-side from `sessionId`.
   * The endpoint returns the standard `{ success, data }` envelope.
   */
  const fetchFromServer = useCallback(async (
    sessionId: string,
    opts: SessionMessagesRequestOptions & {
      canRequest?: CanRequestHistory;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    slot.status = 'loading';
    notify(sessionId);

    return enqueueHistoryMutation(slot, async () => {
      const { canRequest = () => true, ...requestOptions } = opts;
      if (!canRequest()) {
        slot.status = 'idle';
        notify(sessionId);
        return null;
      }

      try {
        const data = await requestSessionHistoryPage(sessionId, requestOptions);
        slot.serverMessages = carrySegmentIdentitiesIntoServerMessages(
          data.messages,
          slot.serverMessages,
          slot.realtimeMessages,
        );
        slot.total = data.total;
        slot.hasMore = data.hasMore;
        slot.offset = (requestOptions.offset ?? 0) + data.messages.length;
        slot.turnPageInfo = requestOptions.pageMode === 'turns' && data.pageInfo
          ? data.pageInfo
          : null;
        slot.turnPageByteBudget = slot.turnPageInfo ? requestOptions.byteBudget : undefined;
        slot.fetchedAt = Date.now();
        slot.status = 'idle';
        slot.realtimeMessages = pruneRealtimeSupersededByServer(
          slot.serverMessages,
          slot.realtimeMessages,
        );
        recomputeMergedIfNeeded(slot);
        if (data.tokenUsage !== undefined) {
          slot.tokenUsage = data.tokenUsage;
        }

        notify(sessionId);
        return slot;
      } catch (error) {
        console.error(`[SessionStore] fetch failed for ${sessionId}:`, error);
        slot.status = 'error';
        notify(sessionId);
        return slot;
      }
    });
  }, [getSlot, notify]);

  /**
   * Load older (paginated) messages and prepend to serverMessages.
   */
  const fetchMore = useCallback(async (
    sessionId: string,
    opts: {
      limit?: number;
      canRequest?: CanRequestHistory;
    } = {},
  ) => {
    const slot = getSlot(sessionId);
    return enqueueHistoryMutation(slot, async () => {
      let prependedCount = 0;
      let changed = false;
      const canRequest = opts.canRequest ?? (() => true);
      if (!slot.hasMore || !canRequest()) return { slot, prependedCount };

      try {
        if (slot.turnPageInfo) {
          const cursor = slot.turnPageInfo.nextCursor;
          const newerCursor = slot.turnPageInfo.newerCursor;
          if (!cursor) {
            slot.hasMore = false;
            return { slot, prependedCount };
          }
          const turnRequestOptions: SessionMessagesRequestOptions = {
            pageMode: 'turns',
            ...(slot.turnPageByteBudget === undefined
              ? {}
              : { byteBudget: slot.turnPageByteBudget }),
          };
          let data: SessionHistoryPage;
          try {
            data = await requestSessionHistoryPage(sessionId, {
              ...turnRequestOptions,
              cursor,
            });
          } catch (error) {
            if (!(error instanceof SessionHistoryRequestError) || error.code !== 'STALE_HISTORY_CURSOR') {
              throw error;
            }
            const fresh = await requestSessionHistoryPage(sessionId, turnRequestOptions);
            slot.serverMessages = carrySegmentIdentitiesIntoServerMessages(
              fresh.messages,
              slot.serverMessages,
              slot.realtimeMessages,
            );
            slot.turnPageInfo = fresh.pageInfo ?? null;
            slot.hasMore = fresh.hasMore && Boolean(fresh.pageInfo?.nextCursor);
            slot.total = fresh.total;
            slot.offset = fresh.messages.length;
            slot.fetchedAt = Date.now();
            slot.realtimeMessages = pruneRealtimeSupersededByServer(
              slot.serverMessages,
              slot.realtimeMessages,
            );
            if (fresh.tokenUsage !== undefined) {
              slot.tokenUsage = fresh.tokenUsage;
            }
            recomputeMergedIfNeeded(slot);
            notify(sessionId);
            return { slot, prependedCount };
          }
          const olderMerge = mergeOlderServerPage(slot.serverMessages, data.messages);
          slot.serverMessages = olderMerge.messages;
          slot.turnPageInfo = data.pageInfo
            ? { ...data.pageInfo, newerCursor }
            : null;
          slot.hasMore = data.hasMore && Boolean(data.pageInfo?.nextCursor);
          slot.total = Math.max(slot.total, data.total);
          slot.offset = slot.serverMessages.length;
          prependedCount = olderMerge.prependedCount;
          if (data.tokenUsage !== undefined) {
            slot.tokenUsage = data.tokenUsage;
          }
          recomputeMergedIfNeeded(slot);
          notify(sessionId);
          return { slot, prependedCount };
        }

        // A tail-relative offset can shift while JSONL is still growing. One
        // bounded latest-page reconciliation realigns the cache, after which
        // the older-page request is retried once with the new raw-row offset.
        for (let attempt = 0; attempt < 2 && slot.hasMore; attempt++) {
          if (!canRequest()) break;

          const cachedMessages = slot.serverMessages;
          const data = await requestSessionHistoryPage(sessionId, {
            limit: opts.limit ?? SESSION_MESSAGES_PAGE_SIZE,
            offset: slot.offset,
          });
          const olderMerge = mergeOlderServerPage(cachedMessages, data.messages);
          // A smaller `total` than the rows we already hold means the transcript
          // was truncated (e.g. a Claude/Codex rewind). In that case we refresh
          // the latest tail before continuing. Live WorkBuddy growth increases
          // `total`; as long as the fetched page is older than the cached suffix
          // it can be prepended without a full realignment.
          const shiftedWhileFetching = data.total < cachedMessages.length
            || isOlderPageShifted(cachedMessages, data.messages);

          if (shiftedWhileFetching) {
            if (attempt > 0 || !canRequest()) break;
            const latestResult = await refreshLatestSlotFromServer(
              sessionId,
              slot,
              SESSION_MESSAGES_PAGE_SIZE,
              canRequest,
            );
            changed = changed || latestResult.changed;
            if (!latestResult.applied) break;
            continue;
          }

          slot.serverMessages = olderMerge.messages;
          slot.hasMore = data.hasMore;
          slot.total = data.total;
          slot.offset = slot.serverMessages.length;
          prependedCount = olderMerge.prependedCount;
          if (data.tokenUsage !== undefined) {
            slot.tokenUsage = data.tokenUsage;
          }
          recomputeMergedIfNeeded(slot);
          changed = true;
          break;
        }

        if (changed) notify(sessionId);
        return { slot, prependedCount };
      } catch (error) {
        console.error(`[SessionStore] fetchMore failed for ${sessionId}:`, error);
        if (changed) notify(sessionId);
        return { slot, prependedCount };
      }
    });
  }, [getSlot, notify]);

  /** Appends the next bounded Turn page when a search seek opened a middle history window. */
  const fetchNewer = useCallback(async (
    sessionId: string,
    opts: { canRequest?: CanRequestHistory } = {},
  ) => {
    const slot = getSlot(sessionId);
    return enqueueHistoryMutation(slot, async () => {
      const cursor = slot.turnPageInfo?.newerCursor;
      const canRequest = opts.canRequest ?? (() => true);
      if (!cursor || !canRequest()) return { slot, appendedCount: 0 };

      const turnRequestOptions: SessionMessagesRequestOptions = {
        pageMode: 'turns',
        ...(slot.turnPageByteBudget === undefined
          ? {}
          : { byteBudget: slot.turnPageByteBudget }),
      };
      try {
        const data = await requestSessionHistoryPage(sessionId, {
          ...turnRequestOptions,
          cursor,
        });
        const overlapLength = findLatestPageOverlapLength(slot.serverMessages, data.messages);
        const appendedMessages = data.messages.slice(overlapLength);
        const olderCursor = slot.turnPageInfo?.nextCursor ?? null;
        slot.serverMessages = [...slot.serverMessages, ...appendedMessages];
        slot.turnPageInfo = data.pageInfo
          ? { ...data.pageInfo, nextCursor: olderCursor }
          : null;
        slot.hasMore = Boolean(olderCursor);
        slot.total = Math.max(slot.total, data.total);
        slot.offset = slot.serverMessages.length;
        slot.fetchedAt = Date.now();
        if (data.tokenUsage !== undefined) slot.tokenUsage = data.tokenUsage;
        recomputeMergedIfNeeded(slot);
        notify(sessionId);
        return { slot, appendedCount: appendedMessages.length };
      } catch (error) {
        if (error instanceof SessionHistoryRequestError && error.code === 'STALE_HISTORY_CURSOR') {
          const fresh = await requestSessionHistoryPage(sessionId, turnRequestOptions);
          slot.serverMessages = carrySegmentIdentitiesIntoServerMessages(
            fresh.messages,
            slot.serverMessages,
            slot.realtimeMessages,
          );
          slot.turnPageInfo = fresh.pageInfo ?? null;
          slot.hasMore = fresh.hasMore && Boolean(fresh.pageInfo?.nextCursor);
          slot.total = fresh.total;
          slot.offset = fresh.messages.length;
          slot.fetchedAt = Date.now();
          slot.realtimeMessages = pruneRealtimeSupersededByServer(
            slot.serverMessages,
            slot.realtimeMessages,
          );
          if (fresh.tokenUsage !== undefined) slot.tokenUsage = fresh.tokenUsage;
          recomputeMergedIfNeeded(slot);
          notify(sessionId);
          return { slot, appendedCount: 0 };
        }
        console.error(`[SessionStore] newer-page fetch failed for ${sessionId}:`, error);
        return { slot, appendedCount: 0 };
      }
    });
  }, [getSlot, notify]);

  /**
   * Append a realtime (WebSocket) message to the correct session slot.
   * This works regardless of which session is actively viewed.
   */
  /**
   * Drops the message carrying `anchorId` and everything after it.
   *
   * Sent when an already-sent message is edited: the replacement streams in
   * from the provider, so the rows it supersedes have to go first or the
   * transcript shows the question twice. Runs on every subscribed client, not
   * just the one that made the edit.
   */
  const truncateAt = useCallback((sessionId: string, anchorId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return;

    const cutIndex = slot.serverMessages.findIndex(
      (message) => message.transcriptAnchorId === anchorId,
    );
    if (cutIndex < 0) return;

    slot.serverMessages = slot.serverMessages.slice(0, cutIndex);
    // Anything already streamed belonged to the turn being replaced — except
    // the replacement itself. The client that made the edit appends its
    // optimistic echo before the server acknowledges, so clearing live rows
    // outright took the message the user had just sent with it, and it only
    // came back when the run finished and the transcript was re-read.
    // Only the last one: a send that was refused leaves its echo behind, so a
    // second attempt at the same message would otherwise survive the cut
    // alongside the abandoned first and show the user both.
    const replacements = slot.realtimeMessages.filter(
      (message) => message.replacesAnchorId === anchorId,
    );
    slot.realtimeMessages = replacements.length > 0
      // Stamped here because this is the only place that knows how much of the
      // conversation survived, which is what tells the echo apart from the
      // turns it now sits after.
      ? [{ ...replacements[replacements.length - 1], replacesAfterRowCount: cutIndex }]
      : EMPTY;
    // `total` counts what the server would serve; it is about to be re-fetched
    // anyway, but leaving it high makes the pager offer pages that do not exist.
    slot.total = slot.serverMessages.length;
    slot.offset = slot.serverMessages.length;
    slot.turnPageInfo = null;
    slot.turnPageByteBudget = undefined;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [notify]);

  const appendRealtime = useCallback((sessionId: string, msg: NormalizedMessage) => {
    const slot = getSlot(sessionId);
    const normalizedMessage =
      msg.sessionId === sessionId
        ? msg
        : { ...msg, sessionId };
    // Upsert by id/toolId rather than always appending: a tool item's lifecycle
    // updates reuse its tool id, so each update replaces the row instead of
    // stacking a duplicate run of the same tool in the live transcript.
    let updated = upsertRealtimeMessages(slot.realtimeMessages, [normalizedMessage]);
    if (updated.length > MAX_REALTIME_MESSAGES) {
      updated = updated.slice(-MAX_REALTIME_MESSAGES);
    }
    slot.realtimeMessages = updated;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /**
   * Refreshes only the persisted tail and stitches it onto the contiguous
   * cached suffix. Large turns request a small offset bridge rather than the
   * whole transcript, and the final state is applied atomically.
   */
  const refreshLatestFromServer = useCallback(async (
    sessionId: string,
    opts: {
      limit?: number;
      canRequest?: CanRequestHistory;
    } = {},
  ) => {
    const slot = getSlot(sessionId);

    return enqueueHistoryMutation(slot, async () => {
      try {
        const result = await refreshLatestSlotFromServer(
          sessionId,
          slot,
          opts.limit ?? SESSION_MESSAGES_PAGE_SIZE,
          opts.canRequest,
        );
        if (result.changed) notify(sessionId);
        return { slot, ...result };
      } catch (error) {
        console.error(`[SessionStore] latest refresh failed for ${sessionId}:`, error);
        return { slot, applied: false, changed: false, deferred: false };
      }
    });
  }, [getSlot, notify]);

  /**
   * Check if a session's data is stale (>30s old).
   */
  const isStale = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return true;
    return Date.now() - slot.fetchedAt > STALE_THRESHOLD_MS;
  }, []);

  /** Atomically update every dirty streaming channel with one merge and notify. */
  const updateStreamingBatch = useCallback((
    sessionId: string,
    updates: StreamingChannelUpdate[],
    msgProvider: LLMProvider,
  ) => {
    if (updates.length === 0) return;

    const slot = getSlot(sessionId);
    const next = [...slot.realtimeMessages];
    for (const update of updates) {
      const streamId = update.channel === 'thinking'
        ? `__streaming_thinking_${sessionId}`
        : `__streaming_${sessionId}`;
      const idx = next.findIndex(message => message.id === streamId);
      const sequenceKey = `${sessionId}:${update.channel}`;
      let segmentId = idx >= 0 ? next[idx].segmentId : undefined;
      if (!segmentId) {
        const sequence = (streamingSegmentSequenceRef.current.get(sequenceKey) ?? 0) + 1;
        streamingSegmentSequenceRef.current.set(sequenceKey, sequence);
        segmentId = `stream-segment:${sequenceKey}:${sequence}`;
      }
      const msg: NormalizedMessage = {
        id: streamId,
        segmentId,
        sessionId,
        // Each row freezes its own first timestamp. Existing rows stay in
        // place; new rows append in batch order even when timestamps match.
        timestamp: idx >= 0 ? next[idx].timestamp : new Date().toISOString(),
        provider: msgProvider,
        kind: 'stream_delta',
        streamChannel: update.channel,
        content: update.text,
      };
      if (idx >= 0) {
        next[idx] = msg;
      } else {
        next.push(msg);
      }
    }

    slot.realtimeMessages = next;
    recomputeMergedIfNeeded(slot);
    notify(sessionId);
  }, [getSlot, notify]);

  /** Backward-compatible single-channel wrapper used by existing store consumers. */
  const updateStreaming = useCallback((
    sessionId: string,
    accumulatedText: string,
    msgProvider: LLMProvider,
    channel: StreamChannel = 'text',
  ) => {
    updateStreamingBatch(sessionId, [{ channel, text: accumulatedText }], msgProvider);
  }, [updateStreamingBatch]);

  /**
   * Finalize streaming: convert each channel's placeholder to a regular row.
   * The reply becomes an assistant `text` row; the reasoning trace becomes a
   * `thinking` row, matching how history normalization represents it. The
   * well-known ids are replaced with unique ids.
   */
  const finalizeStreaming = useCallback((sessionId: string) => {
    const slot = storeRef.current.get(sessionId);
    if (!slot) return;

    const targets: Array<{ streamId: string; finalKind: 'text' | 'thinking' }> = [
      { streamId: `__streaming_${sessionId}`, finalKind: 'text' },
      { streamId: `__streaming_thinking_${sessionId}`, finalKind: 'thinking' },
    ];

    let next = slot.realtimeMessages;
    let changed = false;
    for (const { streamId, finalKind } of targets) {
      const idx = next.findIndex(m => m.id === streamId);
      if (idx < 0) continue;
      if (!changed) {
        next = [...next];
        changed = true;
      }
      const stream = next[idx];
      next[idx] = {
        ...stream,
        id: `${finalKind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: finalKind,
        streamChannel: undefined,
        role: finalKind === 'text' ? 'assistant' : undefined,
      };
    }

    if (changed) {
      slot.realtimeMessages = next;
      recomputeMergedIfNeeded(slot);
      notify(sessionId);
    }
  }, [notify]);

  /**
   * Get merged messages for a session (for rendering).
   */
  const getMessages = useCallback((sessionId: string): NormalizedMessage[] => {
    return storeRef.current.get(sessionId)?.merged ?? EMPTY;
  }, []);

  /**
   * Get session slot (for status, pagination info, etc.).
   */
  const getSessionSlot = useCallback((sessionId: string): SessionSlot | undefined => {
    return storeRef.current.get(sessionId);
  }, []);

  return useMemo(() => ({
    fetchFromServer,
    fetchMore,
    fetchNewer,
    appendRealtime,
    truncateAt,
    refreshLatestFromServer,
    setActiveSession,
    isStale,
    updateStreamingBatch,
    updateStreaming,
    finalizeStreaming,
    getMessages,
    getSessionSlot,
  }), [
    fetchFromServer, fetchMore, fetchNewer, appendRealtime, truncateAt, refreshLatestFromServer,
    setActiveSession, isStale, updateStreamingBatch, updateStreaming, finalizeStreaming,
    getMessages, getSessionSlot,
  ]);
}

/** Full store API returned by useSessionStore; chat hooks take it as a parameter. */
export type SessionStore = ReturnType<typeof useSessionStore>;
