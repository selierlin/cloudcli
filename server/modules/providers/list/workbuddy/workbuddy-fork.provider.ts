import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import type { IProviderFork } from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Branches a WorkBuddy conversation into an independent session by copying its
 * transcript, up to and including `upToAnchorId` when one is given.
 *
 * The CodeBuddy engine cannot cut at a row itself — `--resume` only continues
 * a session at its tip and `--fork-session` copies the whole thing — so the
 * branch is materialised here: keep every row up to the anchor, rewrite the
 * session id so the copy is a session of its own, and the next run resumes it
 * like any other. POC-verified against codebuddy 2.137.1: it resolves a resume
 * by file id, never compares the row `sessionId` to the file name, and accepts
 * a cut at a turn boundary (the last kept row's `parentId`, when set, always
 * points at a kept row, so the chain survives intact).
 */
export class WorkbuddyForkProvider implements IProviderFork {
  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }> {
    const { jsonlPath, upToAnchorId } = input;

    const rows = await this.readRows(jsonlPath);
    const keepCount = this.resolveKeepCount(rows, upToAnchorId);

    // A fork is a session of its own, not a duplicate of the source's id: the
    // engine would resume the wrong transcript otherwise.
    const forkedSessionId = randomUUID();
    const keptRows = rows.slice(0, keepCount).map((row) => {
      if (typeof row.sessionId === 'string') {
        row.sessionId = forkedSessionId;
      }
      return row;
    });

    // The fork lands beside the transcript it was copied from, like Claude's.
    const forkedPath = path.join(path.dirname(jsonlPath), `${forkedSessionId}.jsonl`);
    await fsp.writeFile(forkedPath, `${keptRows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    // Confirmed rather than assumed: the caller is about to write a database
    // row claiming this file exists, and a half-created row would show up in
    // the sidebar as a session that can never be opened.
    try {
      await stat(forkedPath);
    } catch {
      throw new AppError('WorkBuddy reported a fork but wrote no transcript for it.', {
        code: 'FORK_FAILED',
        statusCode: 502,
      });
    }

    return { providerSessionId: forkedSessionId, jsonlPath: forkedPath };
  }

  private async readRows(jsonlPath: string): Promise<AnyRecord[]> {
    let content: string;
    try {
      content = await fsp.readFile(jsonlPath, 'utf8');
    } catch {
      throw new AppError('The WorkBuddy transcript could not be read.', {
        code: 'FORK_SOURCE_UNREADABLE',
        statusCode: 409,
      });
    }

    const rows: AnyRecord[] = [];
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        rows.push(JSON.parse(line) as AnyRecord);
      } catch {
        // A malformed row is not a conversation turn, so a fork made from the
        // rows around it would branch off a transcript we misread.
        throw new AppError('The WorkBuddy transcript contains a malformed row.', {
          code: 'FORK_SOURCE_CORRUPT',
          statusCode: 409,
        });
      }
    }
    return rows;
  }

  private resolveKeepCount(rows: AnyRecord[], upToAnchorId?: string): number {
    if (!upToAnchorId) {
      return rows.length;
    }
    const anchorIndex = rows.findIndex((row) => row.id === upToAnchorId);
    if (anchorIndex < 0) {
      throw new AppError('That message is no longer in the transcript.', {
        code: 'FORK_ANCHOR_NOT_FOUND',
        statusCode: 409,
      });
    }
    // Inclusive of the anchor row — the same cut Claude's `upToMessageId`
    // makes, so forking from an AI reply keeps the reply and the turn it ends.
    return anchorIndex + 1;
  }
}

/**
 * Creates a WorkBuddy transcript prefix for the sessions adapter's edit-rewind
 * path. The adapter owns deciding which row is a safe boundary; this helper
 * owns only the validated artifact materialisation shared with normal forks.
 */
export async function forkWorkbuddyTranscriptPrefix(input: {
  providerSessionId: string;
  jsonlPath: string;
  projectPath: string;
  upToAnchorId: string;
}): Promise<{ providerSessionId: string; jsonlPath: string }> {
  return new WorkbuddyForkProvider().forkSession(input);
}
