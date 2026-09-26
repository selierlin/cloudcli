import { api } from '@/shared/api';
import { readUserPreference } from '@/shared/userSettings';
import type { UserThemeEntry } from '@/shared/userThemes';
import { compileUserThemeTokens } from '@/shared/userThemeTokens';
import type { IgnoredThemeEntry } from '@/shared/userThemeTokens';

/**
 * The one user theme stylesheet in the document.
 *
 * A user theme's colours are not in the bundle: they arrive from
 * `/api/themes/<file>` and are injected as a `<style>` element. That element is
 * the whole of the app's runtime-injected styling, so this module owns its
 * lifecycle — the boot-time restore, the swap when the file changes, and the
 * removal when it stops being usable.
 *
 * What arrives is either a stylesheet already (`.css`) or a token JSON that has
 * to become one (`compileThemeSource`); either way, what is injected and cached
 * is the compiled stylesheet, which is what lets the boot-time restore stay a
 * pure synchronous injection.
 *
 * The content is mirrored into localStorage because the fetch is asynchronous
 * and the first paint is not: `applyCachedUserThemeStyle` runs before React
 * mounts and repaints the theme the user is already known to have chosen,
 * instead of showing the default until a request comes back. The listing then
 * confirms whether that cached copy is still the current one.
 *
 * The markup is `<style data-cloudcli-user-theme="<id>">`, appended to `<head>`
 * and never parsed as HTML (§5.8) — the file's text is handed to the CSS parser
 * and nothing else.
 */

const STORAGE_KEY = 'cloudcli.user-theme-style';

/** Marks the injected element so it can be found and replaced without touching the bundle's CSS. */
const STYLE_ELEMENT_ATTRIBUTE = 'data-cloudcli-user-theme';

type CachedStyle = {
  /** The id the stylesheet was loaded for. */
  id: string;
  /** The file's mtime when it was loaded; a different one means the file changed. */
  modifiedAt: number;
  /** The compiled stylesheet — a `.css` file verbatim, a `.json` one compiled. */
  css: string;
};

/** What one file's body is worth: a stylesheet to inject, or a reason it cannot be one. */
type CompiledThemeSource =
  | { ok: true; css: string; ignored: IgnoredThemeEntry[] }
  | { ok: false; message: string; ignored: IgnoredThemeEntry[] };

/**
 * Turns a fetched file body into the stylesheet to inject.
 *
 * `.css` is already one. `.json` is option A and goes through the token
 * compiler, which also decides the appearance scope its overlay is written
 * under. `.tmTheme` is not supported yet — saying so is deliberate: injecting
 * the plist as CSS would put an element in the document that matches nothing,
 * so the picker would show the theme as applied while the page never changed.
 * Refusing it makes the gap visible until the `.tmTheme` slice fills it.
 */
function compileThemeSource(entry: UserThemeEntry, body: string): CompiledThemeSource {
  if (entry.format === 'css') return { ok: true, css: body, ignored: [] };

  if (entry.format === 'json') {
    const compiled = compileUserThemeTokens(entry.id, body);
    if (compiled.ok) return { ok: true, css: compiled.css, ignored: compiled.ignored };
    const detail = compiled.token ? `${compiled.reason} (${compiled.token})` : compiled.reason;
    return {
      ok: false,
      message: `${entry.fileName} is not a usable token JSON: ${detail}`,
      ignored: compiled.ignored,
    };
  }

  return {
    ok: false,
    message: `${entry.fileName} is a .tmTheme file, which this build cannot compile yet; use .css or .json`,
    ignored: [],
  };
}

/** Reports what a file got wrong, in one line per problem, without failing the load. */
function warnIgnored(entry: UserThemeEntry, ignored: IgnoredThemeEntry[]): void {
  if (ignored.length === 0) return;
  console.warn(
    `Theme "${entry.id}" ignored ${ignored.length} declaration(s):`,
    ignored.map(({ what, reason }) => `${what} ${reason}`).join('; '),
  );
}

export type UserThemeStyleState = {
  /** The user theme whose stylesheet is in the document, or null. */
  appliedId: string | null;
  /**
   * The user theme whose stylesheet could not be loaded, or null. The document
   * has fallen back, and this is what lets the picker say so rather than
   * leaving a pick that quietly stopped working.
   */
  failedId: string | null;
};

/** What the currently applied stylesheet was built from, for the "is this still current" check. */
type AppliedStyle = {
  id: string;
  modifiedAt: number;
};

let state: UserThemeStyleState = { appliedId: null, failedId: null };
let applied: AppliedStyle | null = null;

/**
 * Counts apply operations so a slow response for a theme the user has already
 * moved on from cannot land last and win. Every await checks it before touching
 * the document.
 */
let operation = 0;

const listeners = new Set<() => void>();

function publish(next: UserThemeStyleState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readCache(): CachedStyle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { id, modifiedAt, css } = parsed;
    if (typeof id !== 'string' || typeof modifiedAt !== 'number' || typeof css !== 'string') {
      return null;
    }
    return { id, modifiedAt, css };
  } catch {
    return null;
  }
}

