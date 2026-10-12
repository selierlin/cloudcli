/**
 * How long each reply took, held in memory only.
 *
 * A turn's wall-clock time — from the moment the user dispatched it to the
 * run's terminal `complete` — is measured as the reply finishes and parked
 * under `${sessionId}:${segmentId}`. `segmentId` is the one identity that
 * survives the live row being replaced by its persisted counterpart (the
 * client carries it onto the server row), so a tail refresh keeps resolving,
 * and the map lives as long as this JS context, so switching to another session
 * and back still reads it.
 *
 * It is deliberately NOT persisted. A browser refresh or another device has no
 * entry, and the footer shows nothing rather than a guessed value. Making it
 * survive those would mean stamping the duration on the server's transcript
 * row — not starting a second client-side source of truth.
 *
 * Two bounds stop it growing without limit: a deleted session's entries are
 * dropped outright (`clearTurnDurations`), and past `MAX_RETAINED_DURATIONS`
 * the oldest measurement is evicted. An evicted row simply reads as "not
 * measured" — the state a reload already produces, never a guessed number.
 */

/** Cap on retained measurements; past it the oldest entry is evicted. */
const MAX_RETAINED_DURATIONS = 1_000;

const turnStartedAt = new Map<string, number>();
const turnDurationMs = new Map<string, number>();

/** Session ids are opaque ids that never contain a colon, so the pair is unambiguous. */
const durationKey = (sessionId: string, segmentId: string): string => `${sessionId}:${segmentId}`;

/** Records when the user dispatched a turn for a session. */
export function markTurnStart(sessionId: string, startedAt: number): void {
  turnStartedAt.set(sessionId, startedAt);
}

/**
 * Closes the turn this client started for `sessionId`, always consuming its
 * start.
 *
 * The start is dropped even when no duration can be recorded — an aborted run,
 * a run that produced no answer text of its own, and a send rejected before the
 * run began all reach a terminal with no segment to park the time under, and a
 * start left behind would time whatever turn came next. `segmentId` is the
 * answer row's stable id, or null when the turn produced none.
 */
export function endTurn(sessionId: string, segmentId: string | null, completedAt: number): void {
  const startedAt = turnStartedAt.get(sessionId);
  turnStartedAt.delete(sessionId);
  if (startedAt === undefined || segmentId === null) {
    return;
  }

  const elapsed = completedAt - startedAt;
  if (elapsed < 0) {
    return;
  }

  // Re-inserting moves the key to the back of the iteration order, so the
  // eviction below always sheds the least recently measured entry.
  const key = durationKey(sessionId, segmentId);
  turnDurationMs.delete(key);
  turnDurationMs.set(key, elapsed);
  while (turnDurationMs.size > MAX_RETAINED_DURATIONS) {
    const oldest = turnDurationMs.keys().next();
    if (oldest.done) {
      return;
    }
    turnDurationMs.delete(oldest.value);
  }
}

/** The recorded duration for a rendered row, or undefined when there is none. */
export function getTurnDuration(sessionId: string, segmentId: string): number | undefined {
  return turnDurationMs.get(durationKey(sessionId, segmentId));
}

/**
 * Drops every measurement for a session, unconsumed start included. Called when
 * a session is deleted so its entries cannot outlive it; without it a project
 * the user has churned through keeps every turn it ever timed.
 */
export function clearTurnDurations(sessionId: string): void {
  turnStartedAt.delete(sessionId);
  const prefix = `${sessionId}:`;
  for (const key of turnDurationMs.keys()) {
    if (key.startsWith(prefix)) {
      turnDurationMs.delete(key);
    }
  }
}
