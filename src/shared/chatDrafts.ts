import { api } from '@/shared/api';
import type { QueuedSendOptions } from '@/shared/types';

/**
 * Unsent composer text and queued messages, stored in `auth.db` rather than in
 * the browser.
 *
 * This is what lets a message half-typed on a laptop be finished on a phone —
 * the case the composer previously could not serve at all, because a draft only
 * existed on the machine it was typed on. As with the preference store, a
 * localStorage mirror is kept purely so a reload shows the draft on the first
 * paint instead of a blank composer that fills in a moment later.
 *
 * A scope is a session id, or `project:<projectId>` for a chat that has not
 * been sent yet and so has no session. Drafts used to be keyed by project
 * alone, which meant every session in a project shared one draft.
 */

/** A queued message as it is stored: text plus the send options it was composed under. */
export type StoredQueuedMessage = {
  content: string;
  options?: QueuedSendOptions;
  /** Legacy image-only descriptors retained for queued draft compatibility. */
  images?: unknown[];
  /**
   * JSON-safe descriptors returned by POST /api/assets/files. Unlike browser
   * File objects, they can follow a queued message across session switches.
   */
  attachments?: unknown[];
};

type DraftRecord = {
  text: string;
  queuedMessage: StoredQueuedMessage | null;
};

/** Fired after any draft changes, from a local write or from a hydrate. */
export const CHAT_DRAFTS_CHANGED_EVENT = 'chat-drafts:changed';

const MIRROR_STORAGE_KEY = 'chat-drafts';

/**
 * Longer than the preference debounce: this fires on every keystroke, and a
 * draft is only ever read back on a reload or a device switch, so trading a
 * little latency for far fewer requests is the right side of the trade.
 */
const SERVER_WRITE_DEBOUNCE_MS = 1_000;

const EMPTY_DRAFT: DraftRecord = { text: '', queuedMessage: null };

const listeners = new Set<() => void>();

let drafts = new Map<string, DraftRecord>();
const pendingScopes = new Set<string>();
let serverWriteTimer: ReturnType<typeof setTimeout> | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isEmptyDraft = (draft: DraftRecord): boolean => (
  draft.text === '' && draft.queuedMessage === null
);

/** A queued message's attachments, normalized to the one field that survives a device switch. */
const queuedAttachments = (queued: StoredQueuedMessage): unknown[] => (
  Array.isArray(queued.attachments)
    ? queued.attachments
    : Array.isArray(queued.images)
      ? queued.images
      : []
);

/** A queued message with neither text nor attachments has nothing to send. */
const hasQueuedContent = (queued: StoredQueuedMessage | null): boolean => {
  if (!queued) {
    return false;
  }

  // `queued` is read back from localStorage or the server and only ever
  // shape-checked as an object, so `content` can be absent on a legacy or
  // malformed record (an attachments-only one, say). Read it defensively: this
  // runs while every session row renders, so a throw here would take out the
  // sidebar rather than one composer.
  const content = typeof queued.content === 'string' ? queued.content : '';
  return content.trim() !== '' || queuedAttachments(queued).length > 0;
};

/**
 * Whether a scope holds anything the user wrote but has not sent: composer text
 * (ignoring whitespace) or a queued message.
 *
 * This is the sidebar's "there is a draft here" signal. It is deliberately
 * unrelated to the read state — opening a session clears its unread flag but
 * must never clear this, because the draft is still unsent.
 */
const draftHasContent = (draft: DraftRecord): boolean => (
  draft.text.trim() !== '' || hasQueuedContent(draft.queuedMessage)
);

function readMirror(): Map<string, DraftRecord> {
  try {
    const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return new Map();
    }

    const restored = new Map<string, DraftRecord>();
    for (const [scope, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }
      restored.set(scope, {
        text: typeof value.text === 'string' ? value.text : '',
        queuedMessage: isRecord(value.queuedMessage)
          ? (value.queuedMessage as StoredQueuedMessage)
          : null,
      });
    }
    return restored;
  } catch {
    return new Map();
  }
}

function writeMirror(): void {
  try {
    localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // A full localStorage costs the first-paint restore, not the draft: the
    // server copy is authoritative and arrives on hydrate.
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_DRAFTS_CHANGED_EVENT));
  }
}

function flushServerWrites(): void {
  serverWriteTimer = null;
  const scopes = [...pendingScopes];
  pendingScopes.clear();

  for (const scope of scopes) {
    const draft = drafts.get(scope);

    // A save that fails must never surface as an unhandled rejection out of a
    // timer callback: the mirror already holds the draft, and the next
    // keystroke re-sends it.
    try {
      if (!draft || isEmptyDraft(draft)) {
        void api.user.deleteDraft(scope).catch((error: unknown) => {
          console.error('Failed to delete chat draft:', error);
        });
        continue;
      }

      void api.user.saveDraft(scope, {
        text: draft.text,
        queuedMessage: draft.queuedMessage,
      }).catch((error: unknown) => {
        console.error('Failed to save chat draft:', error);
      });
    } catch (error) {
      console.error('Failed to save chat draft:', error);
    }
  }
}

function queueServerWrite(scope: string): void {
  pendingScopes.add(scope);

  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
  }
  serverWriteTimer = setTimeout(flushServerWrites, SERVER_WRITE_DEBOUNCE_MS);
}

