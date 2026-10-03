import type {
  LLMProvider,
  StreamChannel,
  StreamingChannelUpdate,
} from '@/shared/types';

const REVEAL_TICK_MS = 32;
const REVEAL_MAX_DURATION_MS = 300;
const SHORT_SEGMENT_CHARS = 80;
const BACKGROUND_PUBLISH_INTERVAL_MS = 200;

const CHANNEL_ORDER: StreamChannel[] = ['thinking', 'text'];

/**
 * Providers whose prose reaches the client as complete segments instead of
 * token deltas: `codex exec` reports an assistant message once, on
 * `item.completed`, and the DSH ACP bridge only emits committed
 * `assistant/message` blocks. Everything else keeps its real-time delta path.
 */
export const WHOLE_SEGMENT_PROVIDERS: ReadonlySet<LLMProvider> = new Set<LLMProvider>(['codex', 'dsh']);

type PacedSegment = {
  text: string;
  groupKey: string | undefined;
};

type ChannelReveal = {
  /** Fully revealed earlier segments — the streaming row's frozen prefix. */
  settled: string;
  /** Authoritative text of the current segment (grows with same-key updates). */
  full: string;
  /** Characters of `full` revealed so far. */
  publishedInFull: number;
  groupKey: string | undefined;
  /** Wall-clock start of the current reveal wave. */
  waveStartedAt: number;
  /** Segments waiting for the current wave to finish. */
  pending: PacedSegment[];
  /** Last snapshot handed to the store, so ticks only publish dirty channels. */
  lastSnapshot: string;
};

type PacedSession = {
  provider: LLMProvider;
  channels: Map<StreamChannel, ChannelReveal>;
  tickTimer: number | null;
  bgTimer: number | null;
};

export type RevealPacer = {
  /** Records one authoritative whole segment (or an accumulated snapshot of it). */
  append: (
    sessionId: string,
    text: string,
    provider: LLMProvider,
    channel?: StreamChannel,
    groupKey?: string,
  ) => void;
  /** Publishes every unpublished character synchronously, without dropping state. */
  flushNow: (sessionId: string) => void;
  /** Cancels pending work and discards one session's reveal state. */
  drop: (sessionId: string) => void;
  /** Cancels pending work and discards all sessions' reveal state. */
  dropAll: () => void;
  /** Whether the session currently holds reveal state. */
  has: (sessionId: string) => boolean;
};

/**
 * Session-keyed reveal pacer for whole-segment providers. `ChatInterface`
 * creates it alongside `streamingBufferRegistry` and hands it to
 * `useChatRealtimeHandlers`, which routes whole-segment prose here and seals
 * it with the same flush → finalize → drop trio the registry gets.
 *
 * Pacing contract (streaming plan §11.6): the first tick waits 32ms so a
 * terminal frame arriving within the grace window converges without playback;
 * afterwards each 32ms tick publishes the wall-clock share of a 300ms budget,
 * so a throttled timer catches up instead of stalling. Segments shorter than
 * 80 characters publish in full immediately. Snapshots are always prefixes of
 * real text — the pacer never invents characters and never rewinds.
 */
