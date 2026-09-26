/**
 * A snapshot of every custom property the document currently resolves, grouped
 * for the settings page's token preview (§6, the optional "令牌预览页").
 *
 * The read is deliberately built on `getComputedStyle(documentElement)` rather
 * than on parsing stylesheets: the browser substitutes `var()` chains for us,
 * so what comes back is what the page is actually wearing — base palette, the
 * user's appearance, any applied theme overlay, all resolved to leaf values.
 *
 * Light and dark come from the same document: the `.dark` class on
 * `<html>` is the only thing scoping them (ThemeContext toggles it; every token
 * declaration — `:root`, `.dark`, theme overlays — keys off that class), so
 * flipping it synchronously and reading twice yields both appearances with no
 * repaint in between. The class is restored in a `finally`, before the task
 * yields, so the page cannot paint in the other appearance.
 *
 * Grouping is display-only: a token goes to its prefix family when the family
 * is one of the sheet's known ones, and everything else — the L2 semantic
 * surface (`--background`, `--primary-foreground`, …) — forms one group. A
 * family that shows up later without a table entry lands in the semantic
 * group rather than getting its own; wrong-group beats missing-token for a
 * debug tool whose only contract is "every token the document resolves is
 * visible somewhere".
 */

export type TokenSwatch = string | null;

export type TokenEntry = {
  name: string;
  /** Resolved value with the light appearance in force. */
  light: string;
  /** Resolved value with the dark appearance in force. */
  dark: string;
  /** A CSS colour a swatch can wear, or null when the value is not one. */
  lightSwatch: TokenSwatch;
  darkSwatch: TokenSwatch;
};

export type TokenGroup = {
  id: string;
  entries: TokenEntry[];
};

export type TokenSnapshot = {
  groups: TokenGroup[];
  tokenCount: number;
};

/**
 * The prefix families the base sheet declares, in the order the preview lists
 * them. `semantic` (no family prefix) is deliberately first: it is the layer
 * themes and readers actually reason about.
 */
const GROUP_PREFIXES = [
  'palette',
  'n',
  'term',
  'syntax',
  'editor',
  'nav',
  'graph',
  'reasoning',
  'header',
  'mobile',
  'safe',
  'tw',
  'wb',
  'cb',
  'vscode',
] as const;

export const SEMANTIC_GROUP = 'semantic';

/**
 * The group a token belongs to. `--palette-brand-500` is `palette`;
 * `--muted-foreground` — no known family prefix — is the semantic surface.
 */
export function tokenGroupId(name: string): string {
  const body = name.startsWith('--') ? name.slice(2) : name;
  for (const prefix of GROUP_PREFIXES) {
    if (body.startsWith(`${prefix}-`)) return prefix;
  }
  return SEMANTIC_GROUP;
}

/**
 * Bare HSL components, the shape the palette and the L2 tokens are written in
 * (`221.2 83.2% 53.3%`) and the only shape that is not directly a colour: the
 * stylesheet never uses `var(--primary)` bare, it wraps it — `hsl(var(--x))` —
 * so the swatch has to wrap it the same way. An optional alpha tail is kept.
 */
const HSL_COMPONENTS = /^-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?% -?\d+(?:\.\d+)?%(?:\s*\/\s*[\d.]+%?)?$/;

/** Shapes that are already colours a swatch can wear verbatim. */
const COLOR_LIKE = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\()/i;

export function swatchColorFor(value: string): TokenSwatch {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (COLOR_LIKE.test(trimmed)) return trimmed;
  if (HSL_COMPONENTS.test(trimmed)) return `hsl(${trimmed})`;
  return null;
}

/** Every custom property the document resolves right now, for the current appearance. */
function readComputedTokens(): Map<string, string> {
  const computed = window.getComputedStyle(document.documentElement);
  const tokens = new Map<string, string>();
  for (let i = 0; i < computed.length; i++) {
    const name = computed[i];
    if (name && name.startsWith('--')) {
      tokens.set(name, computed.getPropertyValue(name).trim());
    }
  }
  return tokens;
}

/** Pure assembly, split from the DOM read so tests can feed both appearances directly. */
export function buildTokenGroups(light: Map<string, string>, dark: Map<string, string>): TokenSnapshot {
  const names = new Set<string>([...light.keys(), ...dark.keys()]);
  const byGroup = new Map<string, TokenEntry[]>();

  for (const name of names) {
    const lightValue = light.get(name) ?? '';
    const darkValue = dark.get(name) ?? '';
    const entry: TokenEntry = {
      name,
      light: lightValue,
      dark: darkValue,
      lightSwatch: swatchColorFor(lightValue),
      darkSwatch: swatchColorFor(darkValue),
    };
    const groupId = tokenGroupId(name);
    const bucket = byGroup.get(groupId);
    if (bucket) bucket.push(entry);
    else byGroup.set(groupId, [entry]);
  }

  const groupIds = [SEMANTIC_GROUP, ...GROUP_PREFIXES].filter((id) => byGroup.has(id));
  return {
    groups: groupIds.map((id) => ({
      id,
      entries: (byGroup.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    })),
    tokenCount: names.size,
  };
}

/**
 * Both appearances of every token the document resolves, as grouped entries.
 * Runs synchronously — the `.dark` class flip never spans a task, so nothing
 * can observe the page in the other appearance, and a throwing read still
 * restores the class it found.
 */
export function readTokenSnapshot(): TokenSnapshot {
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  let light: Map<string, string>;
  let dark: Map<string, string>;
  try {
    if (wasDark) {
      root.classList.remove('dark');
      light = readComputedTokens();
      root.classList.add('dark');
      dark = readComputedTokens();
    } else {
      light = readComputedTokens();
      root.classList.add('dark');
      dark = readComputedTokens();
    }
  } finally {
    root.classList.toggle('dark', wasDark);
  }
  return buildTokenGroups(light, dark);
}
