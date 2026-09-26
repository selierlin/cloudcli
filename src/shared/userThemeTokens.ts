/**
 * Option A: a token JSON compiled into the overlay stylesheet the app injects.
 *
 * A `.css` user theme is already a stylesheet, so `userThemeStyles` hands it to
 * the CSS parser unchanged, and a `.tmTheme` is compiled by `tmTheme.ts`. A
 * `.json` one is not: it is a map of token names to
 * values that has to be turned into `[data-theme="…"] { --a: b; … }` first, and
 * that is what this module does — plus the two gates that make option A worth
 * having (§5.5): a name outside the list below is not a token this app defines,
 * and a value has to be shaped like something the consuming declaration can
 * parse.
 *
 * **Where §5.5's promise actually comes from.** A custom property's value is a
 * token stream, not a string: a `}` in it ends the declaration and the block,
 * so a value carrying `}` (or `;`, `@`, a line break…) would be a way out of
 * "you may only write values" and into "you may write rules". Two layers stand
 * against that, and it is worth being exact about which one holds today: the
 * value rules' own character classes already exclude every character that could
 * end a declaration, so on the rule set as it stands no value can escape. The
 * structural gate below is the second, independent layer — it states the
 * promise once, in one place, so that a rule loosened later cannot quietly open
 * the hole. Its visible effect today is not "an escape was blocked" but *which
 * failure you get*: a value that trips it refuses the whole file, because an
 * author writing raw CSS is in the wrong format, whereas a value that merely
 * fails its rule is one dropped token. Claiming more than that for it would be
 * claiming a mutation test cannot show (§5.8 v4).
 *
 * Everything else is ergonomics, and is dropped rather than refused: an unknown
 * token or an ill-shaped value costs colour, not safety, and dropping it keeps
 * a theme written against a newer CloudCLI working with the tokens this build
 * knows. Drops are reported so the author can see them.
 */

/** The appearance an overlay is scoped to; see `compileUserThemeTokens` for what each means. */
export type UserThemeAppearance = 'light' | 'dark' | 'system';

/** One thing the compiler left out, and why. `what` is a token name, or `appearance`. */
export type IgnoredThemeEntry = { what: string; reason: string };

/** Why a whole file was refused. */
export type UserThemeCompileFailure =
  /** The id could not be written into a selector safely. */
  | 'unsafe-id'
  /** The body is not a JSON object. */
  | 'unreadable-json'
  /** It parses, but carries no `tokens` map to compile. */
  | 'no-tokens'
  /** A value tried to leave its declaration; the file is not option A material. */
  | 'unsafe-value'
  /** Every token was dropped, so the overlay would declare nothing. */
  | 'nothing-usable';

export type UserThemeCompileResult =
  | { ok: true; css: string; ignored: IgnoredThemeEntry[] }
  | { ok: false; reason: UserThemeCompileFailure; token?: string; ignored: IgnoredThemeEntry[] };

/**
 * §5.8's id rule, restated at the point the id is written into a selector. The
 * listing vets ids already, but the compilers take the id as an argument, so they
 * check their own input rather than trusting the caller.
 *
 * Both prefixes are accepted because both carry option A content: `user-` is a
 * file the host serves, `paste-` is a theme the user typed in, which has no file
 * and never will (§5.8 v4). The character class is the same either way — it is
 * the selector's requirement, not the source's.
 */
const THEME_ID_PATTERN = /^(?:user|paste)-[a-z0-9._-]+$/;

/**
 * Whether an id may be written into an overlay selector.
 *
 * Exported because the `.tmTheme` compiler builds the same `[data-theme="…"]`
 * selector and so has to enforce the same rule; two compilers sharing one
 * selector shape should not each carry their own idea of what is safe in it.
 */
export function isThemableThemeId(id: string): boolean {
  return THEME_ID_PATTERN.test(id);
}

/** Longest value accepted. Real values are a few dozen characters; this only stops absurdity. */
const MAX_VALUE_LENGTH = 100;

/**
 * Characters and sequences a value may never contain. The first three would end
 * the declaration or the block, and the rest are either at-rule, import or
 * comment syntax. Today the rules below already exclude all of them; see the
 * module comment on what this layer is therefore for.
 */
