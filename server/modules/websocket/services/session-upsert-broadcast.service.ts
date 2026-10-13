import path from 'node:path';

import { projectsDb, sessionReadStateDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { isSessionContentUnread } from '@/shared/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { SessionUpsertChange, SessionUpsertedEvent } from '@/shared/types.js';

/**
 * The single producer of the `session_upserted` delta.
 *
 * The event carries everything a sidebar needs to upsert a session in place
 * (its summary plus the owning project's metadata), so clients never refetch
 * the whole project list because one transcript changed on disk.
 *
 * It used to be built in two places — the on-disk sessions watcher and the
 * chat run registry — and only the registry's copy set `providerSessionId`.
 * That field is how the client notices a row it is showing has been merged
 * into its canonical app-session row, so a merge announced by any other path
 * left a stale duplicate in the sidebar. One builder, one shape.
 *
 * Every caller states, per session, whether it is announcing real content or
 * only a metadata refresh — the builder never guesses. The flag is what lets
 * the client keep a bare `touch` from lighting the sidebar's unread capsule.
 */
async function buildSessionUpsertedEvent(
  sessionIdOrProviderSessionId: string,
  change: SessionUpsertChange,
): Promise<SessionUpsertedEvent | null> {
  // Resolving by provider id first covers the watcher, which only ever sees
  // the id written in the transcript. For a row where the two ids are equal
  // — legacy rows, and any session indexed from disk before its mapping
  // existed — both lookups land on the same row anyway.
  const row = sessionsDb.getSessionByProviderSessionId(sessionIdOrProviderSessionId)
    ?? sessionsDb.getSessionById(sessionIdOrProviderSessionId);
  if (!row || row.isArchived) {
    return null;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  // The delta is user-agnostic and this deployment is single-user, so the
  // unread answer is computed for the sole user — the same rule the project
  // list applies, so a row upserted in place never disagrees with a refetch.
  const soleUserId = userDb.getFirstUser()?.id;
  const lastSeenAt = soleUserId === undefined
    ? null
    : sessionReadStateDb.getReadStateForSession(soleUserId, row.session_id);

  return {
    kind: 'session_upserted',
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id ?? null,
    // The column is a plain TEXT and typed as `string` on the row, but only
    // provider adapters ever write it.
    provider: row.provider as SessionUpsertedEvent['provider'],
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
      contentUpdatedAt: row.content_updated_at ?? null,
      isUnread: isSessionContentUnread(row.content_updated_at ?? null, lastSeenAt),
      change,
      parentSessionId: row.parent_session_id ?? null,
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  };
}

function sendToConnectedClients(payloads: string[]): void {
  if (payloads.length === 0) {
    return;
  }

  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      for (const payload of payloads) {
        client.send(payload);
      }
    }
  });
}

/**
 * Stamps the centralized fallback content timestamp for a genuine content
 * event whose provider supplied none.
 *
 * A provider that cannot tell its content timestamp leaves
 * `sessions.content_updated_at` null, and a null version is never unread. Both
 * content producers funnel their delta through this module, so the fallback —
 * "a content event happened now, so the version is now" — belongs here rather
 * than in every provider. Only `content` qualifies: a `metadata` refresh (a
 * title change, a fork, a bare `touch`) must not move the version. The
 * repository fills the column only when it is null, so a precise value from a
 * provider that has one wins.
 */
function stampFallbackContentTimestamp(entry: { sessionId: string; change: SessionUpsertChange }): void {
  if (entry.change !== 'content') {
    return;
  }

  sessionsDb.backfillContentUpdatedAt(entry.sessionId, new Date().toISOString());
}

/** Announces one session. Used by the chat run registry when a run reports its provider-native id. */
export async function broadcastSessionUpserted(
  sessionIdOrProviderSessionId: string,
  change: SessionUpsertChange,
): Promise<void> {
  stampFallbackContentTimestamp({ sessionId: sessionIdOrProviderSessionId, change });
  const event = await buildSessionUpsertedEvent(sessionIdOrProviderSessionId, change);
  if (event) {
    sendToConnectedClients([JSON.stringify(event)]);
  }
}

/**
 * Announces a batch of sessions. Used by the providers module's sessions
 * watcher, whose debounced flush can carry dozens of ids at once — the client
 * set is walked once for the whole batch rather than once per session.
 *
 * Each entry carries its own change classification: one flush can mix a
 * genuinely appended transcript with a file that was only touched.
 */
export async function broadcastSessionUpsertedBatch(
  entries: Iterable<{ sessionId: string; change: SessionUpsertChange }>,
): Promise<void> {
  const payloads: string[] = [];
  for (const { sessionId, change } of entries) {
    stampFallbackContentTimestamp({ sessionId, change });
    const event = await buildSessionUpsertedEvent(sessionId, change);
    if (event) {
      payloads.push(JSON.stringify(event));
    }
  }

  sendToConnectedClients(payloads);
}

/** @internal Exported for the broadcast tests, which assert the payload shape directly. */
export { buildSessionUpsertedEvent };
