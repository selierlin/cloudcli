import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * User theme files, read from the server host's `~/.cloudcli/themes` folder and
 * handed to the client through the Themes module's routes.
 *
 * The client owns parsing and injection; this service owns the trust boundary
 * (`docs/research/CloudCLI主题与配色体系设计方案.md` §5.8). A filename that
 * could escape the folder or break the selector its id lands in, an extension
 * outside the three accepted formats, a file over the size cap, and a stylesheet
 * carrying `@import` are all refused here, so nothing unsafe reaches the browser.
 * Listing skips such files with a warning instead of failing, so one bad file
 * cannot stop the app from starting.
 *
 * Every entry point takes the themes folder explicitly rather than reading
 * `getUserThemesDir()` itself, so the gates above can be exercised against a
 * temp folder; production callers pass the global folder.
 */

/** File formats a user theme may be written in; the client picks its parser from this. */
export type ThemeFileFormat = 'css' | 'json' | 'tmTheme';

/**
 * One theme file offered to the client. Metadata is derived from the filename —
 * formats that carry their own metadata (a `name` or `appearance` key) are
 * parsed later, in the client's option-A pipeline.
 */
export type ThemeFileEntry = {
  /**
   * `user-<lowercased filename base>`. The prefix is mandatory (§5.8) so a user
   * file can never sanitize into a builtin `cc-` id and silently shadow it.
   */
  id: string;
  /** Display name in the picker — the filename base, verbatim. */
  name: string;
  /** Always `user`: these entries came from the themes folder, not the builtin registry. */
  source: 'user';
  /**
   * Always `system` while metadata is filename-derived: a user file is an
   * overlay theme, the kind the picker offers (see §5.3 v9 on the two roles of
   * `appearance`). Whether a file may declare a different value is decided when
   * option A starts reading metadata out of the file.
   */
  appearance: 'system';
  /** On-disk filename; the identifier the serving route accepts. */
  fileName: string;
  format: ThemeFileFormat;
  /** Last-modified time in ms; the client uses it as the cache-busting `?v=`. */
  modifiedAt: number;
};

/** §5.8 size cap, enforced both when listing and when serving. */
const MAX_THEME_FILE_BYTES = 256 * 1024;

/** §5.8: every user theme id carries this prefix, so it can never equal a builtin `cc-` id. */
const USER_THEME_ID_PREFIX = 'user-';

/**
 * §5.8: filenames are restricted to letters, digits, dot, underscore and hyphen,
 * and must start with a letter or digit. The set is narrow on purpose — the id
 * derived from the name is written into a `[data-theme="…"]` selector, so quotes,
 * spaces or `]` in a filename would break that selector or inject one.
 */
const THEME_FILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** §5.8: `@import` would let a theme pull in stylesheets the server never vetted. */
const IMPORT_RULE_PATTERN = /@import/i;

const EXTENSION_TO_FORMAT: Record<string, ThemeFileFormat> = {
  '.css': 'css',
  '.json': 'json',
  '.tmtheme': 'tmTheme',
};

/** Content type per format; `.tmTheme` is a plist, which `mime-types` does not know. */
const FORMAT_TO_CONTENT_TYPE: Record<ThemeFileFormat, string> = {
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  tmTheme: 'application/xml; charset=utf-8',
};

/**
 * Returns the format for a filename whose extension is one of the three accepted
 * ones, or null for anything else. Extension matching is case-insensitive, so
 * the canonical `.tmTheme` spelling is not required.
 */
export function themeFileFormat(fileName: string): ThemeFileFormat | null {
  return EXTENSION_TO_FORMAT[path.extname(fileName).toLowerCase()] ?? null;
}

/** The filename without its extension — the display name and the id stem. */
export function themeFileBase(fileName: string): string {
  return fileName.slice(0, fileName.length - path.extname(fileName).length);
}

/**
 * Whether a filename may be served at all (§5.8): no traversal, no separator, no
 * character that could break the selector its id ends up in, and a known theme
 * extension. Dotfiles are rejected by the leading-character rule.
 */
export function isSafeThemeFileName(fileName: string): boolean {
  const trimmed = typeof fileName === 'string' ? fileName.trim() : '';
  if (!trimmed || trimmed.includes('..')) return false;
  if (!THEME_FILE_NAME_PATTERN.test(trimmed)) return false;
  return themeFileFormat(trimmed) !== null;
}

