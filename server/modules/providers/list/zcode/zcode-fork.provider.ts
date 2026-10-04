import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import {
  zcodeAppServerClient,
  type ZcodeAppServerClient,
} from '@/modules/providers/list/zcode/zcode-app-server-client.js';
import { getZcodeDatabasePath } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import type { IProviderFork } from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

/** The `session_entry` type ZCode writes when a turn snapshots the workspace. */
export const ZCODE_WORKSPACE_CHECKPOINT_ENTRY = 'runtime/workspace_checkpoint';

/**
 * Explains why a fork at this point is refused.
 *
 * ZCode's `session/fork` restores the workspace checkpoint owned by any turn it
 * discards, so branching mid-conversation can rewrite files the later turns
 * changed. Every other provider's fork copies and nothing else, so this one
 * refuses instead of silently mutating the shared working directory.
 */
const WORKSPACE_REWIND_MESSAGE =
  'Branching here would revert workspace files this conversation changed after that message, '
  + 'because ZCode restores its workspace checkpoint at the fork point. '
  + 'Branch from a later message, or from the end of the conversation.';

/** One message row, reduced to what the fork decision needs. */
export type ZcodeForkMessage = { id: string; timeCreated: number };

/** One workspace checkpoint, reduced to what the fork decision needs. */
export type ZcodeForkCheckpoint = { timeCreated: number };

/** Outcome of {@link planZcodeFork}. */
export type ZcodeForkPlan =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'no-messages' | 'anchor-not-found' | 'workspace-would-rewind' };

/**
 * Decides which message ZCode should fork at, or refuses the fork outright.
 *
 * The requested anchor is used when given, and the last message otherwise
 * (forking the whole conversation). The anchor must exist: the app's contract
 * is inclusive of the message the user acted on, and guessing a neighbour would
 * branch the wrong conversation.
 *
 * The guard is the checkpoint check. ZCode reverts the workspace to the fork
 * point when a discarded turn made its own checkpoint, so any checkpoint newer
 * than the anchor means the fork would rewrite files behind the user's back.
 * Because a discarded turn's checkpoint is always written after that turn's
 * messages — and therefore after the anchor it is dropped with — comparing
 * timestamps catches every rewinding case. An anchor that is the last message
 * drops nothing, so it never trips the guard.
 */
export function planZcodeFork(input: {
  /** Messages in conversation order, oldest first. */
  messages: ReadonlyArray<ZcodeForkMessage>;
  checkpoints: ReadonlyArray<ZcodeForkCheckpoint>;
  requestedAnchorId?: string;
}): ZcodeForkPlan {
  if (input.messages.length === 0) {
    return { ok: false, reason: 'no-messages' };
  }

  const anchor = input.requestedAnchorId === undefined
    ? input.messages[input.messages.length - 1]
    : input.messages.find((message) => message.id === input.requestedAnchorId);
  if (!anchor) {
    return { ok: false, reason: 'anchor-not-found' };
  }

  if (input.checkpoints.some((checkpoint) => checkpoint.timeCreated > anchor.timeCreated)) {
    return { ok: false, reason: 'workspace-would-rewind' };
  }
  return { ok: true, messageId: anchor.id };
}

/** What a fork decision reads out of the ZCode store. */
export type ZcodeForkInputs = {
  /** Messages in conversation order, oldest first. */
  messages: ZcodeForkMessage[];
  checkpoints: ZcodeForkCheckpoint[];
};

/** Reads the message order and workspace checkpoints a fork decision needs. */
function readZcodeForkInputs(providerSessionId: string): ZcodeForkInputs {
  const dbPath = getZcodeDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    throw new AppError('The ZCode session database could not be found.', {
      code: 'FORK_SOURCE_UNREADABLE',
      statusCode: 409,
    });
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('busy_timeout = 2000');
    // Same ordering the history reader uses, so "the last message" is the one
    // the user sees last.
    const messages = db.prepare(`
      SELECT id AS id, COALESCE(time_created, 0) AS timeCreated
      FROM message
      WHERE session_id = ?
      ORDER BY COALESCE(sequence, 0), COALESCE(time_created, 0), id
    `).all(providerSessionId) as ZcodeForkMessage[];

    const checkpoints = db.prepare(`
      SELECT COALESCE(time_created, 0) AS timeCreated
      FROM session_entry
      WHERE session_id = ? AND type = ?
    `).all(providerSessionId, ZCODE_WORKSPACE_CHECKPOINT_ENTRY) as ZcodeForkCheckpoint[];

    return { messages, checkpoints };
  } finally {
    db.close();
  }
}

function forkRefusal(reason: 'no-messages' | 'anchor-not-found' | 'workspace-would-rewind'): AppError {
  if (reason === 'anchor-not-found') {
    return new AppError('That message is no longer in the session.', {
      code: 'FORK_ANCHOR_NOT_FOUND',
      statusCode: 409,
    });
  }
  if (reason === 'no-messages') {
    return new AppError('This session has not produced a transcript yet.', {
      code: 'FORK_SOURCE_NOT_READY',
      statusCode: 409,
    });
  }
  return new AppError(WORKSPACE_REWIND_MESSAGE, {
    code: 'FORK_WOULD_REWIND_WORKSPACE',
    statusCode: 409,
  });
}

/**
 * True when ZCode's own fork report says it put workspace files back.
 *
 * This is a second, independent signal: the fork response reads
 * "Forked session …: copied N messages." when nothing was reverted and appends
 * "and restored N files to the fork point." when it was. The pre-fork guard
 * should make the latter unreachable, so it is checked rather than trusted.
 */
export function reportsWorkspaceRestore(response: string): boolean {
  return /\brestored\b/iu.test(response);
}

/**
 * Branches a ZCode conversation into an independent session.
 *
 * ZCode's own `session/fork` makes the copy through the app-server's
 * `session/fork` call (driven by {@link ZcodeAppServerClient}), so the result is
 * a first-class session the CLI resumes like any other. The `title` is
 * deliberately not forwarded: the sidebar name lives in this app's session row.
 *
 * Before forking, the workspace-rewind guard runs — see {@link planZcodeFork}.
 * The report ZCode returns is then inspected: its "restored N files" clause is a
 * second, independent signal that the guard was too weak, and though the guard
 * should make it unreachable, a regression there must not be silent.
 */
export class ZcodeForkProvider implements IProviderFork {
  constructor(
    private readonly client: ZcodeAppServerClient = zcodeAppServerClient,
    private readonly readInputs: (providerSessionId: string) => ZcodeForkInputs = readZcodeForkInputs,
  ) {}

  async forkSession(input: {
    providerSessionId: string;
    jsonlPath: string | null;
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: null }> {
    const plan = planZcodeFork({
      ...this.readInputs(input.providerSessionId),
      requestedAnchorId: input.upToAnchorId,
    });
    if (!plan.ok) {
      throw forkRefusal(plan.reason);
    }

    const forked = await this.client.forkSession({
      providerSessionId: input.providerSessionId,
      messageId: plan.messageId,
    });

    if (reportsWorkspaceRestore(forked.response)) {
      console.warn('[ZcodeForkProvider] ZCode restored workspace files despite the pre-fork guard', {
        sessionId: input.providerSessionId,
        response: forked.response,
      });
    }

    // ZCode keeps every session in one shared database, so a fork has no
    // artifact of its own — the null, like the source's, is what stops a later
    // delete from taking the whole store with it.
    return { providerSessionId: forked.providerSessionId, jsonlPath: null };
  }
}
