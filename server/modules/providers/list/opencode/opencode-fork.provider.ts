import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import type { IProviderFork } from '@/shared/interfaces.js';
import { AppError, getOpenCodeDatabasePath } from '@/shared/utils.js';
import {
  openCodeSessionClient,
  type OpenCodeSessionClient,
} from '@/modules/providers/list/opencode/opencode-session-client.js';

type MessageIdReader = (providerSessionId: string) => string[];

const readOpenCodeMessageIds: MessageIdReader = (providerSessionId) => {
  const dbPath = getOpenCodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    throw new AppError('The OpenCode session database could not be found.', {
      code: 'FORK_SOURCE_UNREADABLE',
      statusCode: 409,
    });
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    // Same ordering the history reader uses, so "the message after the anchor"
    // matches the conversation the user is looking at.
    const rows = db.prepare(`
      SELECT id
      FROM message
      WHERE session_id = ?
      ORDER BY COALESCE(time_created, 0), id
    `).all(providerSessionId) as { id: string }[];
    return rows.map((row) => row.id);
  } finally {
    db.close();
  }
};

/**
 * Resolves the message OpenCode should cut at so the fork keeps the anchor.
 *
 * OpenCode's cut is exclusive — a fork at message N holds everything before N —
 * while the app's contract (Claude, Codex, WorkBuddy) is inclusive of the
 * anchor. Cutting at the anchor's successor reconciles the two, and an anchor
 * that is the last message yields `undefined` (the whole conversation), which is
 * the same answer read inclusively.
 */
export function resolveOpenCodeForkCut(
  orderedMessageIds: string[],
  anchorId: string,
): string | undefined {
  const index = orderedMessageIds.indexOf(anchorId);
  if (index < 0) {
    throw new AppError('That message is no longer in the session.', {
      code: 'FORK_ANCHOR_NOT_FOUND',
      statusCode: 409,
    });
  }
  return orderedMessageIds[index + 1];
}

/**
 * Branches an OpenCode conversation into an independent session.
 *
 * The copy is done by OpenCode's own API, which remaps every message id and
 * gives the fork a title of its own, so the result is a first-class session the
 * CLI resumes like any other. `title` is deliberately not forwarded: the
 * sidebar name lives in this app's session row, and the fork endpoint does not
 * accept a title anyway.
 */
export class OpenCodeForkProvider implements IProviderFork {
  constructor(
    private readonly client: OpenCodeSessionClient = openCodeSessionClient,
    private readonly readMessageIds: MessageIdReader = readOpenCodeMessageIds,
  ) {}

  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: null }> {
    const cutMessageId = input.upToAnchorId
      ? resolveOpenCodeForkCut(this.readMessageIds(input.providerSessionId), input.upToAnchorId)
      : undefined;

    const providerSessionId = await this.client.forkSession({
      providerSessionId: input.providerSessionId,
      messageId: cutMessageId,
    });

    // OpenCode keeps every session in one shared database, so a fork has no
    // artifact of its own — the null, like the source's, is what stops a later
    // delete from taking the whole store with it.
    return { providerSessionId, jsonlPath: null };
  }
}
