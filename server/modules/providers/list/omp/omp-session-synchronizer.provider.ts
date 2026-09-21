import { createReadStream, promises as fsp } from 'node:fs';
import { createInterface } from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { getOmpSessionsRoot } from '@/modules/providers/list/omp/omp-models.provider.js';
import { resolveOmpTranscriptPath } from '@/modules/providers/list/omp/omp-sessions.provider.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import {
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';

const FALLBACK_SESSION_NAME = 'Untitled OMP Session';
const TITLE_HEAD_BYTES = 64 * 1024;

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  sessionNameIsExplicit?: boolean;
};

/**
 * Session indexer for OMP JSONL transcripts.
 *
 * OMP persists sessions under `<sessions>/--<encoded-cwd>--/<ISO时间戳>_<UUID>.jsonl`
 * (or flat inside `PI_CODING_AGENT_SESSION_DIR`). The `session` header line
 * carries the UUID and working directory; the `title` line above it carries the
 * CLI's own auto-generated session title, which is rewritten in place. Titles
 * fall back to the first real user prompt. Files are matched by their
 * `_<UUID>.jsonl` suffix so the provider session id is stable regardless of the
 * timestamp prefix.
 */
export class OmpSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'omp' as const;
  private hasCompletedInitialScan = false;

  private get sessionRoot(): string {
    return getOmpSessionsRoot();
  }

  /**
   * Scans OMP's sessions root and upserts discovered sessions into the DB.
   *
   * The first scan is full because OMP transcripts can predate the persisted
   * global scan cursor. Once that backfill succeeds, later scans use the
   * orchestration cursor and avoid walking unchanged transcripts again.
   */
  async synchronize(since?: Date): Promise<number> {
    let processed = 0;
    const scanSince = this.hasCompletedInitialScan ? (since ?? null) : null;
    const files = await findFilesRecursivelyCreatedAfter(this.sessionRoot, '.jsonl', scanSince);
    for (const filePath of files) {
      processed += await this.upsertFile(filePath);
    }

    this.hasCompletedInitialScan = true;
    return processed;
  }

  /**
   * Indexes one OMP transcript triggered by the filesystem watcher.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }
    return (await this.upsertFile(filePath)) > 0 ? this.lastParsedSessionId : null;
  }

  /**
   * Resolves the on-disk transcript path for one OMP session uuid, so a
   * permanent delete can remove the file even before the watcher indexed the
   * row. Returns null when no transcript exists yet.
   */
  async resolveTranscriptPath(providerSessionId: string, projectPath: string): Promise<string | null> {
    return resolveOmpTranscriptPath(providerSessionId, projectPath);
  }

  private lastParsedSessionId: string | null = null;

  /**
   * Parses an OMP transcript header and upserts the session. Returns 1 when a
   * session was created/updated, 0 when the file carries no header.
   */
  private async upsertFile(filePath: string): Promise<number> {
    const parsed = await this.processSessionFile(filePath);
    if (!parsed) {
      return 0;
    }

    const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    // Archive is the user's explicit "hide" choice; a re-scan must not
    // resurrect an archived session while its transcript still sits on disk.
    if (existing?.isArchived) {
      return 0;
    }

    const timestamps = await readFileTimestamps(filePath);
    sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      this.resolveSessionName(existing?.custom_name ?? null, parsed.sessionName, parsed.sessionNameIsExplicit),
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );
    this.lastParsedSessionId = parsed.sessionId;
    return 1;
  }

  private async processSessionFile(filePath: string): Promise<ParsedSession | null> {
    const header = await extractFirstValidJsonlData(filePath, (raw) => {
      const data = raw as AnyRecord | null;
      if (data?.type !== 'session') {
        return null;
      }
      const sessionId = typeof data.id === 'string' ? data.id.trim() : '';
      const cwd = typeof data.cwd === 'string' ? data.cwd.trim() : '';
      if (!sessionId || !cwd) {
        return null;
      }
      return { sessionId, cwd };
    });
    if (!header) {
      return null;
    }

    const extractedName = await this.extractSessionName(
      filePath,
      !this.hasExistingCustomName(header.sessionId),
    );
    return {
      sessionId: header.sessionId,
      projectPath: header.cwd,
      sessionName: extractedName?.name,
      sessionNameIsExplicit: extractedName?.isExplicit,
    };
  }

  private hasExistingCustomName(sessionId: string): boolean {
    const existing = sessionsDb.getSessionByProviderSessionId(sessionId);
    return Boolean(existing?.custom_name && existing.custom_name !== FALLBACK_SESSION_NAME);
  }

  /**
   * Reads the `title` header OMP auto-generates and falls back to the first
   * real user prompt for transcripts OMP has not titled yet (headless runs can
   * leave the title empty indefinitely).
   *
   * The title lives on the first line, so it is always read — even when the
   * session already has a name — because OMP fills it in asynchronously and a
   * later scan is what upgrades a prompt-derived name to the real title.
   */
  private async extractSessionName(
    filePath: string,
    shouldReadFullPrompt: boolean,
  ): Promise<{ name: string; isExplicit: boolean } | undefined> {
    const title = await this.readTitleHeader(filePath);
    if (title) {
      return { name: title, isExplicit: true };
    }
    if (!shouldReadFullPrompt) {
      return undefined;
    }

    const firstUserPrompt = await this.readFirstUserPrompt(filePath);
    return firstUserPrompt ? { name: firstUserPrompt, isExplicit: false } : undefined;
  }

  /** Reads the CLI-generated title from the transcript's in-place `title` line. */
  private async readTitleHeader(filePath: string): Promise<string | undefined> {
    let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
    try {
      handle = await fsp.open(filePath, 'r');
      const buffer = Buffer.alloc(TITLE_HEAD_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, TITLE_HEAD_BYTES, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n/, 1)[0]?.trim();
      if (!firstLine) {
        return undefined;
      }
      const data = JSON.parse(firstLine) as AnyRecord;
      if (data.type !== 'title' || typeof data.title !== 'string' || !data.title.trim()) {
        return undefined;
      }
      return data.title.trim();
    } catch {
      // A missing or partially written title line simply leaves the name to the
      // prompt-derived fallback.
      return undefined;
    } finally {
      await handle?.close();
    }
  }

  /** Streams the transcript once to find the first real user prompt. */
  private async readFirstUserPrompt(filePath: string): Promise<string | undefined> {
    const fileStream = createReadStream(filePath, { encoding: 'utf8' });
    const lineReader = createInterface({ input: fileStream, crlfDelay: Infinity });
    try {
      for await (const rawLine of lineReader) {
        const line = rawLine.trim();
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
          data.type === 'message'
          && (data.message as AnyRecord | null)?.role === 'user'
        ) {
          const prompt = readUserPrompt(data.message);
          if (prompt) {
            return prompt;
          }
        }
      }
    } catch {
      // Unreadable transcripts produce no title; the fallback is used.
    } finally {
      lineReader.close();
      fileStream.destroy();
    }

    return undefined;
  }

  private resolveSessionName(
    existingName: string | null,
    rawName: string | undefined,
    isExplicit = false,
  ): string {
    if (existingName && existingName !== FALLBACK_SESSION_NAME && !isExplicit) {
      return existingName;
    }
    return normalizeSessionName(rawName, FALLBACK_SESSION_NAME);
  }
}

/** Reads the first text content of an OMP user message (string or blocks). */
function readUserPrompt(message: unknown): string | undefined {
  const record = message as AnyRecord | null;
  if (!record) {
    return undefined;
  }
  const content = record.content;
  if (typeof content === 'string') {
    return content.trim() || undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    const entry = block as AnyRecord | null;
    if (entry?.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
      return entry.text.trim();
    }
  }
  return undefined;
}
