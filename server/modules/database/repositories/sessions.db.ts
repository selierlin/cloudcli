import { getConnection } from '@/modules/database/connection.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { normalizeContentTimestamp, normalizeProjectPath } from '@/shared/utils.js';
import type { SessionNameSource } from '@/shared/types.js';

type SessionRow = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  project_path: string | null;
  jsonl_path: string | null;
  custom_name: string | null;
  /** Where `custom_name` came from; used to decide automatic title upgrades. */
  name_source: SessionNameSource | null;
  /** Model this session runs with; NULL until the app records one for it. */
  model: string | null;
  /** Reasoning effort this session runs with; NULL until the app records one. */
  effort: string | null;
  /** Whether the user has pinned this conversation in the recent feed. */
  isPinned: number;
  /** The app session this one was branched from; NULL unless it is a fork. */
  forked_from_session_id: string | null;
  /** The session this one is filed under (user-owned link); NULL if top-level. */
  parent_session_id: string | null;
  isArchived: number;
  created_at: string;
  updated_at: string;
  /** Timestamp of the newest main-line conversation event; NULL when unknown. */
  content_updated_at: string | null;
};

type RecentSessionsPage = {
  sessions: SessionRow[];
  total: number;
};

const SESSION_ROW_COLUMNS =
  'session_id, provider, provider_session_id, project_path, jsonl_path, custom_name, name_source, model, effort, isPinned, forked_from_session_id, parent_session_id, isArchived, created_at, updated_at, content_updated_at';

/**
 * Canonical ISO shape for every timestamp read out of the DB.
 *
 * Delegates to the shared content-timestamp normalizer, which also accepts a
 * bare epoch value: a column written by a provider that stored a number
 * (`1791531485193`) must not silently read back as null — the unread
 * comparison would then always answer "no content".
 */
function normalizeTimestamp(value?: string | number | null): string | null {
  return normalizeContentTimestamp(value);
}

function normalizeSessionRow<T extends SessionRow | null | undefined>(row: T): T {
  if (!row) {
    return row;
  }

  return {
    ...row,
    created_at: normalizeTimestamp(row.created_at) ?? row.created_at,
    updated_at: normalizeTimestamp(row.updated_at) ?? row.updated_at,
    content_updated_at: normalizeTimestamp(row.content_updated_at ?? undefined),
  };
}

function normalizeSessionRows(rows: SessionRow[]): SessionRow[] {
  return rows.map((row) => normalizeSessionRow(row) as SessionRow);
}

function normalizeProjectPathForProvider(provider: string, projectPath: string): string {
  void provider;
  return normalizeProjectPath(projectPath);
}

/**
 * Reclaims the read watermarks of the session rows a `DELETE FROM sessions`
 * is about to remove.
 *
 * `session_read_state` has no foreign key into `sessions` (see schema.ts), so
 * every path that drops session rows has to clear it explicitly — a lingering
 * row would let a reused session id inherit a stale watermark. The subquery is
 * evaluated before the session delete, so it sees exactly the rows going away.
 * Centralised so the delete paths cannot drift apart.
 */
function reclaimReadStateFor(
  db: ReturnType<typeof getConnection>,
  whereClause: string,
  ...params: Array<string | number>
): void {
  db.prepare(
    `DELETE FROM session_read_state
     WHERE session_id IN (SELECT session_id FROM sessions WHERE ${whereClause})`
  ).run(...params);
}

/**
 * Deletes every session row matched by `whereClause`, keeping both side effects
 * of a session delete in one place.
 *
 * `session_read_state` has no foreign key into `sessions`, so its rows are
 * reclaimed explicitly (see `reclaimReadStateFor`). Child sessions filed under
 * a deleted session are released first: `parent_session_id` is deliberately not
 * a foreign key, so nothing else would clear it and a child would otherwise
 * keep pointing at a row that no longer exists. Runs as one transaction so the
 * release, the watermark reclaim, and the delete cannot be seen half-applied.
 *
 * Shared by `deleteSessionById` and `deleteSessionByProviderSessionId` so every
 * delete path stays consistent instead of drifting apart.
 */
