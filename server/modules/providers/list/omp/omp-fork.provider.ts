import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';

import { resolveOmpTranscriptPath } from '@/modules/providers/list/omp/omp-sessions.provider.js';
import type { IProviderFork } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError, readObjectRecord } from '@/shared/utils.js';

/** One non-empty transcript line, kept both raw and parsed. */
type TranscriptLine = { raw: string; data: AnyRecord };

/** Parses the JSONL transcript, dropping blank and malformed rows. */
function parseTranscript(text: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const data = readObjectRecord(parsed);
    if (data) {
      lines.push({ raw: line, data });
    }
  }
  return lines;
}

/**
 * Walks OMP's active branch and keeps the prefix up to and including
 * `anchorId` (the whole branch when omitted).
 *
 * OMP writes entries as a single-parent chain, so the branch the user is
 * looking at is the one reached from the file's last entry up its `parentId`
 * links. Rebuilding that path — rather than slicing the raw file — is what
 * drops entries from abandoned branches, which sit in the file but are not part
 * of the conversation a fork should inherit.
 *
 * The cut is inclusive of the anchor, matching the contract Claude, Codex and
 * WorkBuddy honour.
 */
export function selectOmpForkBranch(
  body: TranscriptLine[],
  anchorId: string | undefined,
): TranscriptLine[] {
  const byId = new Map<string, TranscriptLine>();
  for (const line of body) {
    if (typeof line.data.id === 'string') {
      byId.set(line.data.id, line);
    }
  }

  const branch: TranscriptLine[] = [];
  const seen = new Set<string>();
  let cursor: unknown = body[body.length - 1]?.data.id;
  while (typeof cursor === 'string' && !seen.has(cursor)) {
    const line = byId.get(cursor);
    if (!line) {
      break;
    }
    seen.add(cursor);
    branch.push(line);
    cursor = line.data.parentId;
  }
  branch.reverse();

  if (anchorId === undefined) {
    return branch;
  }
  const index = branch.findIndex((line) => line.data.id === anchorId);
  if (index < 0) {
    throw new AppError('That message is no longer in the session.', {
      code: 'FORK_ANCHOR_NOT_FOUND',
      statusCode: 409,
    });
  }
  return branch.slice(0, index + 1);
}

/**
 * Builds the child transcript for one fork.
 *
 * The `title` slot OMP writes as the first line is a fixed-width row it
 * rewrites in place, so it is copied byte-for-byte rather than re-serialized —
 * a shorter line would break the in-place rewrite. Only the session header is
 * rewritten, to carry the new session id. Entries are emitted with their
 * original bytes so nothing else in the transcript drifts.
 */
export function buildOmpForkTranscript(
  sourceText: string,
  options: { newSessionId: string; upToAnchorId?: string },
): string {
  const lines = parseTranscript(sourceText);
  const title = lines.find((line) => line.data.type === 'title');
  const header = lines.find((line) => line.data.type === 'session');
  if (!header) {
    throw new AppError('The OMP session header is missing from the transcript.', {
      code: 'FORK_SOURCE_UNREADABLE',
      statusCode: 409,
    });
  }

  const body = lines.filter((line) => line !== title && line !== header);
  const kept = selectOmpForkBranch(body, options.upToAnchorId);

  const out: string[] = [];
  if (title) {
    out.push(title.raw);
  }
  out.push(JSON.stringify({ ...header.data, id: options.newSessionId }));
  for (const line of kept) {
    out.push(line.raw);
  }
  return `${out.join('\n')}\n`;
}

/** Formats an OMP transcript filename stamp (`2026-10-04T08-36-26-427Z`). */
export function ompTranscriptStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Branches an OMP conversation into an independent session.
 *
 * OMP ships no `--fork` the CLI can drive headlessly, but a session is a
 * self-contained JSONL file the CLI loads by `<sessions>/--<cwd>--/<stamp>_<id>.jsonl`.
 * A fork is therefore a real copy: the active branch up to the anchor is
 * written beside the source under a fresh session id, and the next `--session
 * <id>` run finds and appends to it like any other session.
 */
export class OmpForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    // `title` is deliberately not forwarded: the sidebar name lives in this
    // app's session row, and the transcript's own title slot is left as the
    // source wrote it.
    const sourcePath = await this.resolveSource(input);
    const sourceText = await this.readSource(sourcePath);

    const providerSessionId = randomUUID();
    const transcript = buildOmpForkTranscript(sourceText, {
      newSessionId: providerSessionId,
      upToAnchorId: input.upToAnchorId,
    });

    // Written beside the source: OMP buckets sessions by a realpath-encoded
    // cwd, and re-deriving that encoding here would be a second source of truth
    // for the one thing that decides where the CLI looks for the fork.
    const targetPath = path.join(
      path.dirname(sourcePath),
      `${ompTranscriptStamp(new Date())}_${providerSessionId}.jsonl`,
    );
    await fsp.writeFile(targetPath, transcript, 'utf8');
    return { providerSessionId, jsonlPath: targetPath };
  }

  private async resolveSource(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
  }): Promise<string> {
    const fromRow = input.jsonlPath && existsSync(input.jsonlPath) ? input.jsonlPath : null;
    const sourcePath = fromRow
      ?? await resolveOmpTranscriptPath(input.providerSessionId, input.projectPath);
    if (!sourcePath) {
      throw new AppError('The OMP transcript for this session could not be found.', {
        code: 'FORK_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }
    return sourcePath;
  }

  private async readSource(sourcePath: string): Promise<string> {
    try {
      return await fsp.readFile(sourcePath, 'utf8');
    } catch {
      throw new AppError('The OMP transcript for this session could not be read.', {
        code: 'FORK_SOURCE_UNREADABLE',
        statusCode: 409,
      });
    }
  }
}
