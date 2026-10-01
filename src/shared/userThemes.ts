import { api } from '@/shared/api';
import { getStoredAuthToken } from '@/shared/authToken';

/**
 * The user theme listing: the theme files the server host offers from
 * `~/.cloudcli/themes`, as the picker and the theme resolver see them.
 *
 * The listing is the only thing that can tell whether a `user-…` id names a
 * real file, so it has to be reachable from the resolver before the picker is
 * ever opened — hence a module-level store rather than state inside a
 * component, the same shape `userSettings` uses for the preference mirror.
 *
 * Nothing here reads a theme file's contents; that is `userThemeStyles`.
 */

/** Formats a theme file may be written in; mirrors the server's `ThemeFileFormat`. */
export type UserThemeFormat = 'css' | 'json' | 'tmTheme';

/** How far a theme says it reaches; mirrors `ThemeManifest['coverage']`. */
export type UserThemeCoverage = 'accent' | 'full';

/**
 * The localized display names the folder's shared `index.json` may give a
 * theme. Either language is optional; the picker labels the option with `zh`
 * when present and shows `en` as its second line when it differs.
 */
export type UserThemeDisplayName = { zh?: string; en?: string };

/** One theme file the server offers. */
export type UserThemeEntry = {
  /** `user-<lowercased filename base>`, the value written to `<html data-theme>`. */
  id: string;
  /** Display name in the picker: the name the file declares, or its filename base. */
  name: string;
  /** On-disk filename; what the serving route takes. */
  fileName: string;
  format: UserThemeFormat;
  /**
   * The reach the file declares, when it declares one. Absent means the theme
   * says nothing about its reach, and the picker shows no badge rather than
   * claiming one nobody checked — the state every file-derived theme was in
   * before option A started reading it out of the file (§5.8 v4).
   */
  coverage?: UserThemeCoverage;
  /** Last-modified time in ms; the cache-busting `?v=` and the "did it change" check. */
  modifiedAt: number;
  /** Localized names from the folder's `index.json`; absent when it says nothing. */
  displayName?: UserThemeDisplayName;
  /** Who made the theme, as `index.json` says; free text, shown verbatim. */
  author?: string;
  /** Where the theme comes from; shown as a link when it is an http(s) URL. */
  inspiredBy?: string;
};

/**
 * How far the listing has got, which is what decides whether an unresolved
 * `user-…` id is *missing* or merely *unknown*:
 *
 * - `idle` — this session has not asked yet.
 * - `loading` — the request is in flight.
 * - `ready` — the listing was read; it is now authoritative.
 * - `error` — the request failed; the themes may exist but cannot be reached.
 */
export type UserThemesStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UserThemesState = {
  entries: UserThemeEntry[];
  status: UserThemesStatus;
};

/**
 * §5.8 makes the server prefix every id it derives from a filename, which is
 * what tells an id that can only be confirmed by the listing (`user-borealis`)
 * apart from one the bundle's own registry already settles (`cc-ocean`).
 * Only the former has to wait for the listing before it can be called missing.
 */
const USER_THEME_ID_PREFIX = 'user-';

const FORMATS = new Set<UserThemeFormat>(['css', 'json', 'tmTheme']);

const COVERAGES = new Set<UserThemeCoverage>(['accent', 'full']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/**
 * Reads one entry off the wire, or null when it is not shaped like one.
 *
 * The server derives these from filenames it has already vetted, but the store
 * is the boundary between the two: an entry with the wrong shape would end up
 * as an id in a selector or a path in a request, so it is filtered here rather
 * than trusted because of where it came from.
 *
 * `coverage` is the one field read leniently — an unknown value is dropped
 * rather than failing the entry. It only decides whether a badge is drawn, and
 * losing a theme because this build does not know a reach the server does would
 * be the wrong trade; an unknown `format` gets the strict treatment because
 * there would be nothing to compile with.
 */
function readEntry(value: unknown): UserThemeEntry | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !isUserThemeId(value.id) ||
    typeof value.name !== 'string' ||
    typeof value.fileName !== 'string' ||
    typeof value.format !== 'string' ||
    !FORMATS.has(value.format as UserThemeFormat) ||
    typeof value.modifiedAt !== 'number' ||
    !Number.isFinite(value.modifiedAt)
  ) {
    return null;
  }

  const entry: UserThemeEntry = {
    id: value.id,
    name: value.name,
    fileName: value.fileName,
    format: value.format as UserThemeFormat,
    modifiedAt: value.modifiedAt,
  };
  if (COVERAGES.has(value.coverage as UserThemeCoverage)) {
    entry.coverage = value.coverage as UserThemeCoverage;
  }
  // The metadata fields are read like `coverage` is: leniently, because they
  // only decide what the picker labels and where it points. A wrong shape
  // means no label rather than a lost theme.
  if (isRecord(value.displayName)) {
    const displayName: UserThemeDisplayName = {};
    if (typeof value.displayName.zh === 'string' && value.displayName.zh) {
      displayName.zh = value.displayName.zh;
    }
    if (typeof value.displayName.en === 'string' && value.displayName.en) {
      displayName.en = value.displayName.en;
    }
    if (displayName.zh || displayName.en) entry.displayName = displayName;
  }
  if (typeof value.author === 'string' && value.author) entry.author = value.author;
  if (typeof value.inspiredBy === 'string' && value.inspiredBy) {
    entry.inspiredBy = value.inspiredBy;
  }
  return entry;
}

let state: UserThemesState = { entries: [], status: 'idle' };
let inFlight = false;

const listeners = new Set<() => void>();

function publish(next: UserThemesState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/** The current listing and how far it has got. Stable between changes, so it can seed state. */
export function getUserThemesState(): UserThemesState {
  return state;
}

/** Subscribes to listing changes; returns the unsubscribe function. */
export function subscribeToUserThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether an id could name a file in the themes folder (§5.8's mandatory prefix). */
export function isUserThemeId(id: string): boolean {
  return id.startsWith(USER_THEME_ID_PREFIX);
}

/**
 * Reads the server's listing.
 *
 * Idempotent by design: it is called both when the app mounts and again when
 * the picker is opened, because the first call can land before the client has
 * a session token. Once a listing has been read this session there is nothing
 * to do — a file added while the app is running is picked up on the next load,
 * which is the reload the acceptance criteria describe.
 */
export async function refreshUserThemes(): Promise<void> {
  if (inFlight || state.status === 'ready') return;

  // The listing sits behind the session token, and this runs on the sign-in
  // screen too, so without one the request is a guaranteed 401. Staying idle
  // costs nothing: a later trigger — the pick changing, or the picker opening —
  // runs this again once there is a session.
  if (!getStoredAuthToken()) return;

  inFlight = true;
  publish({ entries: state.entries, status: 'loading' });
  try {
    const response = await api.themes.list();
    if (!response.ok) {
      throw new Error(`The themes request failed with status ${response.status}`);
    }
    const payload: unknown = await response.json();
    const entries = isRecord(payload) && Array.isArray(payload.themes)
      ? payload.themes.flatMap((candidate: unknown) => {
          const entry = readEntry(candidate);
          return entry ? [entry] : [];
        })
      : [];
    publish({ entries, status: 'ready' });
  } catch (error) {
    // Loud, because this is the failure the picker cannot show: with no
    // listing there is nothing to mark as missing, so a stored user theme
    // simply does not come back and the console is the only account of why.
    publish({ entries: state.entries, status: 'error' });
    console.warn(
      'Could not list the user themes in ~/.cloudcli/themes; a theme from that folder cannot be applied.',
      error,
    );
  } finally {
    inFlight = false;
  }
}
