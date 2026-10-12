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
 */

const turnStartedAt = new Map<string, number>();
const turnDurationMs = new Map<string, number>();

/** Records when the user dispatched a turn for a session. */
export function markTurnStart(sessionId: string, startedAt: number): void {
  turnStartedAt.set(sessionId, startedAt);
}

/**
 * Pairs the recorded start with the run's end and parks the elapsed time under
 * the reply's stable segment id. No-op when this client never recorded a start
 * for the session — a turn it did not send has no duration to report.
 */
export function recordTurnDuration(sessionId: string, segmentId: string, completedAt: number): void {
  const startedAt = turnStartedAt.get(sessionId);
  if (startedAt === undefined) {
    return;
  }
  turnStartedAt.delete(sessionId);

  const elapsed = completedAt - startedAt;
  if (elapsed < 0) {
    return;
  }
  turnDurationMs.set(`${sessionId}:${segmentId}`, elapsed);
}

/** The recorded duration for a rendered row, or undefined when there is none. */
export function getTurnDuration(sessionId: string, segmentId: string): number | undefined {
  return turnDurationMs.get(`${sessionId}:${segmentId}`);
}
