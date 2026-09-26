import type { PastedUserTheme } from '@/shared/types';
import type { ThemeContrastWarning } from '@/shared/userThemeContrast';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import { compileUserThemeTokens } from '@/shared/userThemeTokens';
import type { IgnoredThemeEntry, UserThemeCompileFailure } from '@/shared/userThemeTokens';

/**
 * The pasted user themes: the ones typed into the settings page, kept in the
 * user's preferences rather than in the host's themes folder.
 *
 * From the moment it is picked, a pasted theme is the same thing as a theme file
 * — a stylesheet injected as one `<style>` element, whose content is a `[data-theme]`
 * overlay — and differs in exactly one respect: its content travels with the
 * user, so every device they sign in on has it, whereas a theme file only exists
 * on the machine that has it. That single difference is why this is its own
 * store rather than an entry in `userThemes`, which mirrors what the *server*
 * offers (§5.4 v3).
 *
 * Nothing here is fetched. The content is already in the preference mirror, so
 * a pasted theme can be compiled and injected during the first paint, the same
 * way a cached theme file is — there is no request to wait for.
 *
 * **Two formats, and this store owns both** (§5.5). A paste has no filename, so
 * nothing external can tell later which of the two it was written in; the entry
 * records it (`PastedUserTheme.format`) and `compilePastedTheme` is the one place
 * that turns either into a stylesheet. That function is used twice on purpose:
 * here, to refuse content at paste time, and in `userThemeStyles`, to recompile
 * the stored text on every apply.
 */

/** The formats a paste may be written in; option A's token map, or option B's stylesheet. */
export type PastedThemeFormat = PastedUserTheme['format'];

/** The id prefix that keeps a pasted theme from shadowing a built-in or a theme file. */
const PASTE_ID_PREFIX = 'paste-';

const PASTE_ID_PATTERN = /^paste-[a-z0-9-]+$/;

/** Longest name taken from a pasted theme's own `name`; the rest is truncated. */
const MAX_NAME_LENGTH = 80;

/**
 * §5.8's size cap, applied to pasted content as well.
 *
 * The section states the cap for a theme *file*, and a paste has no file — but it
 * has a size, and the same reason applies: the content is stored twice (the
 * preference mirror and the server's row) and compiled on every load, so an
 * unbounded paste is a way to make every one of those steps expensive by
 * accident. 256KB matches the server's `MAX_THEME_FILE_BYTES`, so a theme that
 * could be a file is not rejected merely for being pasted instead.
 */
const MAX_PASTE_BYTES = 256 * 1024;

/** The reaches a theme may declare; an unknown one is dropped rather than failing the entry. */
const COVERAGES = new Set(['accent', 'full']);

/** The formats an entry may be written in. A value outside this set is not compilable at all. */
const FORMATS = new Set<PastedThemeFormat>(['json', 'css']);

/**
 * §5.8's `@import` gate, restated for the paste line.
 *
 * The server refuses a `.css` file that pulls in another stylesheet, because that
 * would let a theme load rules nothing vetted. A pasted stylesheet has no server
 * in front of it — the text goes straight from the settings box into the document
 * — so this is the only gate of its kind, and the same refusal has to exist here
 * or the constraint would hold for files and not for pastes. Same pattern as the
 * server's, deliberately: two gates for one rule should agree on what the rule is.
 *
 * Only a stylesheet can carry the rule; option A's output is a block of
 * declarations, so `json` needs no such check.
 */
const IMPORT_RULE_PATTERN = /@import/i;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/** Whether an id could name a pasted theme rather than a built-in or a theme file. */
export function isPastedThemeId(id: string): boolean {
  return id.startsWith(PASTE_ID_PREFIX);
}

/**
 * Reads the stored list, or an empty one.
 *
 * Like `userThemes.readEntry`, the shape is checked here rather than trusted:
 * this list comes back from the preference mirror, which is user-writable
 * storage and — after a sign-in — whatever the server holds. A malformed entry
 * is dropped rather than failing the list, because one bad row must not cost the
 * user every theme they pasted.
 */
