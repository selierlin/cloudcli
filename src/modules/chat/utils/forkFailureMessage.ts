/**
 * The error code ZCode's forking guard refuses with.
 *
 * Mirrors `FORK_WOULD_REWIND_WORKSPACE` in
 * `server/modules/providers/list/zcode/zcode-fork.provider.ts`. It crosses the
 * wire as a bare string, so a typo here would silently fall back to the generic
 * message — the paired test pins the literal.
 */
const WORKSPACE_REWIND_CODE = 'FORK_WOULD_REWIND_WORKSPACE';

/**
 * Picks the message shown when a fork is refused.
 *
 * ZCode's workspace-rewind guard is the only refusal a user can act on — it
 * tells them to branch from a later message — so it gets its own line; every
 * other failure (missing anchor, no transcript, unreadable store, a network
 * error) gets the generic one.
 */
export function forkFailureMessageKey(code: unknown): 'message.forkWorkspaceRewind' | 'message.forkFailed' {
  return code === WORKSPACE_REWIND_CODE ? 'message.forkWorkspaceRewind' : 'message.forkFailed';
}
