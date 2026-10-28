import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * How often the user has picked each slash command or skill, keyed by the
 * command's own name. One preference key, synced, so the counts follow the
 * account across devices; the chat composer and the quick-settings Commands tab
 * share it so both surfaces put the same commands on top.
 */

/**
 * Stable fallback for the preference, used both as the read default and as the
 * `getSnapshot` result when nothing has been recorded yet.
 *
 * It has to be a module-level constant rather than a `{}` literal: `getSnapshot`
 * returning a fresh object on every call reads as an endless change and
 * re-renders forever.
 */
export const EMPTY_COMMAND_USAGE: Record<string, number> = {};

export const readCommandUsage = (): Record<string, number> =>
  readUserPreference('commandUsage', EMPTY_COMMAND_USAGE);

/**
 * Counts one pick of `name`.
 *
 * Copy before changing. `readUserPreference` hands back the very object the
 * store holds, and `writeUserPreference` short-circuits when the new value
 * stringifies equal to the old one — so mutating that object in place would
 * make this write a silent no-op: the count would look right in memory but
 * never reach the mirror, the server or the subscribers.
 */
export const recordCommandUsage = (name: string): void => {
  const next = { ...readCommandUsage() };
  next[name] = (next[name] ?? 0) + 1;
  writeUserPreference('commandUsage', next);
};
