import {
  preferLocalValueOnHydrate,
  writeUserPreference,
} from '@/shared/userSettings';
import { clearAppliedUserThemeStyle } from '@/shared/userThemeStyles';

/**
 * The forced way out of a theme that loaded but left the interface unusable.
 *
 * §5.6 requires one channel that does not go through the UI, because the failure
 * it covers is exactly the one where the UI cannot undo it: a token theme can set
 * `--foreground` and `--background` to the same colour, which leaves the settings
 * page reachable but unreadable, and a pasted theme has no file anywhere to delete
 * from outside the app (§5.4 v3). Three channels were allowed — a global hotkey, a
 * start-up parameter, a URL parameter — and this is the URL one: it needs no
 * keyboard, it takes effect before the first paint, and it is the only one that can
 * be exercised in a test browser.
 *
 * What it drops is the *pick*, not the theme: the entry stays in the list, so the
 * same theme can be selected again once its values are fixed. Clearing the
 * selection is the least destructive thing that puts a usable screen back.
 *
 * **What this does not do**: the self-healing sentinel §5.6 also suggests
 * (`sentinelClass`), which would detect a theme that did not take effect at all.
 * It is not implemented, and the field stays reserved — nothing about option A
 * needs it, because a token theme cannot fail to *parse* on this path without the
 * compiler having said so first. Not implementing it is a decision, not an
 * oversight; the forced channel is the one §5.6 makes mandatory.
 */

/** The query parameter that asks for the theme pick to be dropped. */
export const THEME_RESET_PARAM = 'theme';

/** Its value. `?theme=default` reads as "go back to the default theme". */
export const THEME_RESET_VALUE = 'default';

/** Whether a `location.search` string asks for the theme pick to be dropped. */
export function isThemeResetRequested(search: string): boolean {
  return new URLSearchParams(search).get(THEME_RESET_PARAM) === THEME_RESET_VALUE;
}

/**
 * Applies the reset when the URL asks for it, and reports whether it did.
 *
 * Called at boot, before the theme is restored, so the reset is already in force
 * on the first paint rather than one frame later. The parameter is removed from
 * the URL as it is applied: leaving it there would reset the theme again on every
 * reload, so a user who escaped one bad theme could never keep another.
 *
 * The cleared pick is also made to outrank the server's copy on the coming
 * hydrate — the client has no session yet at this point, so without that the
 * hydrate would put the unusable pick straight back (§5.6).
 */
export function applyThemeResetRequest(): boolean {
  if (!isThemeResetRequested(window.location.search)) return false;

  clearAppliedUserThemeStyle();
  writeUserPreference('themeId', null);
  preferLocalValueOnHydrate('themeId', null);

  const url = new URL(window.location.href);
  url.searchParams.delete(THEME_RESET_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

  console.warn('The theme pick was reset by the ?theme=default parameter; the default theme is in use again.');
  return true;
}