function readList(value: unknown): PastedUserTheme[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate: unknown) => {
    if (!isRecord(candidate)) return [];
    const { id, name, content } = candidate;
    if (typeof id !== 'string' || !PASTE_ID_PATTERN.test(id)) return [];
    if (typeof name !== 'string' || !name) return [];
    if (typeof content !== 'string' || !content) return [];

    // An entry with no `format` is one this store wrote before the paste line had
    // a second format, so `json` is not a guess — it is the only thing it can
    // have been. Rows written since always carry one.
    const format = candidate.format === undefined ? 'json' : candidate.format;
    // An unknown value gets the strict treatment `readEntry` gives an unknown
    // file format, for the same reason: there would be nothing to compile with.
    if (typeof format !== 'string' || !FORMATS.has(format as PastedThemeFormat)) return [];

    const theme: PastedUserTheme = { id, name, content, format: format as PastedThemeFormat };
    // Same leniency as the listing's `readEntry`, for the same reason: a reach
    // this build does not know only costs a badge, and losing the theme over it
    // would be the wrong trade.
    if (COVERAGES.has(candidate.coverage as string)) {
      theme.coverage = candidate.coverage as PastedUserTheme['coverage'];
    }
    return [theme];
  });
}

/**
 * The parsed list, kept identical between reads so it can seed React state.
 *
 * `readUserPreference` hands back the same object the mirror holds, so an
 * identity check is enough to know the list has not changed — without it, every
 * read would produce a fresh array and re-render every consumer on any
 * preference change, theme-related or not.
 */
let cachedRaw: unknown;
let cachedList: PastedUserTheme[] = [];

export function getPastedThemes(): PastedUserTheme[] {
  const raw = readUserPreference<unknown>('userThemePastes', null);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = readList(raw);
  }
  return cachedList;
}

/** Subscribes to changes in the list; returns the unsubscribe function. */
export function subscribeToPastedThemes(listener: () => void): () => void {
  return subscribeToUserPreferences(listener);
}

/**
 * The metadata a pasted theme declares for itself: the name shown for it, and the
 * reach it claims. Reads only what option A's format defines, and only when it is
 * usable — a wrong type or an unknown reach is the same as declaring nothing.
 * Callers only ask for a `json` entry; a stylesheet has nowhere to declare either.
 */
function readDeclaredMetadata(content: string): {
  name: string | null;
  coverage?: PastedUserTheme['coverage'];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { name: null };
  }
  if (!isRecord(parsed)) return { name: null };

  const declaredName = parsed.name;
  const name = typeof declaredName === 'string' && declaredName.trim()
    ? declaredName.trim().slice(0, MAX_NAME_LENGTH)
    : null;

  if (COVERAGES.has(parsed.coverage as string)) {
    return { name, coverage: parsed.coverage as PastedUserTheme['coverage'] };
  }
  return { name };
}

/**
 * The next free id. Sequential and independent of the content, so a theme keeps
 * its id — and therefore its `[data-theme]` selector — for as long as it is in
 * the list, and an id is never reused while its theme is still there.
 */
function nextPasteId(existing: PastedUserTheme[]): string {
  const used = new Set(existing.map((theme) => theme.id));
  let suffix = 1;
  while (used.has(`${PASTE_ID_PREFIX}${suffix}`)) {
    suffix += 1;
  }
  return `${PASTE_ID_PREFIX}${suffix}`;
}

/** Why a paste was refused: the compilers' reasons, plus the two only pasting has. */
export type AddPastedThemeFailure = UserThemeCompileFailure | 'too-large' | 'import-rule';

export type AddPastedThemeResult =
  | { ok: true; theme: PastedUserTheme; warnings: ThemeContrastWarning[] }
  | { ok: false; reason: AddPastedThemeFailure };

/** What a pasted theme's text is worth: a stylesheet to inject, or a reason it cannot be one. */
export type PastedThemeCompileResult =
  | { ok: true; css: string; ignored: IgnoredThemeEntry[]; warnings: ThemeContrastWarning[] }
  | { ok: false; reason: AddPastedThemeFailure; token?: string; ignored: IgnoredThemeEntry[] };

