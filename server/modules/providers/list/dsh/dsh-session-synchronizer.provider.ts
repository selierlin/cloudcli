import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { normalizeSessionName, readFileTimestamps } from '@/shared/utils.js';

import { getDshSessionsRoot } from './dsh-models.provider.js';
import {
  decodeZstdFrames,
  encodeSessionSegment,
  extractText,
  projectKey,
  SESSION_LOG_FILE,
} from './dsh-sessions.provider.js';

const FALLBACK_SESSION_NAME = 'Untitled DSH Session';

/**
 * Session indexer for DSH harness JSONL transcripts.
 *
 * The harness persists one session as
 * `<sessions-root>/--<project-key>--/<session-id>/session.jsonl.zstd`. The
 * project-key directory name is a one-way encoding of the session cwd (see
 * `projectKey`), so cwds are resolved by mapping every registered project path
 * through the same encoder instead of trying to reverse the slug.
 */
export class DshSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'dsh' as const;

  /**
   * Scans the DSH harness sessions root for every registered project and
   * upserts discovered session logs into the DB.
   *
   * The scan is intentionally full every time (`since` is ignored): DSH is a
   * newer provider whose historical transcripts predate any `scan_state`
   * cursor, so an incremental filter would silently hide them. The harness
   * keeps one small log per session, so a full scan stays cheap and
   * `createSession` upserts are idempotent.
   */
  async synchronize(_since?: Date): Promise<number> {
    const sessionsRoot = getDshSessionsRoot();
    const projectPaths = projectsDb
      .getProjectPaths()
      .map((project) => project.project_path)
      .filter((projectPath): projectPath is string => typeof projectPath === 'string' && projectPath.length > 0);

    let processed = 0;
    for (const projectPath of projectPaths) {
      const projectDir = path.join(sessionsRoot, projectKey(projectPath));
      let sessionDirNames: string[];
      try {
        const entries = await fsp.readdir(projectDir, { withFileTypes: true });
        sessionDirNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        // No DSH session directory exists for this project yet.
        continue;
      }

      for (const sessionDirName of sessionDirNames) {
        const logPath = path.join(projectDir, sessionDirName, SESSION_LOG_FILE);
        try {
          const indexedSessionId = await this.upsertSessionLog(logPath, projectPath, sessionDirName);
          if (indexedSessionId) {
            processed += 1;
          }
        } catch (error) {
          // One broken session (corrupt log, DB hiccup) must not abort the
          // whole scan: a rejection would stall the scan_state cursor and
          // force a full re-scan on the next cycle, permanently wedging the
          // indexer. Skip the bad session and keep going.
          console.warn(
            `[DSH] Skipping session ${sessionDirName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return processed;
  }

  /**
   * Indexes one DSH session log triggered by the filesystem watcher.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (path.basename(filePath) !== SESSION_LOG_FILE) {
      return null;
    }

    const sessionDir = path.dirname(filePath);
    const projectDir = path.dirname(sessionDir);
    const sessionId = path.basename(sessionDir);
    const projectKeyDir = path.basename(projectDir);

    // The project-key directory name is one-way encoded, so resolve the real
    // cwd by matching registered project paths against the encoded form.
    const projectPath = projectsDb
      .getProjectPaths()
      .map((project) => project.project_path)
      .find((candidate) => typeof candidate === 'string' && projectKey(candidate) === projectKeyDir);

    if (!projectPath) {
      return null;
    }

    return this.upsertSessionLog(filePath, projectPath, sessionId);
  }

  /**
   * Resolves the on-disk transcript path for one DSH session id, mirroring the
   * harness directory layout, so a permanent delete can remove the file even
   * before the watcher indexed the row. Returns null when no log exists yet.
   */
  async resolveTranscriptPath(providerSessionId: string, projectPath: string): Promise<string | null> {
    const logPath = path.join(
      getDshSessionsRoot(),
      projectKey(projectPath),
      encodeSessionSegment(providerSessionId),
      SESSION_LOG_FILE,
    );
    try {
      await fsp.access(logPath);
      return logPath;
    } catch {
      return null;
    }
  }

  private async upsertSessionLog(
    logPath: string,
    projectPath: string,
    sessionId: string,
  ): Promise<string | null> {
    // Index only sessions whose transcript actually exists on disk. The DSH
    // scan is directory-driven, so a leftover (empty) session directory must
    // not be resurrected as a placeholder row after a permanent delete removed
    // both the row and the file.
    try {
      await fsp.access(logPath);
    } catch {
      return null;
    }

    const existing = sessionsDb.getSessionByProviderSessionId(sessionId)
      ?? sessionsDb.getSessionById(sessionId);
    // Archive is the user's explicit "hide" choice; a full re-scan must not
    // resurrect an archived session while its transcript still sits on disk.
    if (existing?.isArchived) {
      return null;
    }

    const timestamps = await readFileTimestamps(logPath);
    const derivedName = normalizeSessionName(
      await this.extractSessionName(logPath),
      FALLBACK_SESSION_NAME,
    );
    // A transient title-parse failure (e.g. the zstd log read mid-write) must
    // not overwrite a real stored title with the fallback placeholder.
    const sessionName =
      existing?.custom_name
      && existing.custom_name !== FALLBACK_SESSION_NAME
      && derivedName === FALLBACK_SESSION_NAME
        ? existing.custom_name
        : derivedName;

    return sessionsDb.createSession(
      sessionId,
      this.provider,
      projectPath,
      sessionName,
      timestamps.createdAt,
      timestamps.updatedAt,
      logPath,
    );
  }

  /**
   * Derives a session title from the first user message in a DSH session log.
   */
  private async extractSessionName(logPath: string): Promise<string | undefined> {
    try {
      const buffer = await fsp.readFile(logPath);
      const text = decodeZstdFrames(buffer);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
          continue;
        }
        let event: AnyRecord;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type !== 'user/message') {
          continue;
        }
        // Skip injected context events; only the real user prompt titles a session.
        const source = (event.data as AnyRecord | null)?.source as AnyRecord | null;
        if (source?.kind && source.kind !== 'user') {
          continue;
        }
        const content = extractText(event.data?.content);
        if (content) {
          return content;
        }
      }
    } catch {
      // Corrupt or unreadable logs produce no title; the fallback is used.
    }
    return undefined;
  }
}