/**
 * Resolves one theme filename to its absolute path inside `themesDir`, or null
 * when the name is unsafe or would escape the folder.
 *
 * Uses the same direct-child containment check as the assets module: the
 * resolved path must sit below the folder plus a separator, so neither the
 * folder itself nor a sibling of it is reachable.
 */
export function resolveThemeFilePath(themesDir: string, fileName: string): string | null {
  const trimmed = typeof fileName === 'string' ? fileName.trim() : '';
  if (!isSafeThemeFileName(trimmed)) return null;
  const root = path.resolve(themesDir);
  const resolved = path.resolve(root, trimmed);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

/**
 * Whether a stylesheet pulls in another file. Only CSS is scanned — the other
 * formats carry no rules of their own.
 */
async function carriesImportRule(filePath: string, format: ThemeFileFormat): Promise<boolean> {
  if (format !== 'css') return false;
  return IMPORT_RULE_PATTERN.test(await fs.readFile(filePath, 'utf8'));
}

/**
 * Reads one candidate file and returns its entry, or null when it fails a gate.
 * Warnings name the file and the reason, so a user who drops a file into the
 * folder can see why it never showed up in the picker.
 */
async function inspectThemeFile(themesDir: string, fileName: string): Promise<ThemeFileEntry | null> {
  const filePath = resolveThemeFilePath(themesDir, fileName);
  const format = themeFileFormat(fileName);
  if (!filePath || !format) return null;

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;
    if (stats.size > MAX_THEME_FILE_BYTES) {
      console.warn(`[Themes] Skipping ${fileName}: larger than ${MAX_THEME_FILE_BYTES} bytes`);
      return null;
    }
    if (await carriesImportRule(filePath, format)) {
      console.warn(`[Themes] Skipping ${fileName}: @import is not allowed`);
      return null;
    }

    const base = themeFileBase(fileName);
    return {
      id: `${USER_THEME_ID_PREFIX}${base.toLowerCase()}`,
      name: base,
      source: 'user',
      appearance: 'system',
      fileName,
      format,
      modifiedAt: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * Orders theme filenames case-insensitively so the picker reads alphabetically
 * however the file was named, falling back to the raw code-unit order to keep
 * the result stable. Among the three accepted formats this puts `.css` first,
 * so a theme shipped as both `.css` and `.tmTheme` keeps its full-fidelity
 * version.
 */
function compareThemeFileNames(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft !== foldedRight) return foldedLeft < foldedRight ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Lists every acceptable theme file in `themesDir`, sorted by filename so the
 * result is stable across filesystems.
 *
 * A missing folder is the normal first-run state and yields an empty list. Files
 * that resolve to the same id (`Nord.tmTheme` and `nord.css`) are de-duplicated —
 * first one wins, the rest are skipped with a warning — so the client never ends
 * up with two manifests competing for one `[data-theme]` value.
 */
export async function scanThemeFiles(themesDir: string): Promise<ThemeFileEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(themesDir);
  } catch {
    return [];
  }

  const entries: ThemeFileEntry[] = [];
  const takenIds = new Set<string>();
  for (const name of [...names].sort(compareThemeFileNames)) {
    const entry = await inspectThemeFile(themesDir, name);
    if (!entry) continue;
    if (takenIds.has(entry.id)) {
      console.warn(`[Themes] Skipping ${name}: id ${entry.id} is already taken`);
      continue;
    }
    takenIds.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

/**
 * Reads one theme file for the serving route, re-applying the size and
 * `@import` gates so a file edited after it was listed cannot get through
 * either. Returns a status the route translates: `invalid` → 400, `missing` →
 * 404, `found` → the raw bytes with their content type.
 */
export async function readThemeFile(themesDir: string, fileName: string) {
  const filePath = resolveThemeFilePath(themesDir, fileName);
  const format = themeFileFormat(fileName);
  if (!filePath || !format) return { status: 'invalid' as const };

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > MAX_THEME_FILE_BYTES) {
      return { status: 'invalid' as const };
    }
    if (await carriesImportRule(filePath, format)) {
      return { status: 'invalid' as const };
    }
    return {
      status: 'found' as const,
      content: await fs.readFile(filePath),
      contentType: FORMAT_TO_CONTENT_TYPE[format],
    };
  } catch {
    return { status: 'missing' as const };
  }
}