const UNSAFE_VALUE_PATTERN = /[{}\n\r;<>\\@!]|url\(|\/\*/i;

/** `175 84% 32%` — the form every token consumed as `hsl(var(--token))` needs. */
const TRIPLET_PATTERN = /^\d{1,3}(?:\.\d+)? \d{1,3}(?:\.\d+)?% \d{1,3}(?:\.\d+)?%$/;

/** `var(--palette-sand-50)` — a token may point at another token instead of a literal. */
const REFERENCE_PATTERN = /^var\((--[a-z0-9-]+)\)$/;

/** `var(--palette-sand-50) / 0.7` — the alpha form the `--nav-*` glass tokens use. */
const ALPHA_SUFFIX_PATTERN = /^(.*) \/ (?:0(?:\.\d+)?|1(?:\.0+)?|\d{1,3}(?:\.\d+)?%)$/;

/** `0.5rem` / `20px` — lengths, for the shape tokens. */
const LENGTH_PATTERN = /^\d+(?:\.\d+)?(?:px|rem|em|%)$/;

/** `1.8` / `24px` — a number, optionally with a unit, for the blur and saturation knobs. */
const NUMBER_PATTERN = /^\d+(?:\.\d+)?(?:px|rem|em|%)?$/;

/**
 * The editor chrome is a mix of colours, border shorthands and `none`, and its
 * tokens are written straight into `EditorView.theme()` rules rather than
 * consumed through `hsl()` (see §5.11 v5). One shape covers all of them: the
 * characters a CSS value is made of, with the escape hatches already removed by
 * the structural gate. This is deliberately looser than the colour rules below
 * — a wrong value here costs one editor decoration, and the browser drops it.
 */
const EXPRESSION_PATTERN = /^[-a-zA-Z0-9 .,%()#/_]+$/;

type ValueRule =
  | 'triplet'
  | 'triplet-or-reference'
  | 'triplet-or-reference-with-optional-alpha'
  | 'length'
  | 'number-or-length'
  | 'expression';

const RULE_DESCRIPTION: Record<ValueRule, string> = {
  triplet: 'an HSL triplet (e.g. "175 84% 32%")',
  'triplet-or-reference': 'an HSL triplet or a var() reference to another token',
  'triplet-or-reference-with-optional-alpha':
    'an HSL triplet or var() reference, optionally followed by " / <alpha>"',
  length: 'a length (e.g. "0.5rem")',
  'number-or-length': 'a number, optionally with a unit',
  expression: 'a CSS value without quotes or escapes',
};

/**
 * The L2 semantic tokens, listed one by one because a pattern over them would
 * admit any name that happens to look similar. These are the tokens every
 * surface resolves through `hsl(var(--token))`, so a triplet is what they take.
 */
const SEMANTIC_TOKENS = new Set([
  '--background',
  '--border',
  '--foreground',
  '--input',
  '--ring',
  '--accent',
  '--accent-foreground',
  '--card',
  '--card-foreground',
  '--destructive',
  '--destructive-foreground',
  '--muted',
  '--muted-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
]);

const EXACT_RULES = new Map<string, ValueRule>([['--radius', 'length']]);

/**
 * The token families a theme may move, each with the shape its consumers can
 * parse. Order matters: the two `--nav-*` knobs have to be matched before the
 * family-wide rule that follows them.
 *
 * They are families rather than an enumeration because the list they stand for
 * is the stylesheet's, and it grows: `--palette-gray-*` retires with phase 2,
 * and a theme written against it must not start failing when it does. The
 * deliberate exclusions are recorded in §5.8 v4 — the short version is that
 * `--cc-syntax-*` has no stable names yet (§5.9), the geometry families
 * (`--safe-area-*`, `--mobile-*`, `--header-*`) are not a theme's business, and
 * `--tw-*` are framework internals behind `--ring`.
 */
const FAMILY_RULES: ReadonlyArray<{ pattern: RegExp; rule: ValueRule }> = [
  // L1 palette: the raw board every semantic token points at, always a triplet.
  { pattern: /^--palette-[a-z0-9-]+$/, rule: 'triplet' },
  // The compatibility scale (`--n-*`) and the graph lanes, both `hsl(var(--x))`.
  { pattern: /^--n-[a-z0-9-]+$/, rule: 'triplet-or-reference' },
  { pattern: /^--graph-lane-(?:[1-9]|10)$/, rule: 'triplet-or-reference' },
  // Terminal board. It has to be a triplet: `readTerminalTheme` resolves these
  // as `hsl(var(--term-…))`, so a hex here compiles to `hsl(#0b1220)` and the
  // declaration is dropped — the terminal silently keeps the previous colour.
  { pattern: /^--term-[a-z-]+$/, rule: 'triplet-or-reference' },
  // Editor chrome, consumed as a complete value rather than through `hsl()`.
  { pattern: /^--editor-[a-z-]+$/, rule: 'expression' },
  { pattern: /^--nav-(?:glass-blur|glass-saturate)$/, rule: 'number-or-length' },
  // The rest of the frosted-navigation board, all `<triplet> / <alpha>`.
  { pattern: /^--nav-[a-z-]+$/, rule: 'triplet-or-reference-with-optional-alpha' },
];

/** The rule for a token name, or null when a theme may not set it. */
function ruleForToken(token: string): ValueRule | null {
  const exact = EXACT_RULES.get(token);
  if (exact) return exact;
  if (SEMANTIC_TOKENS.has(token)) return 'triplet-or-reference';
  for (const family of FAMILY_RULES) {
    if (family.pattern.test(token)) return family.rule;
  }
  return null;
}

/**
 * Whether a `var()` reference points at a token a theme may set.
 *
 * A reference borrows its value rather than stating one, so accepting a target
 * outside the list would let a theme lean on something that is not part of the
 * contract it was written against — one of the numbered syntax variables, say,
 * whose meaning moves with the highlighter's own generator (§5.9). A reference
 * is only meaningful here when the same file could have set the target directly.
 */
function referencesThemableToken(value: string): boolean {
  const match = REFERENCE_PATTERN.exec(value);
  const target = match?.[1];
  return Boolean(target && ruleForToken(target) !== null);
}

function matchesRule(rule: ValueRule, value: string): boolean {
  switch (rule) {
    case 'triplet':
      return TRIPLET_PATTERN.test(value);
    case 'triplet-or-reference':
      return TRIPLET_PATTERN.test(value) || referencesThemableToken(value);
    case 'triplet-or-reference-with-optional-alpha': {
      const match = ALPHA_SUFFIX_PATTERN.exec(value);
      const base = match ? match[1] : value;
      return TRIPLET_PATTERN.test(base) || referencesThemableToken(base);
    }
    case 'length':
      return LENGTH_PATTERN.test(value);
    case 'number-or-length':
      return NUMBER_PATTERN.test(value);
    case 'expression':
      return EXPRESSION_PATTERN.test(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The selector the overlay is written under.
 *
 * `system` is unscoped and applies in both appearances, which is what a `.css`
 * theme does today, and what a `.tmTheme` always gets: a code theme states one
 * palette, not one per appearance. `light` and `dark` restrict it to one — the
 * construct the built-in themes already use (`[data-theme="cc-polar"]:not(.dark)`
 * and `[data-theme="cc-polar"].dark`, §5.3 v9): a theme whose values assume one
 * appearance must not be applied under the other, where they would meet the
 * other half's base values. `:not(.dark)` rather than a bare selector for the
 * light half, because a bare one also matches in the dark appearance and would
 * only lose to `.dark` on specificity — which is exactly the silent leak the
 * built-in overlays were given the same shape to prevent.
 *
 * Exported because the `.tmTheme` compiler writes the same selector: one shape,
 * one place to change it.
 */
export function themeOverlaySelector(themeId: string, scope: UserThemeAppearance): string {
  if (scope === 'light') return `[data-theme="${themeId}"]:not(.dark)`;
  if (scope === 'dark') return `[data-theme="${themeId}"].dark`;
  return `[data-theme="${themeId}"]`;
}

/** Reads the optional `appearance` scope, reporting anything unrecognised rather than guessing. */
function readAppearance(
  declared: unknown,
  ignored: IgnoredThemeEntry[],
): UserThemeAppearance {
  if (declared === undefined) return 'system';
  if (declared === 'system' || declared === 'light' || declared === 'dark') return declared;
  ignored.push({
    what: 'appearance',
    reason: 'is not one of "light", "dark" or "system"; the theme applies in both appearances',
  });
  return 'system';
}

/**
 * Compiles a `.json` theme body into an overlay stylesheet.
 *
 * `themeId` is the id the content is offered under — the listing's filename-derived
 * `user-…` for a file, or a pasted theme's `paste-…`; the file's own `name` and
 * `coverage` are read by whoever lists it, not here — this function only cares
 * about what the stylesheet needs.
 *
 * Returns the stylesheet, or why the file was refused, plus everything that was
 * dropped along the way so the caller can report it. Pure: it logs nothing and
 * touches no document.
 */
export function compileUserThemeTokens(themeId: string, body: string): UserThemeCompileResult {
  if (!isThemableThemeId(themeId)) {
    return { ok: false, reason: 'unsafe-id', token: themeId, ignored: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'unreadable-json', ignored: [] };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'unreadable-json', ignored: [] };

  const declaredTokens = parsed.tokens;
  if (!isRecord(declaredTokens) || Object.keys(declaredTokens).length === 0) {
    return { ok: false, reason: 'no-tokens', ignored: [] };
  }

  const ignored: IgnoredThemeEntry[] = [];
  const scope = readAppearance(parsed.appearance, ignored);
  const declarations: string[] = [];

  for (const [token, declaredValue] of Object.entries(declaredTokens)) {
    if (typeof declaredValue !== 'string') {
      ignored.push({ what: token, reason: 'is not a string' });
      continue;
    }
    if (UNSAFE_VALUE_PATTERN.test(declaredValue)) {
      return { ok: false, reason: 'unsafe-value', token, ignored };
    }

    const rule = ruleForToken(token);
    if (!rule) {
      ignored.push({ what: token, reason: 'is not a token a theme may set' });
      continue;
    }

    const value = declaredValue.trim();
    if (!value || value.length > MAX_VALUE_LENGTH || !matchesRule(rule, value)) {
      ignored.push({ what: token, reason: `is not ${RULE_DESCRIPTION[rule]}` });
      continue;
    }

    declarations.push(`  ${token}: ${value};`);
  }

  if (declarations.length === 0) {
    return { ok: false, reason: 'nothing-usable', ignored };
  }

  const selector = themeOverlaySelector(themeId, scope);
  return { ok: true, css: `${selector} {\n${declarations.join('\n')}\n}\n`, ignored };
}
