import { api } from '@/shared/api';

/**
 * Per-user, per-session read watermarks, stored in `auth.db` rather than in the
 * browser.
 *
 * Before this, an unread flag lived only in memory: a reload wiped it, and a
 * second device never saw it at all. The user then learns not to trust the
 * indicator. A watermark is the session's *content* timestamp as of the moment
 * the user left it, so comparing the two answers "did a new message arrive?"
 * without a bare file `touch` (which moves the file's mtime but not the
 * conversation) raising a false flag.
 */
let watermarks = new Map<string, string>();
const listeners = new Set<() => void>();
let hydration: Promise<void> | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribes to any watermark change; returns the unsubscribe function. */
export function subscribeToSessionReadState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionLastSeenAt(sessionId: string): string | null {
  return watermarks.get(sessionId) ?? null;
}

/**
 * True when the session's content moved past the watermark the user left.
 *
 * A session with no watermark is never unread. That is deliberate: the feature
 * must not greet an upgrade — or a user who has only ever browsed the sidebar —
 * with a wall of unread flags for sessions they never opened. A session also
 * needs a content timestamp to be judged at all; providers that cannot supply
 * one are simply never flagged, never guessed at.
 */
export function isSessionUnread(
  sessionId: string,
  contentUpdatedAt: string | null | undefined,
): boolean {
  if (!sessionId || !contentUpdatedAt) {
    return false;
  }

  const seen = watermarks.get(sessionId);
  if (!seen) {
    return false;
  }

  const seenMs = Date.parse(seen);
  const contentMs = Date.parse(contentUpdatedAt);
  if (Number.isNaN(seenMs) || Number.isNaN(contentMs)) {
    return false;
  }

  return contentMs > seenMs;
}

/**
 * Loads the server's watermarks and adopts them as the source of truth.
 *
 * Runs once per load, alongside the draft hydration, so a reload and a second
 * device both start from the same record. Concurrent callers share one request.
 */
export async function hydrateSessionReadState(): Promise<void> {
  if (hydration) {
    return hydration;
  }

  hydration = (async () => {
    try {
      const response = await api.user.readState();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { readState?: unknown };
      if (!Array.isArray(payload.readState)) {
        return;
      }

      const next = new Map<string, string>();
      for (const entry of payload.readState) {
        const record = entry as { sessionId?: unknown; lastSeenAt?: unknown };
        const sessionId = typeof record.sessionId === 'string' ? record.sessionId : '';
        const lastSeenAt = typeof record.lastSeenAt === 'string' ? record.lastSeenAt : '';
        if (sessionId && lastSeenAt) {
          next.set(sessionId, lastSeenAt);
        }
      }

      watermarks = next;
      notify();
    } catch (error) {
      // Keep whatever is in memory: an offline load must still show the flags
      // it can compute.
      console.error('Failed to load session read state:', error);
    } finally {
      hydration = null;
    }
  })();

  return hydration;
}

/**
 * Records that the user has seen a session up to its current content timestamp.
 *
 * The value written is a snapshot the client read from the server, never the
 * local clock, so the comparison on the next load has no clock skew to worry
 * about. A no-op write (the watermark already matches) never hits the network.
 */
export function markSessionSeen(
  sessionId: string,
  contentUpdatedAt: string | null | undefined,
): void {
  if (!sessionId || !contentUpdatedAt) {
    return;
  }
  if (watermarks.get(sessionId) === contentUpdatedAt) {
    return;
  }

  watermarks.set(sessionId, contentUpdatedAt);
  notify();

  void api.user.saveReadState(sessionId, contentUpdatedAt).catch((error) => {
    console.error('Failed to save session read state:', error);
  });
}

/** Drops one session's watermark locally and on the server. */
export function clearSessionReadState(sessionId: string): void {
  if (!sessionId || !watermarks.has(sessionId)) {
    return;
  }

  watermarks.delete(sessionId);
  notify();

  void api.user.deleteReadState(sessionId).catch((error) => {
    console.error('Failed to delete session read state:', error);
  });
}

/** Drops every watermark on sign-out, so the next user sees none of them. */
export function resetSessionReadState(): void {
  watermarks = new Map();
  hydration = null;
  notify();
}
