import type { LLMProvider, NormalizedMessage } from '@/shared/types';
import type { BtwAnchorInfo, BtwAnchorRequest } from '@/modules/chat/hooks/useBtwSession';

/**
 * The one side-question drawer a tab can hold, written to `sessionStorage` so a
 * reload lands back on it.
 *
 * `sessionStorage` rather than `localStorage` on purpose: the copy is a hidden
 * session owned by this tab, and a snapshot that outlived the tab would let a
 * drawer reappear days later in a tab that never opened it (see the plan §7.1).
 */

export const BTW_SNAPSHOT_STORAGE_KEY = 'cloudcli.btw.restore.v1';

/** Storage budget, not a data cap: the origin has ~5 MB and the rest is in use. */
export const BTW_SNAPSHOT_BUDGET_CHARS = 512 * 1024;

/** Older copies are either reclaimed by the sweep or not worth resurrecting. */
export const BTW_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type BtwSnapshot = {
  v: 1;
  /**
   * The source conversation the copy was forked from, frozen at fork time —
   * not the conversation selected now. Restoring is only right in a tab that
   * still has that conversation open.
   */
  forkSourceSessionId: string;
  sessionId: string;
  /** Highest `seq` seen before the reload; the subscription resumes from here. */
  lastSeq: number;
  /** The cut point the copy was forked at, so `refork` can reuse it. */
  anchor: BtwAnchorRequest;
  anchorInfo: BtwAnchorInfo | null;
  minimized: boolean;
  /**
   * Rows as rendered at write time, **including** the `stream_delta`
   * placeholder: it carries the prose of a turn that was still generating, and
   * it is what seeds the streaming buffer on the way back in.
   */
  messages: NormalizedMessage[];
  savedAt: number;
  /**
   * Set when the budget forced turns out of the snapshot, so the restored
   * drawer can say that it starts partway through the branch instead of
   * silently looking like the whole conversation.
   */
  truncated: boolean;
};

export type BtwSnapshotInput = Omit<BtwSnapshot, 'v' | 'savedAt' | 'messages' | 'truncated'> & {
  messages: NormalizedMessage[];
  /** Carried over from an earlier save in the same tab; see `writeBtwSnapshot`. */
  truncated?: boolean;
};

/** UTF-16 code units, the same unit the storage budget is quoted in. */
function measure(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    // A cycle (a tool payload pointing back at itself) cannot be stored at
    // all; reporting "enormous" makes the caller trim rather than throw.
    return Number.POSITIVE_INFINITY;
  }
}

const isUserTextRow = (message: NormalizedMessage): boolean =>
  message.kind === 'text' && message.role === 'user';

/**
 * Indexes where a turn may start. Row 0 always qualifies: a transcript whose
 * first user row scrolled out of the live window must still be trimmable
 * instead of being kept whole or dropped whole.
 */
function turnStarts(messages: NormalizedMessage[]): number[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (index === 0 || isUserTextRow(message)) {
      starts.push(index);
    }
  });
  return starts;
}

/** Drops whole leading turns until the budget fits, always keeping the newest. */
function dropOldestTurns(
  messages: NormalizedMessage[],
  budget: number,
): NormalizedMessage[] {
  if (messages.length <= 1) {
    return messages;
  }
  const starts = turnStarts(messages);
  // Walking forward keeps every cut on a turn boundary, so the surviving
  // transcript still begins with a question rather than half an answer.
  for (let i = 1; i < starts.length; i += 1) {
    const candidate = messages.slice(starts[i]);
    if (measure(candidate) <= budget) {
      return candidate;
    }
  }
  return messages.slice(starts[starts.length - 1]);
}

/**
 * Removes the fields capable of dwarfing the transcript: inline base64 images,
 * full tool outputs, subagent timelines and workflow journals. Tool names and
 * arguments stay, so a restored tool card still says what ran — only its
 * result is gone.
 */
function stripHeavyPayloads(messages: NormalizedMessage[]): NormalizedMessage[] {
  return messages.map((message) => {
    const stripped: NormalizedMessage = { ...message };
    if (stripped.images?.some((image) => image.data)) {
      stripped.images = stripped.images.map(({ data: _data, ...rest }) => rest);
    }
    if (stripped.toolResult) {
      const { content: _content, toolUseResult: _toolUseResult, ...rest } = stripped.toolResult;
      stripped.toolResult = { ...rest, content: '' };
    }
    if (stripped.toolUseResult !== undefined) {
      stripped.toolUseResult = undefined;
    }
    if (stripped.subagentTools !== undefined) {
      stripped.subagentTools = undefined;
    }
    if (stripped.workflow !== undefined) {
      stripped.workflow = undefined;
    }
    return stripped;
  });
}

