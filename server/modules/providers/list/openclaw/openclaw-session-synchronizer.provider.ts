import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
  getOpenclawAgentDbPath,
  getOpenclawAgentIdFromSessionKey,
  getOpenclawAgentIds,
  getOpenclawHomeDir,
  getOpenclawWorkspaceDir,
} from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import {
  decodeOpenclawTranscriptEvent,
  readOpenclawUserText,
  type OpenclawTranscriptEventRow,
} from '@/modules/providers/list/openclaw/openclaw-sessions.provider.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  normalizeProviderTimestamp,
  normalizeSessionName,
  readJsonRecord,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

const PROVIDER = 'openclaw' as const;

type OpenclawNodeRow = {
  session_key: string | null;
  current_session_id: string | null;
  display_name: string | null;
  label: string | null;
  entry_json: string | null;
  created_at: number | null;
  updated_at: number | null;
  last_interaction_at: number | null;
};

type SynchronizeRowsResult = {
  processed: number;
  firstSessionId: string | null;
  /** True when the agent store could not be read, so the scan must be retried. */
  failed: boolean;
};

/**
 * Tables addressed by `session_id`, deleted before the session index rows.
 *
 * `session_transcript_active_events` hangs off `transcript_events` by a
 * composite foreign key, so it goes first. All rows for the session's *windows*
 * are cleared because a session key can own several window ids (reset /
 * rollover / fork), each with its own transcript.
 */
const OPENCLAW_SESSION_REFERENCING_TABLES = [
  'session_transcript_active_events',
  'transcript_events',
  'session_transcript_index_state',
] as const;

