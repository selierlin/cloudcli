import type { SessionAttentionLevel } from '@/shared/types';

/**
 * The single strongest state found across a project's sessions — one channel,
 * not two.
 *
 * The session rows draw activity and attention as separate slots because they
 * sit at opposite ends of a wide row. A collapsed project row has no such room
 * and answers one question at a time ("which project wants me?"), so the four
 * states are ranked instead of composed: `action` > `notice` > activity.
 * Within activity a response in flight outranks background-only work, matching
 * the row rule. Foreground work is included even though §4's table only names
 * background — a project whose session is mid-response is the same "it is
 * doing something" signal, and silently dropping it would be a worse lie than
 * the one the table was written to prevent.
 */
export type ProjectAggregate =
  | { kind: 'action'; count: number }
  | { kind: 'notice' }
  | { kind: 'foreground' }
  | { kind: 'background' };

/**
 * Ranks a project's loaded sessions into the one indicator its row draws.
 *
 * Only the sessions passed in are considered, and in practice those are the
 * project's loaded page (`sessionMeta.hasMore` says more exist). A session
 * fixed by an event but not yet loaded contributes nothing — the incomplete
 * aggregation §4 通道 D accepts, and the reason the count is "sessions I can
 * see wanting you", not "every session in the folder".
 */
export function deriveProjectAggregate(
  sessions: ReadonlyArray<{ id: string }>,
  activeSessionIds: ReadonlySet<string>,
  backgroundSessionIds: ReadonlySet<string>,
  attentionSessions: ReadonlyMap<string, SessionAttentionLevel>,
): ProjectAggregate | null {
  let actionCount = 0;
  let hasNotice = false;
  let hasForeground = false;
  let hasBackground = false;

  for (const session of sessions) {
    const level = attentionSessions.get(session.id);
    if (level === 'action') {
      actionCount += 1;
    } else if (level === 'notice') {
      hasNotice = true;
    }

    if (activeSessionIds.has(session.id)) {
      if (backgroundSessionIds.has(session.id)) {
        hasBackground = true;
      } else {
        hasForeground = true;
      }
    }
  }

  if (actionCount > 0) {
    return { kind: 'action', count: actionCount };
  }
  if (hasNotice) {
    return { kind: 'notice' };
  }
  if (hasForeground) {
    return { kind: 'foreground' };
  }
  if (hasBackground) {
    return { kind: 'background' };
  }
  return null;
}
