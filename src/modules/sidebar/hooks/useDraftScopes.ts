import { useSyncExternalStore } from 'react';

import { getDraftScopesSnapshot, subscribeToChatDrafts } from '@/shared/chatDrafts';

/**
 * The scopes holding unsent input, shared by every session row.
 *
 * A scope is a session id, or `project:<projectId>` for a chat that has not been
 * sent yet; a row checks `has(session.id)`. The snapshot's reference is stable
 * between membership changes (see `getDraftScopesSnapshot`), so typing in one
 * composer does not re-render the whole list.
 */
export function useDraftScopes(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeToChatDrafts, getDraftScopesSnapshot, getDraftScopesSnapshot);
}