const readFiniteNumber = (value: unknown): number | null =>
  (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Session indexer for OpenClaw's per-agent SQLite transcript stores.
 *
 * OpenClaw keeps every conversation in `agents/<agentId>/agent/
 * openclaw-agent.sqlite`; `session_nodes` is the index, one row per session
 * key. Because the store is shared, `jsonl_path` must stay null (removing a
 * per-session file would mean removing the whole database) and permanent
 * deletes go through {@link deleteProviderSession}, or the next scan
 * re-indexes the session.
 */
export class OpenclawSessionSynchronizer implements IProviderSessionSynchronizer {
  private hasCompletedInitialScan = false;

  /**
   * Scans every agent's shared store and upserts discovered sessions.
   *
   * The first scan is full because OpenClaw sessions can predate the persisted
   * global scan cursor — a store that predates the integration would otherwise
   * never surface its older conversations. Once the backfill succeeds, later
   * scans honor the orchestration cursor. `synchronizeAgent` swallows per-agent
   * read errors and reports them via `failed`, so the flag advances only after a
   * clean pass and a partial first scan is retried as a full scan next time.
   */
  async synchronize(since?: Date): Promise<number> {
    const scanSince = this.hasCompletedInitialScan ? since : undefined;
    let processed = 0;
    let failed = false;
    for (const agentId of getOpenclawAgentIds()) {
      const result = this.synchronizeAgent(agentId, scanSince);
      processed += result.processed;
      failed ||= result.failed;
    }
    if (!failed) {
      this.hasCompletedInitialScan = true;
    }
    return processed;
  }

  /**
   * Handles watcher changes for a shared agent store.
   *
   * Only the main `openclaw-agent.sqlite` is matched; its `-wal`/`-shm`
   * sidecars commit far more often and would multiply watcher work for no new
   * session rows.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== 'openclaw-agent.sqlite') {
      return null;
    }
    const agentId = path.basename(path.dirname(path.dirname(filePath)));
    return this.synchronizeAgent(agentId, undefined, 1).firstSessionId;
  }

  /**
   * Deletes one session and every row that points at its windows from the
   * agent's shared store. Called by the app on permanent delete: OpenClaw
   * sessions have no per-session transcript file to unlink, so the store is the
   * only source of truth and leaving rows behind lets the next scan re-index
   * the session.
   */
  async deleteProviderSession(providerSessionId: string): Promise<void> {
    const agentId = getOpenclawAgentIdFromSessionKey(providerSessionId);
    if (!agentId) {
      return;
    }
    const dbPath = getOpenclawAgentDbPath(agentId);
    if (!fsSync.existsSync(dbPath)) {
      return;
    }

    const db = new Database(dbPath);
    try {
      db.pragma('busy_timeout = 2000');
      const windowIds = (db
        .prepare('SELECT session_id AS sid FROM session_windows WHERE session_key = ?')
        .all(providerSessionId) as { sid: string | null }[])
        .map((row) => readOptionalString(row.sid))
        .filter((sid): sid is string => Boolean(sid));

      for (const sessionId of windowIds) {
        for (const table of OPENCLAW_SESSION_REFERENCING_TABLES) {
          try {
            db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId);
          } catch {
            // Table absent in this schema version; nothing to clean up for it.
          }
        }
      }
      db.prepare('DELETE FROM session_windows WHERE session_key = ?').run(providerSessionId);
      db.prepare('DELETE FROM session_nodes WHERE session_key = ?').run(providerSessionId);
    } finally {
      db.close();
    }
  }

  private synchronizeAgent(agentId: string, since?: Date, limit?: number): SynchronizeRowsResult {
    const dbPath = getOpenclawAgentDbPath(agentId);
    if (!fsSync.existsSync(dbPath)) {
      return { processed: 0, firstSessionId: null, failed: false };
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('busy_timeout = 2000');
      const sinceMillis = since?.getTime() ?? null;
      const limitClause = limit ? 'LIMIT ?' : '';
      const params = limit ? [sinceMillis, sinceMillis, limit] : [sinceMillis, sinceMillis];
      const rows = db.prepare(`
        SELECT
          session_key AS session_key,
          current_session_id AS current_session_id,
          display_name AS display_name,
          label AS label,
          entry_json AS entry_json,
          created_at AS created_at,
          updated_at AS updated_at,
          last_interaction_at AS last_interaction_at
        FROM session_nodes
        WHERE archived_at IS NULL
          AND (? IS NULL OR COALESCE(last_interaction_at, updated_at, created_at, 0) >= ?)
        ORDER BY COALESCE(last_interaction_at, updated_at, created_at, 0) DESC, session_key DESC
        ${limitClause}
      `).all(...params) as OpenclawNodeRow[];

      let processed = 0;
      let firstSessionId: string | null = null;
      for (const row of rows) {
        const indexedSessionId = this.upsertSession(db, row);
        if (!indexedSessionId) {
          continue;
        }
        if (!firstSessionId) {
          firstSessionId = indexedSessionId;
        }
        processed += 1;
      }

      return { processed, firstSessionId, failed: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[OpenclawProvider] Failed to synchronize agent ${agentId}:`, message);
      return { processed: 0, firstSessionId: null, failed: true };
    } finally {
      db.close();
    }
  }

  private upsertSession(db: Database.Database, row: OpenclawNodeRow): string | null {
    const sessionKey = readOptionalString(row.session_key);
    const currentSessionId = readOptionalString(row.current_session_id);
    if (!sessionKey || !currentSessionId) {
      return null;
    }
    const projectPath = this.resolveProjectPath(db, currentSessionId);
    const entry = readJsonRecord(row.entry_json);

    const fallbackTitle = 'Untitled OpenClaw Session';
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionKey)
      ?? sessionsDb.getSessionById(sessionKey)
      ?? sessionsDb.findLatestPendingAppSession(PROVIDER, projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // The watcher can index the session before the runtime reports its
      // provider id back, so bind the fresh app row first to avoid a duplicate
      // sidebar entry keyed by the provider id.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionKey);
    }

    const existingSession = sessionsDb.getSessionByProviderSessionId(sessionKey)
      ?? sessionsDb.getSessionById(sessionKey);
    const existingName = existingSession?.custom_name;

    let nextName: string | undefined;
    if (existingName && existingName !== fallbackTitle) {
      nextName = existingName;
    } else {
      nextName = readOptionalString(row.display_name)
        ?? readOptionalString(row.label)
        ?? this.readFirstUserText(db, currentSessionId);
    }

    const createdSource = row.created_at
      ?? readFiniteNumber(entry?.sessionStartedAt)
      ?? readFiniteNumber(entry?.createdAt)
      ?? row.updated_at;
    const updatedSource = row.last_interaction_at
      ?? row.updated_at
      ?? row.created_at
      ?? createdSource;

    return sessionsDb.createSession(
      sessionKey,
      PROVIDER,
      projectPath,
      normalizeSessionName(nextName, fallbackTitle),
      normalizeProviderTimestamp(createdSource),
      normalizeProviderTimestamp(updatedSource),
      null,
    );
  }

  /**
   * Resolves a session's project path from its transcript header `cwd`.
   *
   * OpenClaw has no project concept (`session_nodes.project_id` is empty), so
   * the header's working directory is the only signal. Missing/unresolvable
   * `cwd` falls back to the default agent workspace.
   */
  private resolveProjectPath(db: Database.Database, sessionId: string): string {
    let cwd: string | null = null;
    try {
      const row = db
        .prepare('SELECT event_json AS event_json, event_zstd AS event_zstd FROM transcript_events WHERE session_id = ? AND seq = 0')
        .get(sessionId) as OpenclawTranscriptEventRow | undefined;
      const header = row ? decodeOpenclawTranscriptEvent(row) : null;
      cwd = readOptionalString(header?.cwd) ?? null;
    } catch {
      // Header unreadable; fall through to the workspace default.
    }

    const fallback = getOpenclawWorkspaceDir() ?? path.join(getOpenclawHomeDir(), 'workspace');
    const target = cwd ?? fallback;
    try {
      return fsSync.realpathSync(target);
    } catch {
      return target;
    }
  }

  /** First non-injected user text on the active path, used as the name fallback. */
  private readFirstUserText(db: Database.Database, sessionId: string): string | undefined {
    try {
      const rows = db.prepare(`
        SELECT t.event_json AS event_json, t.event_zstd AS event_zstd
        FROM session_transcript_active_events a
        INNER JOIN transcript_events t
          ON t.session_id = a.session_id AND t.seq = a.event_seq
        WHERE a.session_id = ?
        ORDER BY a.active_position
      `).all(sessionId) as OpenclawTranscriptEventRow[];

      for (const row of rows) {
        const entry = decodeOpenclawTranscriptEvent(row);
        if (entry?.type !== 'message') {
          continue;
        }
        const message = readObjectRecord(entry.message);
        if (message?.role !== 'user') {
          continue;
        }
        const content = message.content;
        let rawText = '';
        if (typeof content === 'string') {
          rawText = content;
        } else if (Array.isArray(content)) {
          rawText = content
            .map((block) => readOptionalString(readObjectRecord(block)?.text) ?? '')
            .filter((text) => text !== '')
            .join('\n');
        }
        const text = readOpenclawUserText(rawText);
        if (text) {
          return text;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
}
