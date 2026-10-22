/**
 * Maps a failed side-question request to the line the drawer shows.
 *
 * The codes are produced by `server/modules/providers/services/btw.service.ts`
 * and cross the wire as bare strings, so an unknown code falls back to the
 * generic wording rather than rendering a raw token.
 */
const MESSAGES: Record<string, string> = {
  BTW_ANCHOR_INVALID: 'sideAsk.errors.anchorInvalid',
  NOT_EPHEMERAL: 'sideAsk.errors.notEphemeral',
  BTW_TITLE_INVALID: 'sideAsk.errors.titleInvalid',
  BTW_STILL_RUNNING: 'sideAsk.errors.stillRunning',
  SESSION_NOT_FOUND: 'sideAsk.errors.sessionNotFound',
  FORK_NOT_SUPPORTED: 'sideAsk.errors.forkNotSupported',
  FORK_SOURCE_NOT_READY: 'sideAsk.errors.sourceNotReady',
};

/** Picks the message key for a refused or failed side-question request. */
export function btwFailureMessageKey(code: unknown): string {
  return (typeof code === 'string' && MESSAGES[code]) || 'sideAsk.errors.generic';
}
