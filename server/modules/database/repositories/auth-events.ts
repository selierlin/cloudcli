/**
 * Auth event repository.
 *
 * Persists the auth audit trail (`auth_events`): the audited event kinds with
 * their source address and user agent. Writes are best-effort — `record` never
 * throws, so a logging failure cannot break authentication.
 *
 * The gated failure kinds (`GATED_FAILURE_TYPES`) are capacity-gated because
 * they are the externally-free write paths: the login endpoint is public and
 * unauthenticated, and `/api/agent` is a machine endpoint reachable with a
 * wrong or missing API key. Both share one cap and one counter (D21).
 */

import { getConnection } from '@/modules/database/connection.js';

/** The audited auth events; used by Auth/Agent (writes) and Settings (reads) through this module's barrel. */
export type AuthEventType = 'login_success' | 'login_failure' | 'logout' | 'register' | 'agent_auth_failure';

/** A single event to record; `userId` stays null for the failure kinds (`login_failure` / `agent_auth_failure`) so a failed attempt never discloses whether the identity exists. */
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

/**
 * List filters: the caller (settings service) validates and clamps paging, and
 * `list` truncates `username`/`ip` to the writer's budgets so a filter matches
 * the value that was actually stored.
 */
export type AuthEventListParams = {
  limit: number;
  offset: number;
  eventType: AuthEventType | null;
  username: string | null;
  ip: string | null;
};

/**
 * Failure types a caller with no credentials can trigger for free. They share
 * one capacity cap and counter (D21), so a flood on either surface bounds the
 * combined failure-row storage. Gating `agent_auth_failure` here matters: the
 * `/api/agent` endpoint has no JWT and would otherwise be a new free storage
 * sink. Used by the write gate, the row counter and the baseline count.
 */
const GATED_FAILURE_TYPES: ReadonlySet<AuthEventType> = new Set(['login_failure', 'agent_auth_failure']);

// Maximum gated failure rows before the write-side capacity gate closes.
const MAX_FAILURE_ROWS = 100_000;
const USERNAME_MAX = 128;
const USER_AGENT_MAX = 512;
const IP_MAX = 64;

/**
 * Truncates to `max` Unicode code points. Used by both the writer and the
 * `list` filters, so a stored value and the filter that looks it up are cut by
 * the same rule.
 *
 * Slicing by code point — rather than by UTF-16 code unit — is what keeps a
 * surrogate pair whole. A code-unit `slice` can cut an emoji in half, and a
 * "repair" pass that strips surrogate code units is worse: `[\uD800-\uDFFF]`
 * matches *both halves of valid pairs*, so it deletes every emoji and astral
 * character (CJK extensions, 𝕳, …) instead of just the orphan. Slicing the
 * code-point array never splits a pair and never drops content, and still
 * bounds storage (a code point is at most two code units).
 *
 * A lone surrogate that the caller already passed in survives here and is
 * stored as U+FFFD by better-sqlite3 — acceptable for a display-only field.
 */
const truncate = (value: string | null | undefined, max: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  return Array.from(value).slice(0, max).join('');
};

/**
 * Creates an auth event repository. `maxFailureRows` is injectable so tests can
 * exercise the capacity gate without writing a hundred thousand rows.
 */
export function createAuthEventsDb(maxFailureRows: number = MAX_FAILURE_ROWS) {
  // Capacity gate state, kept per instance so a test repository cannot leak its
  // counts into the shared one. `baseline` is read lazily on the first gated
  // failure write so it lands after the boot-time prune and never touches the
  // DB at import time (which would run before the table exists); `inserted`
  // counts the gated rows written since, keeping the check O(1) and query-free
  // on the hot path.
  let baseline: number | null = null;
  let inserted = 0;
  let capacityWarned = false;

  // Counts only the gated failure rows, not the whole table: successes, logouts
  // and registrations are not externally free and must not consume the gate's
  // budget, or a normal account's own history would close the gate early (N11).
  // The `IN` list is built from the same set the gate uses, so a newly gated
  // type cannot be counted by one and missed by the other. Uses
  // idx_auth_events_type, so it stays a single index scan.
  const countFailures = (): number => {
    const placeholders = [...GATED_FAILURE_TYPES].map(() => '?').join(', ');
    return (getConnection()
      .prepare(`SELECT COUNT(*) AS n FROM auth_events WHERE event_type IN (${placeholders})`)
      .get(...GATED_FAILURE_TYPES) as { n: number }).n;
  };

  return {
    /**
     * Records one auth event. Best-effort: any failure — including opening the
     * connection — is logged and swallowed so it never affects the login result.
     */
    record(input: AuthEventInput): void {
      try {
        if (GATED_FAILURE_TYPES.has(input.type)) {
          if (baseline === null) {
            baseline = countFailures();
          }
          if (baseline + inserted >= maxFailureRows) {
            if (!capacityWarned) {
              capacityWarned = true;
              console.warn(
                `auth_events capacity (${maxFailureRows}) reached — `
                + 'failure recording paused until restart or manual prune',
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

        if (GATED_FAILURE_TYPES.has(input.type)) {
          inserted += 1;
        }
      } catch (err) {
        console.error('Failed to record auth event', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    /**
     * Returns one page plus the total count under the same filters.
     *
     * The username/ip filters are truncated with the writer's own code-point
     * budgets first: a stored value was cut by that rule, so a filter that is
     * longer — or cut by a different rule, such as UTF-16 code units — could
     * never match its own row (C4). Normalizing here keeps the rule in the one
     * place that owns the stored format, instead of having every caller mirror it.
     */
    list(params: AuthEventListParams): { events: AuthEventRow[]; total: number } {
      const db = getConnection();
      const username = truncate(params.username, USERNAME_MAX);
      const ip = truncate(params.ip, IP_MAX);
      const conditions: string[] = [];
      const filters: unknown[] = [];
      if (params.eventType) {
        conditions.push('event_type = ?');
        filters.push(params.eventType);
      }
      if (username) {
        conditions.push('username = ?');
        filters.push(username);
      }
      if (ip) {
        conditions.push('ip = ?');
        filters.push(ip);
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
