/**
 * When the user last had each session's row on screen, mirrored in
 * localStorage.
 *
 * The grace period that keeps a "you looked at this, it is still to deal with"
 * dot on a row lives in `useProjectsState`'s memory and died with the page: a
 * reload — or a phone dropping the app from memory — wiped the dot, so the one
 * case the grace period exists for, glancing at a session and coming back to it
 * later, was lost exactly when it was most likely to happen. This mirror is what
 * a reload reads to bring that dot back.
 *
 * Deliberately device-local: the dot means "I looked at this here", and a second
 * device that never opened the session has its own answer. The server-side
 * watermark store (`sessionReadState`) remains the cross-device record of *what
 * content* was read; this is only *when* the row was last on screen here.
 */
const STORAGE_KEY = 'session-last-viewed';

/**
 * Storage hygiene, not the dot's lifetime.
 *
 * How long a view still counts is the grace period's business
 * (`ATTENTION_GRACE_MS`), and it stays the caller's to apply. This is only the
 * age past which a remembered view can never matter again, so the map tracks
 * recently seen sessions instead of every session ever opened.
 */
const PRUNE_AFTER_MS = 60 * 60 * 1000;

/** Wall-clock ms of the last on-screen moment per session; module-scope store. */
let viewedAt = new Map<string, number>();

function readMirror(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Map();
    }

    const restored = new Map<string, number>();
    for (const [sessionId, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) {
        restored.set(sessionId, at);
      }
    }
    return restored;
  } catch {
    return new Map();
  }
}

function writeMirror(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(viewedAt)));
  } catch {
    // A full localStorage costs the restored dot, not the live one.
  }
}

/** Records that `sessionId`'s row was on screen at `at` (wall-clock ms). */
export function noteSessionLastViewed(sessionId: string, at: number): void {
  if (!sessionId || !Number.isFinite(at)) {
    return;
  }

  const next = new Map(viewedAt);
  next.set(sessionId, at);

  // Drop views too old to matter, so the map stays bounded by recent sessions.
  const cutoff = at - PRUNE_AFTER_MS;
  for (const [id, seenAt] of next) {
    if (seenAt < cutoff) {
      next.delete(id);
    }
  }

  viewedAt = next;
  writeMirror();
}

/** The wall-clock ms `sessionId` was last on screen here, or null if never/forgotten. */
export function getSessionLastViewedAt(sessionId: string): number | null {
  return viewedAt.get(sessionId) ?? null;
}

/** Drops one session's remembered view, for when the session has been handled. */
export function clearSessionLastViewed(sessionId: string): void {
  if (!viewedAt.has(sessionId)) {
    return;
  }

  const next = new Map(viewedAt);
  next.delete(sessionId);
  viewedAt = next;
  writeMirror();
}

/** Drops every remembered view on sign-out, so the next user starts clean. */
export function resetSessionLastViewed(): void {
  viewedAt = new Map();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory copy is already cleared, which is what readers use.
  }
}

// Read at module load rather than on first use, because a reload must have the
// map ready before the sidebar decides which rows carry the dot.
if (typeof localStorage !== 'undefined') {
  viewedAt = readMirror();
}
