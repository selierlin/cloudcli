import { api } from '@/shared/api';
import { readUserPreference } from '@/shared/userSettings';
import type { PastedUserTheme } from '@/shared/types';
import { findPastedTheme, isPastedThemeId } from '@/shared/userThemePastes';
import type { UserThemeEntry } from '@/shared/userThemes';
import { compileUserThemeTokens } from '@/shared/userThemeTokens';
import type { IgnoredThemeEntry, UserThemeCompileResult } from '@/shared/userThemeTokens';

/**
 * The one user theme stylesheet in the document.
 *
 * A user theme's colours are not in the bundle: they arrive as text — from
 * `/api/themes/<file>` for a theme file, or from the preference mirror for a
 * pasted one — and are injected as a `<style>` element. That element is the whole
 * of the app's runtime-injected styling, so this module owns its lifecycle: the
 * boot-time restore, the swap when the theme changes, and the removal when it
 * stops being usable.
 *
 * What arrives is either a stylesheet already (`.css`) or a token JSON that has
 * to become one (`compileThemeSource`); either way, what is injected and cached
 * is the compiled stylesheet, which is what lets the boot-time restore stay a
 * pure synchronous injection.
 *
 * The two sources differ in exactly one step — how the text is obtained — and
 * that is why they are one store and not two. Two stores would each keep their
 * own idea of what is applied, and the document can only wear one theme;
 * `UserThemeStyleTarget` is the seam where the difference is confined.
 *
 * The content of a *file* theme is mirrored into localStorage because the fetch
 * is asynchronous and the first paint is not. A pasted theme needs no mirror: its
 * content is already in the preference mirror, so it is compiled during the first
 * paint directly.
 *
 * The markup is `<style data-cloudcli-user-theme="<id>">`, appended to `<head>`
 * and never parsed as HTML (§5.8) — the text is handed to the CSS parser and
 * nothing else.
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

/** What one theme's text is worth: a stylesheet to inject, or a reason it cannot be one. */
type CompiledThemeSource =
  | { ok: true; css: string; ignored: IgnoredThemeEntry[] }
  | { ok: false; message: string; ignored: IgnoredThemeEntry[] };

/**
 * The theme the document should be wearing.
 *
 * The naming mirrors the two storage lines §5.4 v3 keeps apart: `file` is a theme
 * the host serves from `~/.cloudcli/themes`, `paste` is one the user typed in and
 * whose content is already in hand. Everything downstream of `compileThemeSource`
 * treats them identically.
 */
export type UserThemeStyleTarget =
  | { kind: 'file'; entry: UserThemeEntry }
  | { kind: 'paste'; theme: PastedUserTheme };

function targetId(target: UserThemeStyleTarget): string {
  return target.kind === 'file' ? target.entry.id : target.theme.id;
}

/**
 * What the applied stylesheet was built from. A change means a re-apply, and for
 * a theme file it is also the cache-busting `?v=`. For a pasted theme the content
 * *is* the revision: there is no mtime, and comparing the text is both simpler and
 * more accurate than inventing one.
 */
function targetRevision(target: UserThemeStyleTarget): string | number {
  return target.kind === 'file' ? target.entry.modifiedAt : target.theme.content;
}

/** Turns a compiler verdict into the pair this module works with, naming the source on failure. */
function toCompiledSource(label: string, compiled: UserThemeCompileResult): CompiledThemeSource {
  if (compiled.ok) return { ok: true, css: compiled.css, ignored: compiled.ignored };
  const detail = compiled.token ? `${compiled.reason} (${compiled.token})` : compiled.reason;
  return { ok: false, message: `${label} is not a usable token JSON: ${detail}`, ignored: compiled.ignored };
}

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
    return toCompiledSource(entry.fileName, compileUserThemeTokens(entry.id, body));
  }

  return {
    ok: false,
    message: `${entry.fileName} is a .tmTheme file, which this build cannot compile yet; use .css or .json`,
    ignored: [],
  };
}

/** Obtains the stylesheet for a target: read the file, or compile the content already in hand. */
async function loadCompiledSource(target: UserThemeStyleTarget): Promise<CompiledThemeSource> {
  if (target.kind === 'paste') {
    return toCompiledSource(
      `Pasted theme "${target.theme.id}"`,
      compileUserThemeTokens(target.theme.id, target.theme.content),
    );
  }

  const response = await api.themes.file(target.entry.fileName, target.entry.modifiedAt);
  if (!response.ok) {
    throw new Error(`The theme file request failed with status ${response.status}`);
  }
  return compileThemeSource(target.entry, await response.text());
}