/**
 * Turns a pasted theme's text into the stylesheet to inject, whichever format it
 * was written in.
 *
 * One function for both, because the format is a property of the entry and
 * nothing outside this module knows it. `json` goes through option A's token
 * compiler, which is where its whitelist and value shapes are enforced; `css` is
 * option B and is injected as it stands, minus the one gate a stylesheet needs
 * and a block of declarations cannot (`IMPORT_RULE_PATTERN`).
 *
 * Pure — it logs nothing and touches no document — which is what lets the paste
 * path call it to decide whether to store, and the apply path call it again on
 * every load rather than trusting what was stored.
 *
 * §5.10's contrast warning rides on the result of the option A branch: it is a
 * statement about a token map, and a stylesheet is not one — a `css` paste sets
 * whatever selectors it likes, which no token-level check can speak about.
 */
export function compilePastedTheme(theme: PastedUserTheme): PastedThemeCompileResult {
  if (theme.format === 'css') {
    return IMPORT_RULE_PATTERN.test(theme.content)
      ? { ok: false, reason: 'import-rule', ignored: [] }
      : { ok: true, css: theme.content, ignored: [], warnings: [] };
  }
  return compileUserThemeTokens(theme.id, theme.content);
}

/**
 * Validates pasted content and, only when it compiles, stores it.
 *
 * Validation is not a formality here: this is the only gate a pasted theme ever
 * passes. A theme file is written by someone with access to the machine, but a
 * pasted one arrives through a text box, and refusing at paste time is what
 * makes the apply path (which has no user to explain a failure to) a pure
 * recompile rather than another place that has to decide what is acceptable.
 *
 * `format` is how the text is to be read, and it is stored with the entry: the
 * settings page's advanced mode supplies it, and afterwards nothing else could
 * recover it. It defaults to option A because that is the documented default and
 * the only format a paste could be before the switch existed.
 *
 * The name is taken from the JSON's own `name` — option A's format declares one
 * (§5.5) — and falls back to the id when it declares none, which is the same
 * "say what you know, invent nothing" rule the listing follows for `coverage`. A
 * stylesheet has nowhere to declare one (a `.css` *file* is named by its
 * filename), so a css paste is shown under its id.
 *
 * The contrast warnings come back with the entry rather than being logged here:
 * this is the only moment a paste's author is looking at anything, so it is the
 * only moment a warning about what they wrote can reach them (§5.10).
 */
export function addPastedTheme(
  content: string,
  format: PastedThemeFormat = 'json',
): AddPastedThemeResult {
  if (new TextEncoder().encode(content).length > MAX_PASTE_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  const existing = getPastedThemes();
  const id = nextPasteId(existing);

  const theme: PastedUserTheme = { id, name: id, content, format };
  const compiled = compilePastedTheme(theme);
  if (!compiled.ok) return { ok: false, reason: compiled.reason };

  if (format === 'json') {
    const declared = readDeclaredMetadata(content);
    if (declared.name) theme.name = declared.name;
    if (declared.coverage) theme.coverage = declared.coverage;
  }

  writeUserPreference('userThemePastes', [...existing, theme]);
  return { ok: true, theme, warnings: compiled.warnings };
}

/**
 * Removes a pasted theme.
 *
 * A pick that names the theme being removed is cleared with it. The pick is a
 * separate preference and would otherwise survive as a dangling id, which the
 * picker reports as a theme that is missing — true, but not what happened: the
 * user removed it on purpose, and being told their own deletion looks like a
 * failure is worse than the pick quietly going back to the default.
 */
export function removePastedTheme(id: string): void {
  const existing = getPastedThemes();
  const remaining = existing.filter((theme) => theme.id !== id);
  if (remaining.length === existing.length) return;

  writeUserPreference('userThemePastes', remaining);
  if (readUserPreference<string | null>('themeId', null) === id) {
    writeUserPreference('themeId', null);
  }
}

/** The stored theme with this id, or null. Only callers that own a paste id should ask. */
export function findPastedTheme(id: string): PastedUserTheme | null {
  return getPastedThemes().find((theme) => theme.id === id) ?? null;
}