function writeCache(cached: CachedStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // A full or unavailable localStorage costs the first-paint optimisation,
    // not the theme — the file is still on the server and is re-read next load.
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the element is what the user sees, and it is removed anyway.
  }
}

function injectedStyles(): HTMLStyleElement[] {
  return [...document.querySelectorAll<HTMLStyleElement>(`style[${STYLE_ELEMENT_ATTRIBUTE}]`)];
}

/**
 * Puts `css` in the document for `id`, replacing whatever element was there.
 *
 * The replacement is appended before the old element is removed, so the new
 * rules are already in effect when the old ones go — the two elements are
 * adjacent in document order, so there is no moment with neither, and no flash
 * of the unthemed page in between.
 */
function injectStyle(id: string, css: string): void {
  const previous = injectedStyles();
  const element = document.createElement('style');
  element.setAttribute(STYLE_ELEMENT_ATTRIBUTE, id);
  element.textContent = css;
  document.head.appendChild(element);
  for (const stale of previous) {
    stale.remove();
  }
}

function removeInjectedStyles(): void {
  for (const stale of injectedStyles()) {
    stale.remove();
  }
}

/**
 * Restores the cached stylesheet before React mounts.
 *
 * Only the theme the user is already known to have picked is restored, and only
 * when the cache was written for that same id — the cache is the evidence that
 * this theme loaded successfully last time, which is all the first paint needs.
 * The listing corrects it afterwards if the file changed or is gone.
 *
 * Called from `main.tsx` rather than on import, so importing this module in a
 * test can never repaint the document.
 */
export function applyCachedUserThemeStyle(): void {
  const cached = readCache();
  if (!cached) return;
  if (readUserPreference<string | null>('themeId', null) !== cached.id) return;

  injectStyle(cached.id, cached.css);
  applied = { id: cached.id, modifiedAt: cached.modifiedAt };
  publish({ appliedId: cached.id, failedId: null });
}

/** The current stylesheet state. Stable between changes, so it can seed React state. */
export function getUserThemeStyleState(): UserThemeStyleState {
  return state;
}

/** Subscribes to stylesheet changes; returns the unsubscribe function. */
export function subscribeToUserThemeStyle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Points the document at one user theme's stylesheet, or at none.
 *
 * `entry` is the listing's entry for the theme the user picked, and `null`
 * whenever there is no such entry. `listingComplete` says whether that absence
 * is evidence: an entry can also be missing because the listing has not arrived
 * or could not be read, and tearing down a working stylesheet on the strength
 * of a request that has not finished — or has failed — would trade a working
 * theme for a fallback nobody asked for.
 *
 * Applying an entry the document already holds for the same mtime is a no-op,
 * which is what keeps a re-listing from re-fetching an unchanged file.
 */
export async function applyUserThemeStyle(
  entry: UserThemeEntry | null,
  listingComplete: boolean,
): Promise<void> {
  if (!entry) {
    // Nothing is wanted, so a response still on its way is already superseded.
    // The counter is bumped before the early returns below: a fetch that lands
    // after the pick changed would otherwise inject the theme the user left.
    operation += 1;

    // Nothing to do when no stylesheet is in the document, none is wanted, and
    // none was refused. A refusal is state too: picking an overlay off the list
    // again is what clears it.
    if (applied === null && state.failedId === null && injectedStyles().length === 0) return;
    if (!listingComplete) return;

    removeInjectedStyles();
    clearCache();
    applied = null;
    publish({ appliedId: null, failedId: null });
    return;
  }

  if (applied?.id === entry.id && applied.modifiedAt === entry.modifiedAt) return;
  // A theme that already failed this session is not retried on every render:
  // the console carries the reason, and a reload is what picks up a fixed file.
  if (state.failedId === entry.id) return;

  const token = ++operation;
  // A newer version of the theme being fetched keeps the version already on
  // screen until the replacement is in hand, so the id stays resolved and
  // nothing downstream — the terminal reads tokens on this id — sees a gap.
  publish({ appliedId: applied?.id ?? null, failedId: null });

  try {
    const response = await api.themes.file(entry.fileName, entry.modifiedAt);
    if (!response.ok) {
      throw new Error(`The theme file request failed with status ${response.status}`);
    }
    const body = await response.text();
    if (token !== operation) return;

    const compiled = compileThemeSource(entry, body);
    warnIgnored(entry, compiled.ignored);
    if (!compiled.ok) throw new Error(compiled.message);

    injectStyle(entry.id, compiled.css);
    writeCache({ id: entry.id, modifiedAt: entry.modifiedAt, css: compiled.css });
    applied = { id: entry.id, modifiedAt: entry.modifiedAt };
    publish({ appliedId: entry.id, failedId: null });
  } catch (error) {
    if (token !== operation) return;

    // The cached copy is what misled the first paint, so it goes with the
    // element — keeping it would restore the same broken theme next load.
    removeInjectedStyles();
    clearCache();
    applied = null;
    publish({ appliedId: null, failedId: entry.id });
    console.warn(`Theme "${entry.id}" could not be loaded; falling back to the default.`, error);
  }
}
