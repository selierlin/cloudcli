import { getConnection } from '@/modules/database/connection.js';

/**
 * In-process registry that keeps the btw placeholder window from leaking a
 * visible session row.
 *
 * A btw fork inserts its row before the provider has produced a session id
 * (`provider_session_id` is NULL). The filesystem watcher indexes transcripts
 * by looking that column up, so during that window it cannot find the
 * placeholder and inserts a row of its own with the default visibility. This
 * registry tells `createSession` that such a row belongs to a fork that is
 * still being created, so it lands hidden instead.
 *
 * Consumers: `sessions.db.ts` (claim on insert, settle on backfill) and the
 * Providers btw service (register before forking, settle/abandon after).
 *
 * The claim is keyed by project path because that is the only stable handle the
 * watcher's insert path has; a claim therefore *can* catch an unrelated new
 * session created in the same project inside the window. That is why every
 * claimed row is re-checked on settle: a row whose provider id is not the id
 * this fork produced is reverted to visible. Never let the window turn a
 * normal session into a hidden one — the cleanup sweep would delete it.
 */
type PendingEphemeralFork = {
  placeholderSessionId: string;
  expiresAt: number;
  /** Rows the watcher created and that we marked hidden for this fork. */
  claimedSessionIds: string[];
};

/**
 * Generous compared with a fork (milliseconds normally, seconds for OpenCode's
 * temporary server) and short enough that any abandoned registration stops
 * affecting new sessions within a minute.
 */
const PENDING_TTL_MS = 60_000;

const pendingByProjectPath = new Map<string, PendingEphemeralFork[]>();

/**
 * Declares that a btw fork is about to write a transcript for `projectPath`.
 *
 * Must be called after the placeholder row exists and before the provider fork
 * starts, so a watcher insert landing in between is recognized.
 */
export function registerEphemeralFork(projectPath: string, placeholderSessionId: string): void {
  const pending = pendingByProjectPath.get(projectPath) ?? [];
  pending.push({
    placeholderSessionId,
    expiresAt: Date.now() + PENDING_TTL_MS,
    claimedSessionIds: [],
  });
  pendingByProjectPath.set(projectPath, pending);
}

/**
 * Answers whether the row the watcher is about to insert belongs to a fork in
 * flight, claiming it so `settleEphemeralFork` can re-check it later.
 *
 * Called from `createSession`'s insert branch only — an update of an existing
 * row must never flip visibility.
 */
export function claimEphemeralFork(projectPath: string, createdSessionId: string): boolean {
  const pending = pendingByProjectPath.get(projectPath);
  if (!pending || pending.length === 0) {
    return false;
  }

  const now = Date.now();
  const live = pending.filter((entry) => entry.expiresAt > now);
  if (live.length !== pending.length) {
    pendingByProjectPath.set(projectPath, live);
  }
  if (live.length === 0) {
    pendingByProjectPath.delete(projectPath);
    return false;
  }

  // Oldest first: two btw drawers in one project claim in creation order.
  live[0].claimedSessionIds.push(createdSessionId);
  return true;
}

/**
 * Closes one registration after the fork succeeded, reverting any row it
 * claimed that is not the row this fork produced.
 *
 * `expectedProviderSessionId` is the id the provider reported for the fork; a
 * claimed row carrying a different id is an unrelated session that happened to
 * be created inside the window, so it goes back to visible.
 */
export function settleEphemeralFork(
  projectPath: string,
  placeholderSessionId: string,
  expectedProviderSessionId: string,
): void {
  const pending = pendingByProjectPath.get(projectPath);
  if (!pending) {
    return;
  }

  const entry = pending.find((item) => item.placeholderSessionId === placeholderSessionId);
  const remaining = pending.filter((item) => item !== entry);
  if (remaining.length > 0) {
    pendingByProjectPath.set(projectPath, remaining);
  } else {
    pendingByProjectPath.delete(projectPath);
  }

  if (!entry) {
    return;
  }

  revertClaims(entry.claimedSessionIds.filter((id) => id !== expectedProviderSessionId));
}

