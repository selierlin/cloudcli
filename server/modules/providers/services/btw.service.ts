import { randomUUID } from 'node:crypto';

import {
  abandonEphemeralFork,
  registerEphemeralFork,
  retireProviderSession,
  sessionsDb,
  settleEphemeralFork,
} from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { broadcastSessionRemoved, broadcastSessionUpserted, chatRunRegistry } from '@/modules/websocket/index.js';
import type { BackgroundTaskSummary, LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The "ask aside" (btw) flow: fork a session into a hidden copy, let the user
 * talk to it, and reclaim it on close.
 *
 * Consumers: the Providers HTTP routes (`/sessions/:id/btw` and its `promote`
 * sibling) and the startup/periodic cleanup started by the server entrypoint.
 *
 * The copy is a real session — real provider transcript, real tools — whose only
 * difference is the `is_ephemeral` flag. Everything visible (sidebar, search,
 * counts, websocket upserts) filters on that flag, which is why this module
 * never needs a second concept of "temporary conversation".
 */

/** How long a run may take to unwind after an abort before we refuse to delete. */
const QUIESCE_TIMEOUT_MS = 5_000;

/** How often the quiesce loop re-checks a run or a background task. */
const QUIESCE_POLL_MS = 100;

/** Empty aside sessions are abandoned by the sweep once this old. */
const STALE_EPHEMERAL_MS = 6 * 60 * 60 * 1_000;

type BtwAnchor = {
  /** The value handed to the provider fork; null means "fork everything". */
  forkAnchorId: string | null;
  /** The transcript message the user sees the aside starting after, if known. */
  messageId: string | null;
  /** True when the provider can only honor a coarser boundary than the message. */
  degraded: boolean;
};

type BtwSessionResult = {
  sessionId: string;
  provider: LLMProvider;
  projectPath: string;
  sessionName: string;
  anchorForkId: string | null;
  anchorMessageId: string | null;
  anchorDegraded: boolean;
  anchorSource: 'default' | 'explicit';
};

/**
 * Creates a hidden fork of `sourceSessionId`, anchored where the user asked.
 *
 * The row is inserted before the provider fork runs (see
 * `createPendingEphemeralSession`): a crash between the two leaves a hidden row
 * the cleanup can find, rather than a transcript the watcher would index as a
 * normal session.
 */
async function createBtwSession(
  sourceSessionId: string,
  options: {
    anchorForkId?: string;
    anchorMessageId?: string;
    title?: string;
  } = {},
): Promise<BtwSessionResult> {
  const source = sessionsDb.getSessionById(sourceSessionId);
  if (!source) {
    throw new AppError(`Session "${sourceSessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  const provider = source.provider as LLMProvider;
  const fork = providerRegistry.resolveProvider(provider).fork;
  if (!fork) {
    throw new AppError(`Sessions cannot be forked for provider "${provider}".`, {
      code: 'FORK_NOT_SUPPORTED',
      statusCode: 409,
    });
  }

  // An aside session cannot host another aside: the copy would be as invisible
  // as its parent, and closing the outer drawer would orphan it.
  if (source.is_ephemeral) {
    throw new AppError('An aside session cannot be used as the source of another aside.', {
      code: 'FORK_SOURCE_NOT_READY',
      statusCode: 409,
    });
  }

  if (!source.provider_session_id) {
    throw new AppError('This session has not produced a transcript yet.', {
      code: 'FORK_SOURCE_NOT_READY',
      statusCode: 409,
    });
  }

  const explicitAnchor = Boolean(options.anchorForkId || options.anchorMessageId);
  const anchor = await resolveBtwAnchor(sourceSessionId, provider, options);

  const sessionName = options.title?.trim()
    || `${source.custom_name?.trim() || 'Session'} (btw)`;
  const projectPath = source.project_path ?? '';
  const placeholderSessionId = randomUUID();

  sessionsDb.createPendingEphemeralSession({
    sessionId: placeholderSessionId,
    provider,
    projectPath,
    customName: sessionName,
    nameSource: options.title?.trim() ? 'manual_rename' : 'fork',
    forkedFromSessionId: sourceSessionId,
    // A copy that silently fell back to the catalog defaults would answer
    // differently from the conversation it branched from.
    model: source.model,
    effort: source.effort,
  });

  // Registered after the placeholder exists and before the provider writes its
  // transcript: any watcher insert inside this window belongs to this fork.
  registerEphemeralFork(projectPath, placeholderSessionId);

  try {
    const forked = await fork.forkSession({
      providerSessionId: source.provider_session_id,
      jsonlPath: source.jsonl_path,
      projectPath,
      upToAnchorId: anchor.forkAnchorId ?? undefined,
      title: sessionName,
    });

    sessionsDb.completeForkedSession({
      sessionId: placeholderSessionId,
      providerSessionId: forked.providerSessionId,
      jsonlPath: forked.jsonlPath,
    });
    settleEphemeralFork(projectPath, placeholderSessionId, forked.providerSessionId);
  } catch (error) {
    abandonEphemeralFork(projectPath, placeholderSessionId);
    // The placeholder may hold nothing the provider ever wrote, so dropping it
    // is always safe; a transcript that did get written stays on disk and is
    // re-indexed as a normal session rather than silently disappearing.
    sessionsDb.deleteSessionById(placeholderSessionId);
    throw error;
  }

  return {
    sessionId: placeholderSessionId,
    provider,
    projectPath,
    sessionName,
    anchorForkId: anchor.forkAnchorId,
    anchorMessageId: anchor.messageId,
    anchorDegraded: anchor.degraded,
    anchorSource: explicitAnchor ? 'explicit' : 'default',
  };
}

/**
 * Resolves which provider anchor the copy starts from.
 *
 * The requested row is a cursor into the conversation, not the cut itself: the
 * cut is moved to the end of that row's turn (see `advanceToTurnEnd`), so the
 * copy never holds a question the source already answered. The request carries
 * the provider's own anchor id rather than a display id, because some providers
 * synthesize ids per read and the two are not interchangeable.
 */
async function resolveBtwAnchor(
  sessionId: string,
  provider: LLMProvider,
  options: { anchorForkId?: string; anchorMessageId?: string },
): Promise<BtwAnchor> {
  // zcode's fork refuses any anchor that has a workspace checkpoint after it,
  // which is every turn that touched files — including, usually, the last one.
  // Forking the whole conversation (no anchor) never trips that guard, so the
  // default path deliberately sends nothing.
  if (provider === 'zcode' && !options.anchorForkId && !options.anchorMessageId) {
    const lastMessageId = await readLastMessageId(sessionId);
    return { forkAnchorId: null, messageId: lastMessageId, degraded: true };
  }

  const history = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
  const cuttable = history.messages.filter(isCuttableMessage);

  if (options.anchorForkId) {
    const index = history.messages.findIndex(
      (message) => isCuttableMessage(message) && message.forkAnchorId === options.anchorForkId,
    );
    if (index < 0) {
      throw new AppError('That message is not a valid aside anchor.', {
        code: 'BTW_ANCHOR_INVALID',
        statusCode: 400,
      });
    }
    return toAnchor(advanceToTurnEnd(history.messages, index), provider);
  }

  if (options.anchorMessageId) {
    const index = history.messages.findIndex(
      (message) => isCuttableMessage(message) && message.id === options.anchorMessageId,
    );
    if (index < 0) {
      throw new AppError('That message is not a valid aside anchor.', {
        code: 'BTW_ANCHOR_INVALID',
        statusCode: 400,
      });
    }
    return toAnchor(advanceToTurnEnd(history.messages, index), provider);
  }

  // The default cut is the newest reply, because a reply row is the end of the
  // turn it belongs to. A trailing prompt is the exception: that turn is still
  // waiting for its answer (the drawer allows asking while the source is
  // mid-turn), so it ends nothing, and forking there hands the copy a question
  // the source never answered — pi and omp answer it a second time, Claude
  // refuses with a placeholder. Cut at the newest reply instead.
  const last = cuttable[cuttable.length - 1];
  if (!last) {
    throw new AppError('This session has no message that can anchor an aside.', {
      code: 'BTW_ANCHOR_INVALID',
      statusCode: 400,
    });
  }
  if (last.role === 'user') {
    const latestReply = [...cuttable].reverse().find((message) => message.role === 'assistant');
    if (!latestReply) {
      throw new AppError('This session has no reply that can anchor an aside.', {
        code: 'BTW_ANCHOR_INVALID',
        statusCode: 400,
      });
    }
    return toAnchor(latestReply, provider);
  }
  return toAnchor(last, provider);
}

/**
 * Reclaims one aside copy: stop whatever it is still doing, then delete the
 * row, the provider store entry and the transcript.
 *
 * Order matters more than it looks. A run or a background task left alive keeps
 * appending to the transcript after the file is unlinked, which recreates it and
 * lets the watcher index the copy back as a *visible* session. Both kinds of
 * busy have to be handled: `chat.abort` cannot stop a task that outlived its
 * turn, and `chat.stop-task` has nothing to stop while a turn is running.
 */
async function destroyBtwSession(sessionId: string): Promise<{ sessionId: string }> {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!session.is_ephemeral) {
    // The only guard that protects a real conversation from a frontend id mix-up.
    throw new AppError('That session is not an aside session.', {
      code: 'NOT_EPHEMERAL',
      statusCode: 403,
    });
  }

  await quiesceBtwSession(sessionId, session.provider as LLMProvider);

  if (session.provider_session_id) {
    // Blocks a watcher pass that already read the transcript from inserting the
    // row again after the delete.
    retireProviderSession(session.provider_session_id);
  }

  await sessionsService.deleteOrArchiveSessionById(sessionId, {
    force: true,
    deletedFromDisk: true,
  });

  // Idempotent second delete: an upsert that landed between the file removal and
  // the row removal leaves a row behind, and this is cheaper than a tombstone
  // table. A false return means the row is already gone, which is the goal.
  sessionsDb.deleteSessionById(sessionId);

  return { sessionId };
}

/**
 * Promotes an aside copy into a normal, visible conversation.
 *
 * The row keeps its `updated_at` so it lands where it was created in the
 * sidebar rather than jumping to the top; a broadcast at metadata level tells
 * other clients to list it without flagging it unread.
 */
function promoteBtwSession(sessionId: string, title?: string): { sessionId: string; sessionName: string } {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    throw new AppError(`Session "${sessionId}" was not found.`, {
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (!session.is_ephemeral) {
    throw new AppError('That session is not an aside session.', {
      code: 'NOT_EPHEMERAL',
      statusCode: 403,
    });
  }

  // The copy already carries the ` (btw)` suffix the create gave it, so a
  // titleless promotion reuses that name instead of appending a second one.
  const sessionName = (title ?? '').trim() || session.custom_name?.trim() || 'Session';
  if (sessionName.length > 120) {
    throw new AppError('Session titles cannot be longer than 120 characters.', {
      code: 'BTW_TITLE_INVALID',
      statusCode: 400,
    });
  }

  sessionsDb.promoteEphemeralSession(sessionId, sessionName);

  // `metadata`, not `content`: the content level writes `content_updated_at`,
  // which every client reads as "a new message arrived" and would light up the
  // unread badge for a rename.
  void broadcastSessionUpserted(sessionId, 'metadata');

  return { sessionId, sessionName };
}

/**
 * Reclaims aside copies that outlived their drawer (refresh, crash, a lost
 * DELETE).
 *
 * `staleOnly` distinguishes the two callers: startup reclaims everything left
 * over (nothing can still be watching it), while the periodic sweep only takes
 * copies untouched for six hours so a drawer open overnight is not deleted out
 * from under the user.
 */
async function reclaimEphemeralSessions(options: { staleOnly: boolean } = { staleOnly: false }): Promise<number> {
  const rows = sessionsDb.listEphemeralSessions();
  let reclaimed = 0;

  for (const row of rows) {
    if (options.staleOnly) {
      const updatedAt = Date.parse(row.updated_at);
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt < STALE_EPHEMERAL_MS) {
        continue;
      }
    }

    try {
      await destroyBtwSession(row.session_id);
      // A drawer can still be showing this copy (the sweep only takes copies a
      // restart or six idle hours produced), and its id is held in React state
      // with no other way to learn the row is gone.
      broadcastSessionRemoved(row.session_id);
      reclaimed += 1;
    } catch (error) {
      // One stuck copy (a task that will not stop) must not abort the sweep; the
      // next pass retries it.
      console.error('[btw] Failed to reclaim an aside session', {
        sessionId: row.session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return reclaimed;
}

/**
 * Waits until a run and every background task of the session have stopped,
 * aborting/stopping them first.
 *
 * Throws 409 rather than deleting: an unresolved run would keep writing to the
 * transcript after the delete, and the caller (the drawer) needs to keep the
 * copy observable so the user can retry or stop it manually.
 */
async function quiesceBtwSession(sessionId: string, provider: LLMProvider): Promise<void> {
  const run = chatRunRegistry.getRun(sessionId);
  if (run?.status === 'running') {
    const aborted = await providerRuntimeService.abort(provider, sessionId);
    chatRunRegistry.completeRun(sessionId, {
      exitCode: aborted ? 0 : 1,
      aborted: true,
    });
  }

  const runStopped = await waitFor(
    () => chatRunRegistry.getRun(sessionId)?.status !== 'running',
  );
  if (!runStopped) {
    throw new AppError('The aside session is still finishing its turn.', {
      code: 'BTW_STILL_RUNNING',
      statusCode: 409,
    });
  }

  const tasks = listBackgroundTasks(sessionId);
  for (const task of tasks) {
    await providerRuntimeService.stopBackgroundTask(provider, sessionId, task.taskId);
  }

  if (tasks.length > 0) {
    const tasksStopped = await waitFor(() => !providerRuntimeService.hasBackgroundWork(sessionId));
    if (!tasksStopped) {
      throw new AppError('The aside session still has background work running.', {
        code: 'BTW_STILL_RUNNING',
        statusCode: 409,
      });
    }
  }
}

/** Collects the session's outstanding background work from its provider runtime. */
function listBackgroundTasks(sessionId: string): BackgroundTaskSummary[] {
  return providerRegistry
    .listProviders()
    .flatMap((provider) =>
      (provider.runtime.listBackgroundWork?.() ?? [])
        .filter((entry) => entry.sessionId === sessionId)
        .flatMap((entry) => entry.tasks),
    );
}

/** Polls `check` until it answers true or the quiesce budget runs out. */
async function waitFor(check: () => boolean): Promise<boolean> {
  const deadline = Date.now() + QUIESCE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, QUIESCE_POLL_MS));
  }
  return check();
}

/**
 * True for a row a fork may cut at: a text message that owns a provider anchor.
 *
 * Tool rows are excluded even though several providers stamp them too: a call
 * whose result has not landed is mid-turn, and a copy that stops between the
 * two is a transcript the provider may refuse to resume.
 */
function isCuttableMessage(message: NormalizedMessage): boolean {
  return (
    (message.role === 'user' || message.role === 'assistant')
    && message.kind === 'text'
    && Boolean(message.forkAnchorId)
  );
}

/**
 * Moves the cut to the last text row of the turn `index` belongs to.
 *
 * Cutting at the prompt itself leaves the copy holding a question nobody
 * answered, and the provider reads that as an outstanding request: pi and omp
 * answer it again beside the aside's own question, and Claude replies with a
 * placeholder refusal ("No response requested."). Ending on the turn's last
 * reply keeps the exchange whole and gives the aside the context it branched
 * from — which is also what the reader means by "ask from here".
 */
function advanceToTurnEnd(messages: NormalizedMessage[], index: number): NormalizedMessage {
  let cut = messages[index];
  for (let next = index + 1; next < messages.length; next += 1) {
    const message = messages[next];
    if (startsUserTurn(message)) {
      break;
    }
    if (isCuttableMessage(message)) {
      cut = message;
    }
  }
  return cut;
}

/** True for the prompt row that opens the next turn. */
function startsUserTurn(message: NormalizedMessage): boolean {
  return message.role === 'user' && message.kind === 'text' && !message.isCompactSummary;
}

/**
 * codex's anchor is a turn id, so asking for a specific user message still
 * forks at the end of that turn — reported rather than silently rounded.
 */
function toAnchor(message: NormalizedMessage, provider: LLMProvider): BtwAnchor {
  return {
    forkAnchorId: message.forkAnchorId ?? null,
    messageId: message.id,
    degraded: provider === 'codex',
  };
}

/** Last message id, used only to describe zcode's "fork everything" default. */
async function readLastMessageId(sessionId: string): Promise<string | null> {
  try {
    const history = await sessionsService.fetchHistory(sessionId, { limit: null, offset: 0 });
    return history.messages.at(-1)?.id ?? null;
  } catch {
    return null;
  }
}

export const btwService = {
  createBtwSession,
  destroyBtwSession,
  promoteBtwSession,
  reclaimEphemeralSessions,
};
