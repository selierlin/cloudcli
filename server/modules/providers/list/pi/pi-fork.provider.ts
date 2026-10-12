import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

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
 * Walks Pi's active branch and keeps the prefix up to and including
 * `anchorId` (the whole branch when omitted).
 *
 * Pi writes entries as a single-parent chain (`parentId`), so the branch the
 * user is looking at is the one reached from the file's last entry up its
 * `parentId` links. Rebuilding that path — rather than slicing the raw file —
 * is what drops entries from abandoned branches, which sit in the file but are
 * not part of the conversation a fork should inherit.
 *
 * The cut is inclusive of the anchor, matching the contract Claude, Codex and
 * WorkBuddy honour, and verified against Pi 1.0.0: a copy truncated here keeps
 * the anchor as its `leafId` and the next run appends underneath it.
 */
export function selectPiForkBranch(
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
 * Pi's first line is an ordinary `session` header — unlike OMP it carries no
 * fixed-width slot rewritten in place — so only the header is re-serialised, to
 * carry the new session id. Every kept entry is emitted with its original bytes
 * so nothing else in the transcript drifts.
 */
export function buildPiForkTranscript(
  sourceText: string,
  options: { newSessionId: string; upToAnchorId?: string },
): string {
  const lines = parseTranscript(sourceText);
  const header = lines.find((line) => line.data.type === 'session');
  if (!header) {
    throw new AppError('The Pi session header is missing from the transcript.', {
      code: 'FORK_SOURCE_UNREADABLE',
      statusCode: 409,
    });
  }

  const body = lines.filter((line) => line !== header);
  const kept = selectPiForkBranch(body, options.upToAnchorId);

  const out: string[] = [JSON.stringify({ ...header.data, id: options.newSessionId })];
  for (const line of kept) {
    out.push(line.raw);
  }
  return `${out.join('\n')}\n`;
}

/**
 * Formats a Pi transcript filename stamp (`2026-10-04T08-36-26-427Z`).
 *
 * Pi resolves a session by the `id` inside its header, never by the filename,
 * so this only has to look like a Pi filename to stay consistent with the CLI.
 */
export function piTranscriptStamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Branches a Pi conversation into an independent session.
 *
 * Pi ships a native `--fork`, but it copies the whole session and cannot cut at
 * a message. A Pi session is nonetheless a self-contained JSONL file the CLI
 * loads by its header id, so a fork is materialised here instead: the active
 * branch up to the anchor is written beside the source under a fresh session
 * id, and the next `--session <id>` run finds and appends to it like any other
 * session.
 */
export class PiForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    // `title` is deliberately not forwarded: the sidebar name lives in this
    // app's session row, and Pi names a session by its own rules.
    const jsonlPath = input.jsonlPath;
    if (!jsonlPath) {
      throw new AppError('The Pi transcript path is missing.', {
        code: 'FORK_SOURCE_NOT_READY',
        statusCode: 409,
      });
    }

    const sourceText = await this.readSource(jsonlPath);
    const providerSessionId = randomUUID();
    const transcript = buildPiForkTranscript(sourceText, {
      newSessionId: providerSessionId,
      upToAnchorId: input.upToAnchorId,
    });

    // Written beside the source: Pi buckets sessions by an encoded cwd, and
    // re-deriving that encoding here would be a second source of truth for the
    // one thing that decides where the CLI looks for the fork.
    const targetPath = path.join(
      path.dirname(jsonlPath),
      `${piTranscriptStamp(new Date())}_${providerSessionId}.jsonl`,
    );
    await fsp.writeFile(targetPath, transcript, 'utf8');
    return { providerSessionId, jsonlPath: targetPath };
  }

  private async readSource(sourcePath: string): Promise<string> {
    try {
      return await fsp.readFile(sourcePath, 'utf8');
    } catch {
      throw new AppError('The Pi transcript for this session could not be read.', {
        code: 'FORK_SOURCE_UNREADABLE',
        statusCode: 409,
      });
    }
  }
}

/**
 * Creates a Pi transcript prefix for the sessions adapter's edit-rewind path.
 * The adapter owns deciding which entry is a safe boundary; this helper owns
 * only the validated artifact materialisation shared with normal forks.
 */
export async function forkPiTranscriptPrefix(input: {
  providerSessionId: string;
  jsonlPath: string;
  projectPath: string;
  upToAnchorId: string;
}): Promise<{ providerSessionId: string; jsonlPath: string }> {
  return new PiForkProvider().forkSession(input);
}