/**
 * Closes one registration after the fork failed: nothing was produced, so every
 * row it claimed was a mislabel and goes back to visible.
 */
export function abandonEphemeralFork(projectPath: string, placeholderSessionId: string): void {
  const pending = pendingByProjectPath.get(projectPath);
  if (!pending) {
    return;
  }

  const entry = pending.find((item) => item.placeholderSessionId === placeholderSessionId);
  const remaining = pending.filter((item) => item !== entry);
  if (remaining.length > 0) {
    pendingByProjectPath.set(projectPath, remaining);
  } else {
    pendingByProjectPath.delete(projectPath);
  }

  if (entry) {
    revertClaims(entry.claimedSessionIds);
  }
}

/**
 * Drops registrations whose fork never reported back and reverts whatever they
 * claimed.
 *
 * A process that dies between register and settle leaves no chance to decide
 * whether the claimed row was the fork; reverting is the safe direction because
 * a visible stray fork is recoverable while a hidden normal session is deleted
 * by the periodic sweep. Callers: the ephemeral cleanup job.
 */
export function sweepExpiredEphemeralForks(now: number = Date.now()): void {
  for (const [projectPath, pending] of pendingByProjectPath) {
    const kept: PendingEphemeralFork[] = [];
    for (const entry of pending) {
      if (entry.expiresAt > now) {
        kept.push(entry);
        continue;
      }
      revertClaims(entry.claimedSessionIds);
    }

    if (kept.length > 0) {
      pendingByProjectPath.set(projectPath, kept);
    } else {
      pendingByProjectPath.delete(projectPath);
    }
  }
}

/** Test-only: forgets every registration without touching rows. */
export function resetEphemeralForkRegistryForTests(): void {
  pendingByProjectPath.clear();
  retiredProviderSessions.clear();
}

// --------------------- RECLAIMED PROVIDER SESSIONS ---------------------

/**
 * Provider session ids whose transcript was just deleted, with the moment the
 * tombstone stops applying.
 *
 * Deleting a session removes the row and the file, but a watcher pass that
 * already read the file can finish its upsert afterwards and re-insert the row
 * — the session the user just closed comes back as a normal visible one. The
 * upsert checks this set first and skips the row; the TTL only has to outlive a
 * single scan (6s polling plus parse time).
 */
const retiredProviderSessions = new Map<string, number>();

const RETIRED_TTL_MS = 60_000;

/**
 * Remembers a provider session id whose transcript is being deleted so a
 * watcher pass already in flight cannot resurrect it.
 *
 * Callers: the btw delete path (before the row and file are removed).
 */
export function retireProviderSession(providerSessionId: string): void {
  retiredProviderSessions.set(providerSessionId, Date.now() + RETIRED_TTL_MS);
}

/**
 * Answers whether a watcher-discovered session must be ignored because it was
 * just reclaimed. Consumers: `sessions.db.ts`'s insert path.
 */
export function isRetiredProviderSession(providerSessionId: string): boolean {
  const expiresAt = retiredProviderSessions.get(providerSessionId);
  if (expiresAt === undefined) {
    return false;
  }

  if (expiresAt > Date.now()) {
    return true;
  }

  retiredProviderSessions.delete(providerSessionId);
  return false;
}

/**
 * Restores rows that a window claim marked hidden.
 *
 * The `provider_session_id = session_id` guard is what makes this safe: only a
 * row the watcher created from a provider-native id matches, never the
 * placeholder (NULL) or a backfilled fork row.
 */
function revertClaims(sessionIds: string[]): void {
  if (sessionIds.length === 0) {
    return;
  }

  const db = getConnection();
  const statement = db.prepare(
    `UPDATE sessions SET is_ephemeral = 0
     WHERE session_id = ?
       AND is_ephemeral = 1
       AND provider_session_id = session_id`,
  );
  for (const sessionId of sessionIds) {
    statement.run(sessionId);
  }
}