/** Reports what a theme got wrong, in one line per problem, without failing the load. */
function warnIgnored(id: string, ignored: IgnoredThemeEntry[]): void {
  if (ignored.length === 0) return;
  console.warn(
    `Theme "${id}" ignored ${ignored.length} declaration(s):`,
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
  revision: string | number;
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
 * Drops the stylesheet and everything this module remembers about it, without
 * deciding what takes its place.
 *
 * Only the reset channel needs that combination: it has to make the document
 * theme-free *before* anything else runs, and it must also invalidate a fetch
 * that is still in flight, or a response landing afterwards would put the theme
 * it just escaped straight back.
 */
export function clearAppliedUserThemeStyle(): void {
  operation += 1;
  removeInjectedStyles();
  clearCache();
  applied = null;
  publish({ appliedId: null, failedId: null });
}

/**
 * Restores the stored pick's stylesheet before React mounts.
 *
 * Only the theme the user is already known to have picked is restored, and only
 * on evidence that it worked last time: the cache for a theme file, the
 * preference mirror itself for a pasted theme, whose content needs no fetching.
 * The listing corrects a file afterwards if it changed or is gone.
 *
 * Called from `main.tsx` rather than on import, so importing this module in a
 * test can never repaint the document.
 */
export function applyBootUserThemeStyle(): void {
  const pickedId = readUserPreference<string | null>('themeId', null);
  if (!pickedId) return;

  const cached = readCache();
  if (cached && cached.id === pickedId) {
    injectStyle(cached.id, cached.css);
    applied = { id: cached.id, revision: cached.modifiedAt };
    publish({ appliedId: cached.id, failedId: null });
    return;
  }

  // A pasted theme is restored from its own content rather than from a cache,
  // so it is offered exactly as early as a cached file is — but only pasted ids
  // are looked up here: any other id has to wait for the listing, which is what
  // the cache above exists to cover.
  if (!isPastedThemeId(pickedId)) return;
  const theme = findPastedTheme(pickedId);
  if (!theme) return;

  const compiled = compileUserThemeTokens(theme.id, theme.content);
  if (!compiled.ok) {
    // Should not happen — the content was compiled when it was pasted — but if a
    // later build tightens the rules, this is the honest report rather than a
    // first paint wearing nothing and no explanation.
    publish({ appliedId: null, failedId: theme.id });
    return;
  }

  injectStyle(theme.id, compiled.css);
  applied = { id: theme.id, revision: theme.content };
  publish({ appliedId: theme.id, failedId: null });
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
 * Points the document at one theme's stylesheet, or at none.
 *
 * `target` is what the pick resolves to, and `null` whenever it resolves to
 * nothing — either because no theme is picked or because the pick has not been
 * accounted for yet. `listingComplete` says whether that absence is evidence: a
 * theme file can also be missing from the target because the listing has not
 * arrived or could not be read, and tearing down a working stylesheet on the
 * strength of a request that has not finished — or has failed — would trade a
 * working theme for a fallback nobody asked for.
 *
 * Applying a target the document already holds for the same revision is a no-op,
 * which is what keeps a re-listing from re-fetching an unchanged file.
 */
export async function applyUserThemeStyle(
  target: UserThemeStyleTarget | null,
  listingComplete: boolean,
): Promise<void> {
  if (!target) {
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

  const id = targetId(target);
  const revision = targetRevision(target);

  if (applied?.id === id && applied.revision === revision) return;
  // A theme that already failed this session is not retried on every render:
  // the console carries the reason, and a reload is what picks up a fixed file.
  if (state.failedId === id) return;

  const token = ++operation;
  // A newer version of the theme being fetched keeps the version already on
  // screen until the replacement is in hand, so the id stays resolved and
  // nothing downstream — the terminal reads tokens on this id — sees a gap.
  publish({ appliedId: applied?.id ?? null, failedId: null });

  try {
    const compiled = await loadCompiledSource(target);
    if (token !== operation) return;

    warnIgnored(id, compiled.ignored);
    if (!compiled.ok) throw new Error(compiled.message);

    injectStyle(id, compiled.css);
    // Only a file needs the mirror: its text is what the next first paint has to
    // have before it can ask for anything, whereas a pasted theme carries its own.
    if (target.kind === 'file') {
      writeCache({ id, modifiedAt: target.entry.modifiedAt, css: compiled.css });
    }
    applied = { id, revision };
    publish({ appliedId: id, failedId: null });
  } catch (error) {
    if (token !== operation) return;

    // The cached copy is what misled the first paint, so it goes with the
    // element — keeping it would restore the same broken theme next load.
    removeInjectedStyles();
    clearCache();
    applied = null;
    publish({ appliedId: null, failedId: id });
    console.warn(`Theme "${id}" could not be loaded; falling back to the default.`, error);
  }
}