function deleteSessionRowsWhere(
  db: ReturnType<typeof getConnection>,
  whereClause: string,
  ...params: Array<string | number>
): number {
  return db.transaction(() => {
    db.prepare(
      `UPDATE sessions
       SET parent_session_id = NULL
       WHERE parent_session_id IN (SELECT session_id FROM sessions WHERE ${whereClause})`
    ).run(...params);
    reclaimReadStateFor(db, whereClause, ...params);
    return db.prepare(`DELETE FROM sessions WHERE ${whereClause}`).run(...params).changes;
  })();
}

/**
 * Repoints sessions filed under rows that are about to be deleted onto the row
 * that survives them, so a duplicate-row cleanup (watcher-row replacement,
 * provider-id merge) cannot leave children pointing at a row that no longer
 * exists. The surviving session itself is detached instead of being pointed at
 * itself, which can happen when it was filed under the duplicate being merged
 * away. Runs inside the caller's transaction. Like `updateSessionParent`, this
 * deliberately leaves `updated_at` untouched so reorganization does not bump a
 * session in the sidebar's recents ordering.
 *
 * `whereClause`/`params` select the rows being deleted; pass the same pair the
 * accompanying DELETE uses. Must only be given code-literal clauses — user
 * input may only travel through `params`.
 */
function repointChildrenToSurvivor(
  db: ReturnType<typeof getConnection>,
  whereClause: string,
  survivorSessionId: string,
  ...params: Array<string | number>
): void {
  db.prepare(
    `UPDATE sessions
     SET parent_session_id = CASE WHEN session_id = ? THEN NULL ELSE ? END
     WHERE parent_session_id IN (SELECT session_id FROM sessions WHERE ${whereClause})`
  ).run(survivorSessionId, survivorSessionId, ...params);
}

