import fsSync from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { getZcodeDatabasePath } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import {
  normalizeProviderTimestamp,
  normalizeSessionName,
  readJsonRecord,
  readOptionalString,
  unwrapJsonStringLiteral,
} from '@/shared/utils.js';

type ZcodeSessionRow = {
  id: string;
  directory: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
};

type SynchronizeRowsResult = {
  processed: number;
  firstSessionId: string | null;
};

/**
 * Resolves a session's project path to its real filesystem path.
 *
 * ZCode stores an absolute `directory`, but on macOS `/tmp` is reported as
 * `/private/tmp` once resolved; project paths elsewhere in the app are
 * realpaths, so normalize before matching. A directory that no longer exists
 * falls back to the stored value.
 */
const normalizeProjectPath = (directory: string): string => {
  try {
    return fsSync.realpathSync(directory);
  } catch {
    return directory;
  }
};

/**
 * Session indexer for ZCode's OpenCode-derived SQLite store.
 *
 * Unlike OpenCode there is no `project` table, so the project path comes
 * straight from `session.directory`.
 */
export class ZcodeSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'zcode' as const;

  async synchronize(since?: Date): Promise<number> {
    return this.synchronizeRows(since).processed;
  }

  /**
   * Handles watcher changes for the shared SQLite database.
   *
   * Only the main `db.sqlite` is matched (matching the OpenCode synchronizer);
   * the `-wal` sidecar commits far more frequently and would multiply watcher
   * work for no new session rows.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== 'db.sqlite') {
      return null;
    }

    return this.synchronizeRows(undefined, 1).firstSessionId;
  }

  private synchronizeRows(since?: Date, limit?: number): SynchronizeRowsResult {
    const dbPath = getZcodeDatabasePath();
    if (!fsSync.existsSync(dbPath)) {
      return { processed: 0, firstSessionId: null };
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('busy_timeout = 2000');
      const sinceMillis = since?.getTime() ?? null;
      const limitClause = limit ? 'LIMIT ?' : '';
      const params = limit ? [sinceMillis, sinceMillis, limit] : [sinceMillis, sinceMillis];
      const rows = db.prepare(`
        SELECT
          s.id AS id,
          s.directory AS directory,
          s.title AS title,
          s.time_created AS time_created,
          s.time_updated AS time_updated
        FROM session s
        WHERE s.time_archived IS NULL
          AND (? IS NULL OR COALESCE(s.time_updated, s.time_created, 0) >= ?)
        ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC, s.id DESC
        ${limitClause}
      `).all(...params) as ZcodeSessionRow[];

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

      return { processed, firstSessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[ZcodeProvider] Failed to synchronize sessions:', message);
      return { processed: 0, firstSessionId: null };
    } finally {
      db.close();
    }
  }

  private upsertSession(db: Database.Database, row: ZcodeSessionRow): string | null {
    const sessionId = readOptionalString(row.id);
    const directory = readOptionalString(row.directory);
    if (!sessionId || !directory) {
      return null;
    }
    const projectPath = normalizeProjectPath(directory);

    const fallbackTitle = 'Untitled ZCode Session';
    const pendingAppSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId)
      ?? sessionsDb.findLatestPendingAppSession(this.provider, projectPath);
    if (pendingAppSession && !pendingAppSession.provider_session_id) {
      // The sqlite watcher can index the session before the runtime reports its
      // provider id back, so bind the fresh app row first to avoid a duplicate
      // sidebar entry keyed by the provider id.
      sessionsDb.assignProviderSessionId(pendingAppSession.session_id, sessionId);
    }

    const existingSession = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    const existingName = existingSession?.custom_name;

    let nextName: string | undefined;
    if (existingName && existingName !== fallbackTitle) {
      nextName = existingName;
    } else {
      nextName = readOptionalString(row.title) ?? this.readFirstUserText(db, sessionId);
    }

    // ZCode keeps every session in one shared SQLite database, so jsonl_path
    // must stay null to avoid deleting the database when one session is removed.
    return sessionsDb.createSession(
      sessionId,
      this.provider,
      projectPath,
      normalizeSessionName(nextName, fallbackTitle),
      normalizeProviderTimestamp(row.time_created),
      normalizeProviderTimestamp(row.time_updated ?? row.time_created),
      null,
    );
  }

  private readFirstUserText(db: Database.Database, sessionId: string): string | undefined {
    try {
      const row = db.prepare(`
        SELECT p.data AS data
        FROM message m
        INNER JOIN part p
          ON p.session_id = m.session_id
         AND p.message_id = m.id
        WHERE m.session_id = ?
          AND json_extract(m.data, '$.role') = 'user'
          AND json_extract(p.data, '$.type') = 'text'
        ORDER BY COALESCE(m.time_created, 0), COALESCE(m.sequence, 0), COALESCE(p.time_created, 0), COALESCE(p.sequence, 0)
        LIMIT 1
      `).get(sessionId) as { data: string | null } | undefined;

      const data = readJsonRecord(row?.data);
      const text = readOptionalString(data?.text);
      // ZCode persists the first prompt as a JSON string literal (e.g.
      // `"hello"`), so decode it to avoid surrounding the title in quotes.
      return text === undefined ? undefined : unwrapJsonStringLiteral(text);
    } catch {
      return undefined;
    }
  }
}
