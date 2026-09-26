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
 * One theme file offered to the client. A `.json` file's own `name` and
 * `coverage` are read out of it, and a `.tmTheme`'s top-level `name` and the
 * `coverage` claim inside its `cloudcli` key likewise; everything else is
 * derived from the filename.
 */
export type ThemeFileEntry = {
  /**
   * `user-<lowercased filename base>`. The prefix is mandatory (§5.8) so a user
   * file can never sanitize into a builtin `cc-` id and silently shadow it.
   */
  id: string;
  /** Display name in the picker: the name the file declares, or its filename base. */
  name: string;
  /** Always `user`: these entries came from the themes folder, not the builtin registry. */
  source: 'user';
  /**
   * Always `system`, because this field is the *role* a theme plays: `system` is
   * an overlay, the kind the picker offers, and `light` / `dark` are the
   * appearance defaults it does not (§5.3 v9). A file's own `appearance` key
   * answers a different question — which appearance its rules are written for —
   * and is applied where those rules are compiled, not here (§5.6 v13).
   */
  appearance: 'system';
  /** On-disk filename; the identifier the serving route accepts. */
  fileName: string;
  format: ThemeFileFormat;
  /**
   * The reach the file declares, when it declares a valid one. Absent means
   * undeclared, and the picker shows no badge rather than a fabricated one.
   */
  coverage?: 'accent' | 'full';
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

/** The reach values a file may declare; anything else is dropped rather than listed. */
const COVERAGES = new Set(['accent', 'full']);

/**
 * Longest display name taken from a file. Longer ones fall back to the filename
 * base: the name is drawn in the picker, and the point of reading it is a nicer
 * label, not an unbounded string off disk.
 */
const MAX_DECLARED_NAME_LENGTH = 80;

/** What a theme file says about itself, beyond what its filename already tells us. */
type DeclaredMetadata = { name?: string; coverage?: 'accent' | 'full' };

/**
 * Reads the metadata a `.json` theme declares about itself, and the metadata a
 * `.tmTheme` declares: its top-level `name` plus the `coverage` claim inside
 * its `cloudcli` key.
 *
 * A `.json` file's `name` and `coverage` are read from the object itself. A
 * `.tmTheme` gets both from its plist — a TextMate file always carries a
 * top-level `name` worth labeling the picker with, and one that embeds a
 * `cloudcli` key can reach the main UI (the client compiles it, §5.5 v7), so
 * it can also claim a reach — and both are read here, at the same trust level
 * as a `.json`'s. A `.css` file has nowhere to declare either. A file that
 * does not parse is still listed under its filename — the client is the side
 * that can tell the user why it will not compile, and a file that quietly
 * never appears in the picker is harder to understand than one that appears
 * and is refused.
 *
 * `appearance` is deliberately not read here; see `ThemeFileEntry`.
 */
async function readDeclaredMetadata(
  fileName: string,
  filePath: string,
  format: ThemeFileFormat,
): Promise<DeclaredMetadata> {
  if (format === 'tmTheme') return readTmThemeDeclaredMetadata(fileName, filePath);
  if (format !== 'json') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    console.warn(`[Themes] ${fileName} is not readable JSON; listing it under its filename`);
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const record = parsed as Record<string, unknown>;
  const metadata: DeclaredMetadata = {};

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name && name.length <= MAX_DECLARED_NAME_LENGTH) {
    metadata.name = name;
  }

  if (record.coverage !== undefined) {
    if (typeof record.coverage === 'string' && COVERAGES.has(record.coverage)) {
      metadata.coverage = record.coverage as 'accent' | 'full';
    } else {
      console.warn(`[Themes] ${fileName} declares an unknown coverage; no badge will be shown`);
    }
  }

  return metadata;
}

/** The tags the plist extraction below understands; anything else passes unread. */
const PLIST_TAG_PATTERN = /<(\/?)(dict|array|key|string)>([^<]*)/g;

/**
 * The plist extraction a `.tmTheme`'s declared metadata needs.
 *
 * Two facts are read: the theme's own `name` from the top-level dict, and the
 * `coverage` claim inside the `cloudcli` key (§5.5 v7). Neither justifies a
 * plist parser on the server — but `name` cannot be taken by a bare substring
 * match, because nested `name` keys are a shape TextMate files legitimately
 * carry (a `shellVariables` entry is one), so the scan tracks dict/array depth
 * and only reads `name` at depth one and `coverage` inside the `cloudcli`
 * dict. An unknown coverage warns and leaves the badge off, which is what the
 * json branch does too.
 */
async function readTmThemeDeclaredMetadata(
  fileName: string,
  filePath: string,
): Promise<DeclaredMetadata> {
  let body: string;
  try {
    body = await fs.readFile(filePath, 'utf8');
  } catch {
    return {};
  }

  const metadata: DeclaredMetadata = {};
  let depth = 0;
  let scope: 'root' | 'cloudcli' = 'root';
  let lastKey = '';

  for (const [, closing, tag, text] of body.matchAll(PLIST_TAG_PATTERN)) {
    if (closing) {
      if (tag === 'dict' || tag === 'array') {
        depth = Math.max(0, depth - 1);
        if (depth <= 1) scope = 'root';
      }
      continue;
    }
    if (tag === 'dict' || tag === 'array') {
      depth += 1;
      if (depth === 2 && lastKey === 'cloudcli') scope = 'cloudcli';
      continue;
    }
    if (tag === 'key') {
      lastKey = text.trim();
      continue;
    }
    // A `<string>` value: the only slots this channel reads are the top-level
    // `name` and the `coverage` claim inside the `cloudcli` dict.
    if (lastKey === 'name' && depth === 1 && scope === 'root' && metadata.name === undefined) {
      const name = text.trim();
      if (name && name.length <= MAX_DECLARED_NAME_LENGTH) metadata.name = name;
    } else if (
      lastKey === 'coverage' &&
      depth === 2 &&
      scope === 'cloudcli' &&
      metadata.coverage === undefined
    ) {
      const declared = text.trim();
      if (COVERAGES.has(declared)) {
        metadata.coverage = declared as 'accent' | 'full';
      } else {
        console.warn(`[Themes] ${fileName} declares an unknown coverage; no badge will be shown`);
      }
    }
    lastKey = '';
  }

  return metadata;
}

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
    const declared = await readDeclaredMetadata(fileName, filePath, format);
    const entry: ThemeFileEntry = {
      id: `${USER_THEME_ID_PREFIX}${base.toLowerCase()}`,
      name: declared.name ?? base,
      source: 'user',
      appearance: 'system',
      fileName,
      format,
      modifiedAt: stats.mtimeMs,
    };
    if (declared.coverage) entry.coverage = declared.coverage;
    return entry;
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