export const sessionsDb = {
  /**
   * Upserts one session row discovered on disk by a provider synchronizer.
   *
   * The given id is the provider-native session id. Rows are keyed by
   * `provider_session_id` so a session that was first created by the app
   * (with an app-allocated `session_id`) is updated in place once its
   * transcript shows up on disk, instead of producing a duplicate row.
   *
   * Claiming the row does not pin its name: only a name the user or the
   * provider itself fixed — `manual_rename`, `claude_custom_title`, `fork`,
   * `legacy_unknown` — survives the upsert. The four-word `initial_message`
   * title the app writes before any provider storage exists is provisional and
   * yields to whatever the provider derives from its own transcript.
   */
  createSession(
    providerSessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    createdAt?: string,
    updatedAt?: string,
    jsonlPath?: string | null,
    nameSource: SessionNameSource = 'provider_title',
    contentUpdatedAt?: string | number | null
  ): string {
    const db = getConnection();
    const createdAtValue = normalizeTimestamp(createdAt);
    const updatedAtValue = normalizeTimestamp(updatedAt);
    const contentUpdatedAtValue = normalizeTimestamp(contentUpdatedAt ?? undefined);
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    // First, ensure the project path is recorded in the projects table,
    // since it's a foreign key in the sessions table.
    projectsDb.createProjectPath(normalizedProjectPath);

    const existing = db
      .prepare(
        `SELECT session_id FROM sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { session_id: string } | undefined;

    if (existing) {
      // Archived rows must not be resurrected by a plain rescan (which omits
      // timestamps), but a caller reporting genuinely newer activity — an
      // explicit updatedAt newer than the stored one — reactivates the row.
      // The ON CONFLICT branch below keeps its own, opposite "omitted
      // timestamp counts as activity" rule for app-created legacy rows.
      db.prepare(
        `UPDATE sessions SET
           provider = ?,
           updated_at = COALESCE(?, CURRENT_TIMESTAMP),
           project_path = ?,
           jsonl_path = ?,
           content_updated_at = COALESCE(?, content_updated_at),
           isArchived = CASE WHEN ? IS NOT NULL AND julianday(?) > julianday(updated_at) THEN 0 ELSE isArchived END,
           custom_name = CASE
             WHEN session_id <> provider_session_id
               AND custom_name IS NOT NULL
               AND name_source IN ('manual_rename', 'claude_custom_title', 'fork', 'legacy_unknown')
               THEN custom_name
             ELSE COALESCE(?, custom_name)
           END,
           name_source = CASE
             WHEN session_id <> provider_session_id
               AND custom_name IS NOT NULL
               AND name_source IN ('manual_rename', 'claude_custom_title', 'fork', 'legacy_unknown')
               THEN name_source
             ELSE COALESCE(?, name_source)
           END
         WHERE session_id = ?
           AND (isArchived = 0 OR (? IS NOT NULL AND julianday(?) > julianday(updated_at)))`
      ).run(
        provider,
        updatedAtValue,
        normalizedProjectPath,
        jsonlPath ?? null,
        contentUpdatedAtValue,
        updatedAtValue,
        updatedAtValue,
        customName ?? null,
        nameSource,
        existing.session_id,
        updatedAtValue,
        updatedAtValue
      );

      return existing.session_id;
    }

    // Sessions created outside the app (directly via the provider CLI) are
    // keyed by the provider-native id for both columns. The ON CONFLICT path
    // covers legacy rows that predate the provider_session_id mapping.
    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, name_source, project_path, jsonl_path, isArchived, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?)
       ON CONFLICT(session_id) DO UPDATE SET
         provider = excluded.provider,
         provider_session_id = excluded.provider_session_id,
         updated_at = excluded.updated_at,
         project_path = excluded.project_path,
         jsonl_path = excluded.jsonl_path,
         content_updated_at = COALESCE(excluded.content_updated_at, sessions.content_updated_at),
         isArchived = CASE WHEN ? IS NULL OR julianday(excluded.updated_at) > julianday(sessions.updated_at) THEN 0 ELSE sessions.isArchived END,
         custom_name = CASE
           WHEN sessions.session_id <> sessions.provider_session_id
             AND sessions.custom_name IS NOT NULL
             AND sessions.name_source IN ('manual_rename', 'claude_custom_title', 'fork', 'legacy_unknown')
             THEN sessions.custom_name
           ELSE COALESCE(excluded.custom_name, sessions.custom_name)
         END,
         name_source = CASE
           WHEN sessions.session_id <> sessions.provider_session_id
             AND sessions.custom_name IS NOT NULL
             AND sessions.name_source IN ('manual_rename', 'claude_custom_title', 'fork', 'legacy_unknown')
             THEN sessions.name_source
           ELSE COALESCE(excluded.name_source, sessions.name_source)
         END`
    ).run(
      providerSessionId,
      provider,
      providerSessionId,
      customName ?? null,
      nameSource,
      normalizedProjectPath,
      jsonlPath ?? null,
      createdAtValue,
      updatedAtValue,
      contentUpdatedAtValue,
      updatedAtValue
    );

    return providerSessionId;
  },

  /**
   * Returns a session's recorded content timestamp, or null when the row does
   * not exist yet or its provider never supplied one.
   *
   * The on-disk watcher reads this right before re-indexing a transcript: an
   * unchanged value means the file's bytes changed without its conversation
   * moving on (a `touch` or an attribute write), which must not raise a false
   * unread flag.
   *
   * `(provider_session_id, provider)` is not unique, so the lookup is ordered
   * like `getSessionByProviderSessionId`: without a tie-break `LIMIT 1` could
   * return a stale duplicate row whose `content_updated_at` is NULL, which the
   * caller reads as "no new content" and drops the warning.
   */
  getSessionContentUpdatedAt(providerSessionId: string, provider: string): string | null {
    const row = getConnection()
      .prepare(
        `SELECT content_updated_at FROM sessions
         WHERE provider_session_id = ? AND provider = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { content_updated_at: string | null } | undefined;

    return normalizeTimestamp(row?.content_updated_at ?? undefined);
  },

  /**
   * Stamps a fallback content timestamp on a row that has none.
   *
   * A provider that cannot supply a content-level timestamp leaves the column
   * null, which reads as "never unread". The central content-event path calls
   * this so such a session still gets a version — but only when the column is
   * empty, so a precise value from a provider (Claude, openclaw) is never
   * overwritten by the fallback. This is the `COALESCE(precise, fallback)` half
   * that runs at the event, not at the row write.
   */
  backfillContentUpdatedAt(sessionIdOrProviderSessionId: string, contentUpdatedAt: string | number): void {
    const value = normalizeTimestamp(contentUpdatedAt);
    if (!value) {
      return;
    }

    getConnection()
      .prepare(
        `UPDATE sessions SET content_updated_at = ?
         WHERE content_updated_at IS NULL
           AND (session_id = ? OR provider_session_id = ?)`
      )
      .run(value, sessionIdOrProviderSessionId, sessionIdOrProviderSessionId);
  },

  /**
   * Inserts one app-allocated session row before any provider run happens.
   *
   * The session gateway uses this when the frontend starts a brand-new chat:
   * `session_id` is the stable app-facing id, while `provider_session_id`
   * stays NULL until the provider runtime announces its own id and
   * `assignProviderSessionId` records the mapping. `customName` is derived
   * from the first visible CloudCLI message by the sessions service.
   */
  createAppSession(
    sessionId: string,
    provider: string,
    projectPath: string,
    customName?: string,
    nameSource: SessionNameSource = 'initial_message',
  ): string {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);

    projectsDb.createProjectPath(normalizedProjectPath);

    db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, name_source, project_path, jsonl_path, isArchived, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(sessionId, provider, customName ?? null, nameSource, normalizedProjectPath);

    return sessionId;
  },

  /**
   * Inserts a session that already has its provider artifact on disk.
   *
   * Unlike `createAppSession` this writes `provider_session_id` and
   * `jsonl_path` immediately, because a fork's transcript file exists before
   * the row does — and the filesystem watcher would otherwise index it as an
   * unrelated session under its own id.
   */
  createForkedSession(input: {
    sessionId: string;
    provider: string;
    projectPath: string;
    customName: string | null;
    providerSessionId: string;
    /**
     * `null` for a provider whose sessions share one store rather than owning a
     * transcript file (OpenCode) — the same convention `createSession` uses.
     */
    jsonlPath: string | null;
    forkedFromSessionId: string;
    nameSource: SessionNameSource;
    model: string | null;
    effort: string | null;
  }): string {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(input.provider, input.projectPath);

    projectsDb.createProjectPath(normalizedProjectPath);

    // The watcher may already have created a row for the new transcript. Its
    // id is the provider-native one, which is what this row claims, so replace
    // it rather than leaving two sidebar entries for one conversation. Sessions
    // filed under the replaced row follow it onto the new one.
    db.transaction(() => {
      repointChildrenToSurvivor(
        db,
        'session_id = ? AND session_id <> ?',
        input.sessionId,
        input.providerSessionId,
        input.sessionId,
      );
      reclaimReadStateFor(db, 'session_id = ? AND session_id <> ?', input.providerSessionId, input.sessionId);
      db.prepare('DELETE FROM sessions WHERE session_id = ? AND session_id <> ?')
        .run(input.providerSessionId, input.sessionId);
      db.prepare(
        `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, name_source, project_path, jsonl_path, model, effort, forked_from_session_id, isArchived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).run(
        input.sessionId,
        input.provider,
        input.providerSessionId,
        input.customName,
        input.nameSource,
        normalizedProjectPath,
        input.jsonlPath,
        input.model,
        input.effort,
        input.forkedFromSessionId,
      );
    })();

    return input.sessionId;
  },

  /**
   * Records the provider-native session id for one app-allocated session.
   *
   * If the filesystem watcher indexed the provider transcript before this
   * mapping was recorded (a duplicate row keyed by the provider id exists),
   * the duplicate is merged into the app row: its transcript path and name
   * are adopted and the duplicate row is removed. Runs in a transaction so
   * the sidebar can never observe both rows at once.
   */
  assignProviderSessionId(sessionId: string, providerSessionId: string): void {
    const db = getConnection();

    const merge = db.transaction(() => {
      const duplicate = db
        .prepare(
          `SELECT ${SESSION_ROW_COLUMNS} FROM sessions
           WHERE (session_id = ? OR provider_session_id = ?)
             AND session_id <> ?
           LIMIT 1`
        )
        .get(providerSessionId, providerSessionId, sessionId) as SessionRow | undefined;

      if (duplicate) {
        // The duplicate row is merged into the app row, so sessions filed
        // under it follow onto the surviving row.
        repointChildrenToSurvivor(db, 'session_id = ?', sessionId, duplicate.session_id);
        reclaimReadStateFor(db, 'session_id = ?', duplicate.session_id);
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(duplicate.session_id);
        db.prepare(
          `UPDATE sessions SET
             provider_session_id = ?,
             jsonl_path = COALESCE(jsonl_path, ?),
             custom_name = COALESCE(custom_name, ?),
             name_source = CASE
               WHEN custom_name IS NULL THEN ?
               ELSE name_source
             END,
             updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`
        ).run(
          providerSessionId,
          duplicate.jsonl_path,
          duplicate.custom_name,
          duplicate.name_source,
          sessionId
        );
        return;
      }

      db.prepare(
        `UPDATE sessions SET
           provider_session_id = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`
      ).run(providerSessionId, sessionId);
    });

    merge();
  },

  /**
   * Moves one session onto a different provider session and transcript.
   *
   * Only editing a message on a provider that has to branch to rewind (Codex)
   * does this — an ordinary run keeps the same provider session for its whole
   * life. `assignProviderSessionId` cannot be used for it: that one keeps the
   * existing `jsonl_path` on purpose, so a session repointed with it would
   * claim the new thread while still reading the old transcript.
   *
   * The watcher may already have indexed either the new transcript or the
   * superseded source under its own id. Those rows are artifacts of the same
   * app conversation, so both are removed instead of leaving duplicate
   * sidebar entries.
   */
  repointSessionToProviderSession(
    sessionId: string,
    input: { providerSessionId: string; jsonlPath: string; supersededProviderSessionId?: string },
  ): void {
    const db = getConnection();

    db.transaction(() => {
      // Both deleted rows are artifacts of the same app conversation this
      // session survives as, so sessions filed under them follow onto it.
      repointChildrenToSurvivor(
        db,
        '(session_id = ? OR provider_session_id = ?) AND session_id <> ?',
        sessionId,
        input.providerSessionId,
        input.providerSessionId,
        sessionId,
      );
      reclaimReadStateFor(
        db,
        '(session_id = ? OR provider_session_id = ?) AND session_id <> ?',
        input.providerSessionId,
        input.providerSessionId,
        sessionId,
      );
      db.prepare(
        `DELETE FROM sessions
         WHERE (session_id = ? OR provider_session_id = ?)
           AND session_id <> ?`,
      ).run(input.providerSessionId, input.providerSessionId, sessionId);
      if (input.supersededProviderSessionId) {
        repointChildrenToSurvivor(
          db,
          '(session_id = ? OR provider_session_id = ?) AND session_id <> ?',
          sessionId,
          input.supersededProviderSessionId,
          input.supersededProviderSessionId,
          sessionId,
        );
        reclaimReadStateFor(
          db,
          '(session_id = ? OR provider_session_id = ?) AND session_id <> ?',
          input.supersededProviderSessionId,
          input.supersededProviderSessionId,
          sessionId,
        );
        db.prepare(
          `DELETE FROM sessions
           WHERE (session_id = ? OR provider_session_id = ?)
             AND session_id <> ?`,
        ).run(input.supersededProviderSessionId, input.supersededProviderSessionId, sessionId);
      }
      db.prepare(
        `UPDATE sessions SET
           provider_session_id = ?,
           jsonl_path = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`
      ).run(input.providerSessionId, input.jsonlPath, sessionId);
    })();
  },

  /**
   * Detaches a session from its provider session so the next run starts a new
   * one.
   *
   * Used when an edit replaces the very first prompt: there is no conversation
   * left to branch from, so the session starts over instead.
   */
  detachProviderSession(sessionId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions SET
         provider_session_id = NULL,
         jsonl_path = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(sessionId);
  },

  /**
   * Records that a session has left a provider session behind for good.
   *
   * The transcript stays on disk, which is deliberate — the abandoned attempt
   * is recoverable — but the indexer must not offer it back, and on a session
   * discovered from disk (whose app id *is* the provider id) rediscovering it
   * would repoint the row at the conversation the user edited away from.
   */
  markProviderSessionSuperseded(input: {
    providerSessionId: string;
    provider: string;
    sessionId: string;
    jsonlPath: string | null;
  }): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_session_id, provider) DO UPDATE SET
         session_id = excluded.session_id,
         jsonl_path = excluded.jsonl_path,
         created_at = CURRENT_TIMESTAMP`
    ).run(input.providerSessionId, input.provider, input.sessionId, input.jsonlPath);
  },

  isProviderSessionSuperseded(providerSessionId: string, provider: string): boolean {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT 1 AS found FROM superseded_provider_sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { found: number } | undefined;

    return Boolean(row);
  },

  /**
   * Returns the transcript path recorded when a provider session was
   * superseded, or `undefined` when it never was.
   *
   * `resolveCodexThreadPath` uses this to follow a fork's `history_base` back
   * to a thread that an edit or rewind already moved the live session off of:
   * that thread no longer has a row in `sessions`, but its rollout file is the
   * one the fork's history prefix lives in.
   */
  getSupersededSessionJsonlPath(providerSessionId: string, provider: string): string | undefined {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT jsonl_path FROM superseded_provider_sessions
         WHERE provider_session_id = ? AND provider = ?
         LIMIT 1`
      )
      .get(providerSessionId, provider) as { jsonl_path: string | null } | undefined;

    return row?.jsonl_path ?? undefined;
  },

  /**
   * Transcripts one session has left behind, for the caller that deletes a
   * conversation from disk.
   *
   * A conversation edited more than once has lived in more than one file, and
   * the session row only ever points at the newest.
   */
  getSupersededTranscriptPaths(sessionId: string): string[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT jsonl_path FROM superseded_provider_sessions
         WHERE session_id = ? AND jsonl_path IS NOT NULL`
      )
      .all(sessionId) as Array<{ jsonl_path: string }>;

    return rows.map((row) => row.jsonl_path);
  },

  /**
   * Forgets what a session left behind, once the session itself is gone.
   *
   * Without this the record outlives the row it was written for and keeps the
   * indexer refusing a transcript that no longer belongs to anything — a
   * conversation invisible to the app and impossible to delete through it.
   */
  clearSupersededProviderSessions(sessionId: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM superseded_provider_sessions WHERE session_id = ?').run(sessionId);
  },

  /**
   * Records the model one session runs with.
   *
   * Called both when the user picks a model for the session and on every send,
   * so the row always reflects what the session last ran with and reopening it
   * restores that model instead of a catalog default.
   */
  setSessionModel(sessionId: string, model: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET model = ?
       WHERE session_id = ?`
    ).run(model, sessionId);
  },

  /**
   * Records the reasoning effort one session runs with.
   *
   * `default` is stored as an explicit choice rather than NULL so reopening
   * the session does not inherit a later per-provider effort preference.
   */
  setSessionEffort(sessionId: string, effort: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET effort = ?
       WHERE session_id = ?`
    ).run(effort, sessionId);
  },

  updateSessionCustomName(
    sessionId: string,
    customName: string,
    nameSource: SessionNameSource = 'manual_rename',
  ): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET custom_name = ?,
           name_source = ?
       WHERE session_id = ?`
    ).run(customName, nameSource, sessionId);
  },

  getSessionById(sessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sessionId) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Resolves one session row through the provider-native id.
   *
   * The filesystem watcher only knows provider ids (they come from transcript
   * file names), so it uses this lookup to translate disk artifacts back to
   * the app-facing session row before broadcasting sidebar updates.
   */
  getSessionByProviderSessionId(providerSessionId: string): SessionRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider_session_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(providerSessionId) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  /**
   * Finds the newest app-created session for a project that is still waiting
   * for its provider-native id to be recorded.
   *
   * Primary intention: OpenCode can expose a new session in its shared
   * `opencode.db` before the websocket runtime reports that same provider id
   * back to our app. At that moment the sidebar already has an optimistic
   * app-owned session row, but the watcher only knows the provider-native id.
   *
   * Without this lookup, the synchronizer would insert a second row keyed by
   * the provider id, then `assignProviderSessionId()` would merge it a moment
   * later. That eventually self-heals, but on slow networks the user can still
   * briefly see two sidebar sessions for the same conversation.
   *
   * This helper lets the synchronizer claim the pending app row first, so the
   * provider id is attached before any watcher-created row exists. The result
   * is simpler than frontend dedupe and keeps the race resolved at the source.
   */
  findLatestPendingAppSession(provider: string, projectPath: string): SessionRow | null {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPathForProvider(provider, projectPath);
    const row = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE provider = ?
           AND project_path = ?
           AND provider_session_id IS NULL
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT 1`
      )
      .get(provider, normalizedProjectPath) as SessionRow | undefined;

    return normalizeSessionRow(row) ?? null;
  },

  getAllSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 0`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Returns one globally ordered page of visible conversations.
   *
   * Pagination happens after archived sessions and sessions belonging to an
   * archived project have been excluded. This keeps the sidebar feed complete
   * and correctly ordered across projects instead of flattening only the
   * per-project slices already loaded by the client.
   */
  getRecentSessionsPage(limit: number, offset: number): RecentSessionsPage {
    const db = getConnection();
    const visibilityClause = `
      sessions.isArchived = 0
      AND (projects.isArchived IS NULL OR projects.isArchived = 0)
    `;
    const rows = db
      .prepare(
        `SELECT sessions.*
         FROM sessions
         LEFT JOIN projects ON projects.project_path = sessions.project_path
         WHERE ${visibilityClause}
         ORDER BY sessions.isPinned DESC,
                  julianday(COALESCE(sessions.updated_at, sessions.created_at)) DESC,
                  sessions.session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as SessionRow[];
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         LEFT JOIN projects ON projects.project_path = sessions.project_path
         WHERE ${visibilityClause}`
      )
      .get() as { count: number } | undefined;

    return {
      sessions: normalizeSessionRows(rows),
      total: Number(countRow?.count ?? 0),
    };
  },

  /**
   * Archived rows are intentionally queried separately so the caller can render
   * them in a dedicated view without reintroducing them into active session lists.
   */
  getArchivedSessions(): SessionRow[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE isArchived = 1
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC`
      )
      .all() as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPath(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  /**
   * Permanent project deletion must see every session row for the path,
   * including archived ones, so their transcript files can be cleaned up.
   */
  getSessionsByProjectPathIncludingArchived(projectPath: string): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?`
      )
      .all(normalizedProjectPath) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  getSessionsByProjectPathPage(projectPath: string, limit: number, offset: number): SessionRow[] {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const rows = db
      .prepare(
        `SELECT ${SESSION_ROW_COLUMNS}
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0
         ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, session_id DESC
         LIMIT ? OFFSET ?`
      )
      .all(normalizedProjectPath, limit, offset) as SessionRow[];

    return normalizeSessionRows(rows);
  },

  countSessionsByProjectPath(projectPath: string): number {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sessions
         WHERE project_path = ?
           AND isArchived = 0`
      )
      .get(normalizedProjectPath) as { count: number } | undefined;

    return Number(row?.count ?? 0);
  },

  deleteSessionsByProjectPath(projectPath: string): void {
    const db = getConnection();
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    reclaimReadStateFor(db, 'project_path = ?', normalizedProjectPath);
    db.prepare(`DELETE FROM sessions WHERE project_path = ?`).run(normalizedProjectPath);
  },

  getSessionName(sessionId: string, provider: string): string | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT custom_name
         FROM sessions
         WHERE session_id = ? AND provider = ?`
      )
      .get(sessionId, provider) as { custom_name: string | null } | undefined;

    return row?.custom_name ?? null;
  },

  /**
   * Soft-delete and restore both use the same flag update so callers keep the
   * row, metadata, and file path intact while toggling visibility.
   */
  updateSessionIsArchived(sessionId: string, isArchived: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isArchived = ?
       WHERE session_id = ?`
    ).run(isArchived ? 1 : 0, sessionId);
  },

  /**
   * Persists the user's pin preference independently from a session's activity
   * timestamps, so synchronizers can refresh metadata without changing it.
   */
  updateSessionIsPinned(sessionId: string, isPinned: boolean): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET isPinned = ?
       WHERE session_id = ?`
    ).run(isPinned ? 1 : 0, sessionId);
  },

  /**
   * Files a session under another session, or clears the link with `null`.
   *
   * Used by the Providers module's `setSessionParent`. Touches only the
   * ownership column: like `updateSessionIsPinned`, it must not modify
   * `updated_at`/`content_updated_at`. The sidebar sort key is `updated_at`, so
   * writing it here would jump the session to the top of its project and skew
   * last-activity ordering just because the user reorganized the tree.
   */
  updateSessionParent(sessionId: string, parentSessionId: string | null): void {
    const db = getConnection();
    db.prepare(
      `UPDATE sessions
       SET parent_session_id = ?
       WHERE session_id = ?`
    ).run(parentSessionId, sessionId);
  },

  /**
   * Counts the sessions currently filed under `parentId`.
   *
   * Used by the Providers module's `setSessionParent` to enforce the one-level
   * rule: a session that already owns children may not itself be filed under
   * another session.
   */
  countChildrenOf(parentId: string): number {
    const db = getConnection();
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE parent_session_id = ?')
      .get(parentId) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  },

  deleteSessionById(sessionId: string): boolean {
    const db = getConnection();
    return deleteSessionRowsWhere(db, 'session_id = ?', sessionId) > 0;
  },

  /** Used by the OpenCode synchronizer to remove indexed child sessions by their native id. */
  deleteSessionByProviderSessionId(providerSessionId: string, provider: string): boolean {
    const db = getConnection();
    return (
      deleteSessionRowsWhere(
        db,
        'provider_session_id = ? AND provider = ?',
        providerSessionId,
        provider
      ) > 0
    );
  },

  /**
   * Lists every indexed session that claims a transcript file on disk.
   *
   * Only rows with a `jsonl_path` are returned, which deliberately excludes
   * app-created sessions still waiting for their first provider write and
   * OpenCode rows (whose transcripts all live inside one shared sqlite file).
   * Used by the session synchronizer to find rows whose transcript has been
   * deleted underneath the index.
   */
  getSessionsWithTranscriptPath(): Array<{ session_id: string; jsonl_path: string }> {
    const db = getConnection();
    return db
      .prepare(
        `SELECT session_id, jsonl_path
         FROM sessions
         WHERE jsonl_path IS NOT NULL AND jsonl_path <> ''`
      )
      .all() as Array<{ session_id: string; jsonl_path: string }>;
  },
};
