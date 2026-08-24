import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';

const FALLBACK_SESSION_NAME = 'Untitled WorkBuddy Session';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * Session indexer for WorkBuddy / CodeBuddy JSONL transcripts.
 *
 * Both the CodeBuddy CLI engine (`~/.codebuddy`) and the WorkBuddy desktop app
 * (`~/.workbuddy`) persist sessions under
 * `projects/<encoded-cwd>/<session-id>.jsonl`, mirroring the Claude Code
 * layout. Session titles come from in-transcript `ai-title` events; the shared
 * `history.jsonl` files carry no `sessionId` field, so they cannot be used to
 * look names up like the Claude synchronizer does.
 */
export class WorkbuddySessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'workbuddy' as const;

  private get sessionRoots(): string[] {
    return [
      path.join(os.homedir(), '.codebuddy', 'projects'),
      path.join(os.homedir(), '.workbuddy', 'projects'),
    ];
  }

  /**
   * Scans both WorkBuddy engine projects roots and upserts discovered sessions
   * into the DB.
   *
   * The scan is intentionally full every time (`since` is ignored): WorkBuddy
   * is a newer provider whose historical transcripts predate any `scan_state`
   * cursor, so an incremental filter would silently hide them. The engine
   * keeps one small JSONL per session, so a full scan stays cheap and
   * `createSession` upserts are idempotent.
   */
  async synchronize(_since?: Date): Promise<number> {
    let processed = 0;
    for (const rootPath of this.sessionRoots) {
      const files = await findFilesRecursivelyCreatedAfter(rootPath, '.jsonl', null);
      for (const filePath of files) {
        if (this.isSubagentTranscript(filePath)) {
          continue;
        }
        const parsed = await this.processSessionFile(filePath);
        if (!parsed) {
          continue;
        }
        const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
          ?? sessionsDb.getSessionById(parsed.sessionId);
        // Archive is the user's explicit "hide" choice; a full re-scan must not
        // resurrect an archived session while its transcript still sits on disk.
        if (existing?.isArchived) {
          continue;
        }
        const timestamps = await readFileTimestamps(filePath);
        sessionsDb.createSession(
          parsed.sessionId,
          this.provider,
          parsed.projectPath,
          this.resolveSessionName(existing?.custom_name ?? null, parsed.sessionName),
          timestamps.createdAt,
          timestamps.updatedAt,
          filePath,
        );
        processed += 1;
      }
    }

    return processed;
  }

  /**
   * Indexes one WorkBuddy transcript triggered by the filesystem watcher.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl') || this.isSubagentTranscript(filePath)) {
      return null;
    }

    const parsed = await this.processSessionFile(filePath);
    if (!parsed) {
      return null;
    }
    const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    // Archive is the user's explicit "hide" choice; a watcher-triggered sync
    // must not resurrect an archived session while its transcript is on disk.
    if (existing?.isArchived) {
      return null;
    }
    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      this.resolveSessionName(existing?.custom_name ?? null, parsed.sessionName),
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
  }

  /**
   * Resolves the on-disk transcript path for one engine session id across both
   * engine roots, so a permanent delete can remove the file even before the
   * watcher indexed the row. Returns null when no transcript exists yet.
   */
  async resolveTranscriptPath(providerSessionId: string, projectPath: string): Promise<string | null> {
    const encodedCwd = this.encodeCwd(projectPath);
    for (const rootPath of this.sessionRoots) {
      const candidate = path.join(rootPath, encodedCwd, `${providerSessionId}.jsonl`);
      try {
        await fsp.access(candidate);
        return candidate;
      } catch {
        // Not in this engine root; try the other one.
      }
    }
    return null;
  }

  /** Mirrors the engine's directory encoding: strip the leading slash, `/` → `-`. */
  private encodeCwd(cwd: string): string {
    return cwd.replace(/^\//, '').replace(/\//g, '-');
  }

  /**
   * Chooses the name to store: keeps the existing real title when the
   * freshly-derived one fell back to the placeholder, so a transient parse
   * failure never renames a known session to "Untitled …".
   */
  private resolveSessionName(existingName: string | null, rawName: string | undefined): string {
    const derivedName = normalizeSessionName(rawName, FALLBACK_SESSION_NAME);
    if (
      existingName
      && existingName !== FALLBACK_SESSION_NAME
      && derivedName === FALLBACK_SESSION_NAME
    ) {
      return existingName;
    }
    return derivedName;
  }

  /**
   * Skips subagent transcripts and tool results that repeat the parent
   * session's id and would otherwise overwrite the main row's jsonl path.
   */
  private isSubagentTranscript(filePath: string): boolean {
    const pathParts = path.normalize(filePath).split(path.sep);
    return pathParts.includes('subagents') || pathParts.includes('tool-results');
  }

  /**
   * Skips transient sessions the WorkBuddy desktop app creates in a fresh
   * `~/WorkBuddy/<yyyy-mm-dd-hh-mm-ss>` scratch directory on every open.
   * Those are throwaway workspaces, not real projects, so their sessions must
   * never surface in the app.
   */
  private isTransientWorkBuddyWorkspace(cwd: string): boolean {
    return /\/WorkBuddy\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(cwd);
  }

  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const sessionId = path.basename(filePath, '.jsonl');
    const parsed = await extractFirstValidJsonlData(filePath, (raw) => {
      const data = raw as AnyRecord | null;
      if (data?.type !== 'message') {
        return null;
      }
      const cwd = typeof data.cwd === 'string' ? data.cwd : undefined;
      if (!cwd) {
        return null;
      }
      if (this.isTransientWorkBuddyWorkspace(cwd)) {
        return null;
      }
      return { cwd };
    });
    if (!parsed) {
      return null;
    }

    const sessionName = await this.extractSessionName(filePath, sessionId);
    return { sessionId, projectPath: parsed.cwd, sessionName };
  }

  /**
   * Reads the newest `ai-title` event from a transcript for its title.
   */
  private async extractSessionName(filePath: string, sessionId: string): Promise<string | undefined> {
    try {
      const content = await fsp.readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const data = parsed as AnyRecord;
        if (
          data.type === 'ai-title'
          && data.sessionId === sessionId
          && typeof data.aiTitle === 'string'
          && data.aiTitle.trim()
        ) {
          return data.aiTitle;
        }
      }
    } catch {
      // Unreadable transcripts produce no title; the fallback is used.
    }

    return undefined;
  }
}