function flushServerWritesNow(): void {
  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
    serverWriteTimer = null;
  }
  flushServerWrites();
}

function updateDraft(scope: string, update: Partial<DraftRecord>): void {
  const current = drafts.get(scope) ?? EMPTY_DRAFT;
  const next: DraftRecord = { ...current, ...update };

  if (next.text === current.text && next.queuedMessage === current.queuedMessage) {
    return;
  }

  const nextDrafts = new Map(drafts);
  if (isEmptyDraft(next)) {
    nextDrafts.delete(scope);
  } else {
    nextDrafts.set(scope, next);
  }
  drafts = nextDrafts;

  writeMirror();
  queueServerWrite(scope);
  notifyListeners();
}

/** Reads one scope's composer text, synchronously, for the first render. */
export function readDraftText(scope: string): string {
  return drafts.get(scope)?.text ?? '';
}

export function writeDraftText(scope: string, text: string): void {
  updateDraft(scope, { text });
}

export function readQueuedMessage(scope: string): StoredQueuedMessage | null {
  const queued = drafts.get(scope)?.queuedMessage ?? null;
  if (!queued) {
    return null;
  }

  const attachments = queuedAttachments(queued);

  // A queued message with neither text nor attachments has nothing to send.
  return hasQueuedContent(queued)
    ? { ...queued, attachments }
    : null;
}

export function writeQueuedMessage(scope: string, message: StoredQueuedMessage): void {
  updateDraft(scope, { queuedMessage: message });
  // Queueing is a send-like action, so persist it before the tab can close.
  flushServerWritesNow();
}

export function clearQueuedMessage(scope: string): void {
  updateDraft(scope, { queuedMessage: null });
  // Editing or cancelling must beat the server's next dispatcher poll.
  flushServerWritesNow();
}

/** Subscribes to any draft change; returns the unsubscribe function. */
export function subscribeToChatDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The scopes currently holding an unsent draft — see `getDraftScopesSnapshot`. */
let draftScopesSnapshot: ReadonlySet<string> = new Set();

const sameScopes = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) {
    return false;
  }
  for (const scope of a) {
    if (!b.has(scope)) {
      return false;
    }
  }
  return true;
};

/**
 * The scopes holding unsent input, as a snapshot whose *reference* only changes
 * when the set of scopes does.
 *
 * `useSyncExternalStore` compares snapshots by reference, and `notifyListeners`
 * fires on every keystroke, so returning a freshly built set each call would
 * re-render every subscribed session row once per character typed. Caching
 * until the membership actually differs keeps typing local to the composer.
 */
export function getDraftScopesSnapshot(): ReadonlySet<string> {
  const next = new Set<string>();
  for (const [scope, draft] of drafts) {
    if (draftHasContent(draft)) {
      next.add(scope);
    }
  }

  if (sameScopes(draftScopesSnapshot, next)) {
    return draftScopesSnapshot;
  }

  draftScopesSnapshot = next;
  return next;
}

/**
 * Loads the server's drafts and adopts them as the source of truth.
 *
 * A scope the client has typed into since this page loaded is left alone: the
 * user is looking at that composer right now, and replacing its contents with a
 * staler server copy would delete what they are in the middle of writing.
 */
export async function hydrateChatDrafts(): Promise<void> {
  let serverDrafts: Array<{ scope?: unknown; text?: unknown; queuedMessage?: unknown }> = [];

  try {
    const response = await api.user.drafts();
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { drafts?: unknown };
    if (!Array.isArray(payload.drafts)) {
      return;
    }
    serverDrafts = payload.drafts as typeof serverDrafts;
  } catch (error) {
    // Keep the mirror: an offline load must still show what was typed here.
    console.error('Failed to load chat drafts:', error);
    return;
  }

  const merged = new Map<string, DraftRecord>();
  for (const draft of serverDrafts) {
    const scope = typeof draft.scope === 'string' ? draft.scope : '';
    if (!scope || pendingScopes.has(scope)) {
      continue;
    }

    merged.set(scope, {
      text: typeof draft.text === 'string' ? draft.text : '',
      queuedMessage: isRecord(draft.queuedMessage)
        ? (draft.queuedMessage as StoredQueuedMessage)
        : null,
    });
  }

  // Local edits whose debounced write has not left the browser yet win over
  // the server snapshot. Every other missing scope was deleted remotely and
  // must also disappear from the mirror.
  for (const scope of pendingScopes) {
    const pending = drafts.get(scope);
    if (pending) {
      merged.set(scope, pending);
    }
  }

  drafts = merged;
  writeMirror();
  notifyListeners();
}

/** Drops every cached draft on sign-out, so the next user sees none of them. */
export function resetChatDrafts(): void {
  drafts = new Map();
  pendingScopes.clear();
  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
    serverWriteTimer = null;
  }
  try {
    localStorage.removeItem(MIRROR_STORAGE_KEY);
  } catch {
    // The in-memory copy is already cleared, which is what readers use.
  }
  notifyListeners();
}

// Read at module load rather than on first use, because the composer's initial
// input value is a `useState` initializer that runs before any effect.
if (typeof localStorage !== 'undefined') {
  drafts = readMirror();
}