export function createRevealPacer(
  publish: (
    sessionId: string,
    updates: StreamingChannelUpdate[],
    provider: LLMProvider,
  ) => void,
  isSessionVisible: (sessionId: string) => boolean = () => true,
): RevealPacer {
  const sessions = new Map<string, PacedSession>();

  const cancelTimers = (state: PacedSession): void => {
    if (state.tickTimer !== null) {
      window.clearTimeout(state.tickTimer);
      state.tickTimer = null;
    }
    if (state.bgTimer !== null) {
      window.clearTimeout(state.bgTimer);
      state.bgTimer = null;
    }
  };

  const snapshotOf = (ch: ChannelReveal): string => {
    return ch.settled + ch.full.slice(0, ch.publishedInFull);
  };

  const publishDirty = (sessionId: string, state: PacedSession): void => {
    const updates: StreamingChannelUpdate[] = [];
    for (const channel of CHANNEL_ORDER) {
      const ch = state.channels.get(channel);
      if (!ch) continue;
      const snapshot = snapshotOf(ch);
      if (snapshot !== ch.lastSnapshot) {
        updates.push({ channel, text: snapshot });
      }
    }
    if (updates.length === 0) {
      return;
    }
    publish(sessionId, updates, state.provider);
    for (const channel of CHANNEL_ORDER) {
      const ch = state.channels.get(channel);
      if (ch) ch.lastSnapshot = snapshotOf(ch);
    }
  };

  const tick = (sessionId: string): void => {
    const state = sessions.get(sessionId);
    if (!state) return;
    state.tickTimer = null;
    const now = Date.now();

    for (const ch of state.channels.values()) {
      // Advance the current wave by its wall-clock share of the budget, so a
      // throttled timer catches up instead of stretching the reveal.
      if (ch.full.length > ch.publishedInFull) {
        const elapsed = now - ch.waveStartedAt;
        const target = elapsed >= REVEAL_MAX_DURATION_MS
          ? ch.full.length
          : Math.floor((ch.full.length * elapsed) / REVEAL_MAX_DURATION_MS);
        ch.publishedInFull = Math.min(
          ch.full.length,
          Math.max(ch.publishedInFull + 1, target),
        );
      }
      // A finished wave hands the row to the next queued segment: the row
      // content only ever grows (append-only), so same-channel segments
      // serialize without clobbering each other.
      while (ch.publishedInFull >= ch.full.length && ch.pending.length > 0) {
        const next = ch.pending.shift() as PacedSegment;
        ch.settled += ch.full;
        ch.full = next.text;
        ch.groupKey = next.groupKey;
        ch.publishedInFull = next.text.length <= SHORT_SEGMENT_CHARS ? next.text.length : 0;
        ch.waveStartedAt = Date.now();
      }
    }

    publishDirty(sessionId, state);

    const remains = [...state.channels.values()].some(
      ch => ch.full.length > ch.publishedInFull || ch.pending.length > 0,
    );
    if (remains) {
      state.tickTimer = window.setTimeout(() => tick(sessionId), REVEAL_TICK_MS);
    }
  };

  /** Publishes everything still unpublished and empties the wave state. */
  const collapseAndPublish = (sessionId: string): void => {
    const state = sessions.get(sessionId);
    if (!state) return;
    for (const ch of state.channels.values()) {
      const collapsed = ch.settled + ch.full + ch.pending.map(seg => seg.text).join('');
      ch.settled = collapsed;
      ch.full = '';
      ch.pending = [];
      ch.publishedInFull = 0;
      ch.groupKey = undefined;
    }
    publishDirty(sessionId, state);
  };

  const append = (
    sessionId: string,
    text: string,
    provider: LLMProvider,
    channel: StreamChannel = 'text',
    groupKey?: string,
  ): void => {
    if (!sessionId || !text) {
      return;
    }

    let state = sessions.get(sessionId);
    if (!state) {
      state = { provider, channels: new Map(), tickTimer: null, bgTimer: null };
      sessions.set(sessionId, state);
    }
    const session = state;
    session.provider = provider;

    let ch = state.channels.get(channel);
    if (!ch) {
      ch = {
        settled: '',
        full: '',
        publishedInFull: 0,
        groupKey: undefined,
        waveStartedAt: 0,
        pending: [],
        lastSnapshot: '',
      };
      state.channels.set(channel, ch);
    }

    if (groupKey !== undefined && ch.groupKey === groupKey && (ch.full.length > 0 || ch.publishedInFull > 0)) {
      // Accumulated snapshot for the segment in flight: replace the authority.
      // Published characters are a prefix of it, so the reveal never rewinds.
      if (text.length >= ch.publishedInFull) {
        ch.full = text;
      }
    } else if (ch.full.length > ch.publishedInFull) {
      // The previous segment is still revealing — queue this one behind it.
      ch.pending.push({ text, groupKey });
    } else {
      // Idle: fold the finished segment into the frozen prefix, start fresh.
      ch.settled += ch.full;
      ch.full = text;
      ch.groupKey = groupKey;
      ch.publishedInFull = 0;
      ch.waveStartedAt = Date.now();
      if (text.length <= SHORT_SEGMENT_CHARS) {
        ch.publishedInFull = text.length;
      }
    }

    if (isSessionVisible(sessionId)) {
      // A short segment (or an already-finished one) may be fully published
      // right now; flush any dirty snapshot synchronously before scheduling.
      publishDirty(sessionId, session);
      const remains = ch.full.length > ch.publishedInFull || ch.pending.length > 0;
      if (remains && session.tickTimer === null) {
        session.tickTimer = window.setTimeout(() => tick(sessionId), REVEAL_TICK_MS);
      }
    } else if (session.bgTimer === null) {
      session.bgTimer = window.setTimeout(() => {
        session.bgTimer = null;
        collapseAndPublish(sessionId);
      }, BACKGROUND_PUBLISH_INTERVAL_MS);
    }
  };

  const flushNow = (sessionId: string): void => {
    const state = sessions.get(sessionId);
    if (!state) {
      return;
    }
    cancelTimers(state);
    collapseAndPublish(sessionId);
  };

  const drop = (sessionId: string): void => {
    const state = sessions.get(sessionId);
    if (!state) {
      return;
    }
    cancelTimers(state);
    sessions.delete(sessionId);
  };

  const dropAll = (): void => {
    sessions.forEach(cancelTimers);
    sessions.clear();
  };

  const has = (sessionId: string): boolean => sessions.has(sessionId);

  return { append, flushNow, drop, dropAll, has };
}