/** Last resort: the prose alone, with every card and tool row removed. */
function keepTextOnly(messages: NormalizedMessage[]): NormalizedMessage[] {
  return messages.filter((message) => message.kind === 'text');
}

/**
 * Fits a rendered transcript into the snapshot budget in three passes: drop
 * the oldest turns, strip heavy payloads, then keep prose only. A same call
 * second time is a no-op — the reducer is applied on every turn end and again
 * on `pagehide`, so re-trimming must not eat one more turn each time.
 */
export function trimBtwSnapshotMessages(
  messages: NormalizedMessage[],
  budget: number = BTW_SNAPSHOT_BUDGET_CHARS,
): NormalizedMessage[] {
  if (measure(messages) <= budget) {
    return messages;
  }

  let trimmed = dropOldestTurns(messages, budget);
  if (measure(trimmed) <= budget) {
    return trimmed;
  }

  trimmed = stripHeavyPayloads(trimmed);
  if (measure(trimmed) <= budget) {
    return trimmed;
  }

  trimmed = keepTextOnly(trimmed);
  if (measure(trimmed) <= budget) {
    return trimmed;
  }

  // Text alone can still exceed the budget on a very long turn. Tightening to
  // the newest turn here (rather than leaving the array over budget) is what
  // makes the second pass a fixed point: one turn is as far as this trims.
  return dropOldestTurns(trimmed, budget);
}

/**
 * The in-flight prose a snapshot carries, in the shape the streaming buffer
 * needs to resume appending instead of starting from an empty string
 * (otherwise the next delta would replace the whole reply).
 */
export function extractStreamingSeed(
  messages: NormalizedMessage[],
): { text: string; thinking: string; provider: LLMProvider } | null {
  let text = '';
  let thinking = '';
  let provider: LLMProvider | null = null;

  for (const message of messages) {
    if (message.kind !== 'stream_delta') {
      continue;
    }
    provider ??= message.provider;
    if (message.streamChannel === 'thinking') {
      thinking = message.content ?? '';
    } else {
      text = message.content ?? '';
    }
  }

  return provider ? { text, thinking, provider } : null;
}

function isSnapshot(value: unknown): value is BtwSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<BtwSnapshot>;
  return candidate.v === 1
    && typeof candidate.sessionId === 'string'
    && candidate.sessionId.length > 0
    && typeof candidate.forkSourceSessionId === 'string'
    && candidate.forkSourceSessionId.length > 0
    && typeof candidate.savedAt === 'number'
    && typeof candidate.lastSeq === 'number'
    && typeof candidate.minimized === 'boolean'
    && Array.isArray(candidate.messages);
}

/**
 * Reads the snapshot for this tab, or null when there is none to trust.
 *
 * A malformed, outdated or stale entry is removed on the way out: leaving it
 * behind would make every later read pay for the same parse.
 */
export function readBtwSnapshot(now: number = Date.now()): BtwSnapshot | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearBtwSnapshot();
    return null;
  }

  if (!isSnapshot(parsed) || now - parsed.savedAt > BTW_SNAPSHOT_MAX_AGE_MS) {
    clearBtwSnapshot();
    return null;
  }
  return { ...parsed, truncated: parsed.truncated === true };
}

/**
 * Writes the drawer's state and answers whether the budget cost any rows.
 *
 * Never throws: storage can be full, disabled or missing (private mode), and
 * none of that should surface to the reader — the only consequence is that this
 * reload will not bring the drawer back.
 */
export function writeBtwSnapshot(input: BtwSnapshotInput, now: number = Date.now()): boolean {
  const trimmed = trimBtwSnapshotMessages(input.messages);
  // Sticky: once a tab has dropped turns, saving the already-trimmed array
  // again must not make the next reload believe nothing was lost.
  const truncated = input.truncated === true || trimmed.length < input.messages.length;
  const base = { v: 1 as const, ...input, truncated, savedAt: now };

  try {
    window.sessionStorage.setItem(
      BTW_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({ ...base, messages: trimmed }),
    );
    return truncated;
  } catch {
    // Fall through to the metadata-only write below.
  }

  // Quota, not parsing: keep the identity so the copy is still reachable after
  // the reload, even though its transcript has to come back empty.
  try {
    window.sessionStorage.setItem(
      BTW_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({ ...base, messages: [], truncated: true }),
    );
  } catch {
    // No room even for the metadata; restoration simply will not happen.
  }
  return true;
}

export function clearBtwSnapshot(): void {
  try {
    window.sessionStorage.removeItem(BTW_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Nothing to do: a snapshot that cannot be removed is still unreadable
    // after the next write, and it expires on its own.
  }
}
