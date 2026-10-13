/**
 * Auth event repository.
 *
 * Persists the login/session audit trail (`auth_events`): the four auth event
 * kinds with their source address and user agent. Writes are best-effort —
 * `record` never throws, so a logging failure cannot break authentication.
 * `login_failure` insertion is capacity-gated because the login endpoint is
 * public and unauthenticated, so it is the only externally-free write path.
 */

import { getConnection } from '@/modules/database/connection.js';

/** The audited auth events; used by Auth (writes) and Settings (reads) through this module's barrel. */
export type AuthEventType = 'login_success' | 'login_failure' | 'logout' | 'register';

/** A single event to record; `userId` stays null for `login_failure` so a failed attempt never discloses whether the username exists. */
export type AuthEventInput = {
  type: AuthEventType;
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** One stored audit row as returned by `list`. */
export type AuthEventRow = {
  id: number;
  event_type: AuthEventType;
  user_id: number | null;
  username: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
};

/** Already-validated list filters; the caller (settings service) clamps and whitelists them. */
export type AuthEventListParams = {
  limit: number;
  offset: number;
  eventType: AuthEventType | null;
  username: string | null;
  ip: string | null;
};

// Maximum login_failure rows before the write-side capacity gate closes.
const MAX_LOGIN_FAILURE_ROWS = 100_000;
const USERNAME_MAX = 128;
const USER_AGENT_MAX = 512;
const IP_MAX = 64;

/**
 * Truncates to `max` UTF-16 code units without leaving a lone surrogate.
 * A plain `slice` can split a surrogate pair; better-sqlite3 silently rewrites
 * the orphan to U+FFFD (three extra code units), which would break the
 * "never longer than max" invariant this truncation exists to guarantee.
 */
const truncate = (value: string | null | undefined, max: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  return value.slice(0, max).replace(/[\uD800-\uDFFF]/g, '');
};

/**
 * Creates an auth event repository. `maxLoginFailureRows` is injectable so tests
 * can exercise the capacity gate without writing a hundred thousand rows.
 */
export function createAuthEventsDb(maxLoginFailureRows: number = MAX_LOGIN_FAILURE_ROWS) {
  // Capacity gate state, kept per instance so a test repository cannot leak its
  // counts into the shared one. `baseline` is read lazily on the first
  // login_failure write so it lands after the boot-time prune and never touches
  // the DB at import time (which would run before the table exists); `inserted`
  // counts the login_failure rows written since, keeping the check O(1) and
  // query-free on the hot path.
  let baseline: number | null = null;
  let inserted = 0;
  let capacityWarned = false;

  const countAll = (): number =>
    (getConnection().prepare('SELECT COUNT(*) AS n FROM auth_events').get() as { n: number }).n;

  return {
    /**
     * Records one auth event. Best-effort: any failure — including opening the
     * connection — is logged and swallowed so it never affects the login result.
     */
    record(input: AuthEventInput): void {
      try {
        if (input.type === 'login_failure') {
          if (baseline === null) {
            baseline = countAll();
          }
          if (baseline + inserted >= maxLoginFailureRows) {
            if (!capacityWarned) {
              capacityWarned = true;
              console.warn(
                `auth_events capacity (${maxLoginFailureRows}) reached — `
                + 'login_failure recording paused until restart or manual prune',
              );
            }
            return;
          }
        }

        const db = getConnection();
        db.prepare(
          'INSERT INTO auth_events (event_type, user_id, username, ip, user_agent) VALUES (?, ?, ?, ?, ?)',
        ).run(
          input.type,
          input.userId ?? null,
          truncate(input.username, USERNAME_MAX),
          truncate(input.ip, IP_MAX),
          truncate(input.userAgent, USER_AGENT_MAX),
        );

        if (input.type === 'login_failure') {
          inserted += 1;
        }
      } catch (err) {
        console.error('Failed to record auth event', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    /** Returns one page plus the total count under the same filters. */
    list(params: AuthEventListParams): { events: AuthEventRow[]; total: number } {
      const db = getConnection();
      const conditions: string[] = [];
      const filters: unknown[] = [];
      if (params.eventType) {
        conditions.push('event_type = ?');
        filters.push(params.eventType);
      }
      if (params.username) {
        conditions.push('username = ?');
        filters.push(params.username);
      }
      if (params.ip) {
        conditions.push('ip = ?');
        filters.push(params.ip);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { n: total } = db
        .prepare(`SELECT COUNT(*) AS n FROM auth_events ${where}`)
        .get(...filters) as { n: number };

      // ORDER BY id DESC breaks ties within the same second so paging never
      // duplicates or skips rows when the planner picks the event-type index.
      const events = db.prepare(
        `SELECT * FROM auth_events ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      ).all(...filters, params.limit, params.offset) as AuthEventRow[];

      return { events, total };
    },

    /** Deletes rows older than `days`. Returns the number removed. */
    pruneOlderThan(days: number): number {
      const db = getConnection();
      return db
        .prepare("DELETE FROM auth_events WHERE created_at < datetime('now', ?)")
        .run(`-${days} days`).changes;
    },
  };
}

/** Shared instance used by Auth to record login/logout events and Settings to read them back. */
export const authEventsDb = createAuthEventsDb();
