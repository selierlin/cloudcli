import { getConnection } from '@/modules/database/connection.js';

/**
 * One user's read watermark for one session.
 *
 * `lastSeenAt` is the session's content timestamp as of the moment the user
 * left it, so it can be compared against the session's current content
 * timestamp to decide whether it is unread. A null watermark means the user has
 * never been recorded leaving the session.
 */
type SessionReadStateRecord = {
  sessionId: string;
  lastSeenAt: string | null;
};

type ReadStateRow = {
  session_id: string;
  last_seen_at: string | null;
};

export const sessionReadStateDb = {
  /**
   * Returns every watermark the user has, newest first.
   *
   * The client pulls the whole set once per load and compares it against the
   * project list it already fetched, so no per-session round trip is needed.
   */
  getReadState(userId: number): SessionReadStateRecord[] {
    const rows = getConnection()
      .prepare(
        `SELECT session_id, last_seen_at
         FROM session_read_state
         WHERE user_id = ?
         ORDER BY datetime(updated_at) DESC`
      )
      .all(userId) as ReadStateRow[];

    return rows.map((row) => ({
      sessionId: row.session_id,
      lastSeenAt: row.last_seen_at ?? null,
    }));
  },

  /**
   * Returns one user's watermark for one session, or null when they have none.
   *
   * The `session_upserted` delta is for a single session, so it reads the one
   * watermark instead of pulling the whole set.
   */
  getReadStateForSession(userId: number, sessionId: string): string | null {
    const row = getConnection()
      .prepare(
        `SELECT last_seen_at
         FROM session_read_state
         WHERE user_id = ? AND session_id = ?
         LIMIT 1`
      )
      .get(userId, sessionId) as { last_seen_at: string | null } | undefined;

    return row?.last_seen_at ?? null;
  },

  /**
   * Records that the user has seen a session up to `lastSeenAt`.
   *
   * One row per (user, session): a later write for the same session replaces
   * the watermark rather than appending, which is what keeps two devices from
   * overwriting each other's unrelated sessions.
   */
  saveReadState(userId: number, sessionId: string, lastSeenAt: string | null): void {
    getConnection()
      .prepare(
        `INSERT INTO session_read_state (user_id, session_id, last_seen_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, session_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(userId, sessionId, lastSeenAt);
  },

  deleteReadState(userId: number, sessionId: string): void {
    getConnection()
      .prepare('DELETE FROM session_read_state WHERE user_id = ? AND session_id = ?')
      .run(userId, sessionId);
  },
};
