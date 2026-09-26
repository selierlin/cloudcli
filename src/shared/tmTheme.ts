import { SYNTAX_TOKEN_MAP } from '@/shared/syntaxTheme';
import type { SyntaxSemanticName } from '@/shared/syntaxTheme';
import type { ThemeContrastWarning } from '@/shared/userThemeContrast';
import type { IgnoredThemeEntry } from '@/shared/userThemeTokens';
import { compileUserThemeTokens, isThemableThemeId, themeOverlaySelector } from '@/shared/userThemeTokens';

/**
 * Option B2: a Sublime / TextMate `.tmTheme` compiled into the overlay stylesheet.
 *
 * §3.3 makes "eat the existing theme ecosystem" the reason this format exists at
 * all, and §5.5 B2 is what turns that into a promise: a Dracula / Nord /
 * Catppuccin `.tmTheme` dropped in `~/.cloudcli/themes` has to work as-is. So
 * this is a compiler, not a loader — the file arrives as text over the same route
 * as any other user theme, and what comes out is a `[data-theme]` overlay like
 * the other two formats produce.
 *
 * **What it reaches, and why that is less than the other formats — unless the
 * author asks for more.** A `.tmTheme` carries colours for *code*: a global
 * foreground / background / caret / selection, and a list of `scope` rules
 * naming the colour of keywords, strings, comments and so on. It has nothing to
 * say about the app's own surfaces — no `--card`, no `--border` — so the overlay
 * covers the syntax palette, the editor chrome and the terminal board, and
 * leaves the main UI on the base palette. A same-named `.css` cannot fill the
 * rest in (the listing de-duplicates by id, §5.8 v6), so the one way to widen
 * the reach is the optional `cloudcli` key: a top-level plist `<dict>` holding
 * option A's own payload (`tokens`, plus the optional `appearance` scope) and
 * optionally the file's `coverage` claim. The embedded block is compiled by the
 * option A compiler itself — this module hands it a JSON rendering of the dict,
 * so there is exactly one implementation of the whitelist, the value shapes, the
 * refusal semantics and the contrast warnings, and a plist cannot drift from a
 * `.json` that says the same thing (§5.5 v7). A dict that fails is dropped
 * whole, never the file: the TextMate half was judged by its own rules and
 * stands.
 *
 * `coverage` is not read here: it is a claim about the file, and the server
 * reads claims (§5.8) — a `.tmTheme` that declares one gets the picker badge,
 * one that does not is listed bare, exactly like a `.json`.
 *
 * **Two places the format needs translating rather than copying.** Both come from
 * one rule — a token's value has to be shaped like whatever consumes it (§5.9):
 *
 * - `--term-*` is consumed as `hsl(var(--term-…))`, so a hex value there compiles
 *   to `hsl(#282a36)`, which the browser drops and the terminal silently keeps
 *   its previous colour. Global colours are therefore converted to an HSL
 *   triplet for the terminal and left as hex everywhere else. This is exactly
 *   the bug §5.5 v3 records against option A's own example.
 * - `--cc-syntax-*` is consumed by the Prism style object as a complete value, so
 *   hex is right there — but the *names* are numbered, and the numbers come from
 *   `buildSyntaxTheme`. They are never written by hand here: the mapping is read
 *   from `SYNTAX_TOKEN_MAP`, the one place the semantic-name → number binding
 *   lives (§5.9). That is what keeps this compiler from binding a theme to a
 *   numbering a Prism bump would reorder.
 */

/** Why a whole `.tmTheme` file was refused. */
export type TmThemeCompileFailure =
  /** The id could not be written into a selector safely. */
  | 'unsafe-id'
  /** The body is not the plist XML a `.tmTheme` is. */
  | 'unreadable-plist'
  /** It parsed, but states no colour this app has a token for. */
  | 'nothing-usable';

export type TmThemeCompileResult =
  | {
      ok: true;
      css: string;
      ignored: IgnoredThemeEntry[];
      /**
       * The §5.10 verdicts the `cloudcli` key's own tokens earned. The TextMate
       * half speaks about syntax, editor and terminal tokens, none of which is
       * one of the pairs §5.10 puts a floor under — so with no embedded key this
       * is empty, and it is only ever non-empty because the author asked the
       * theme to move main-UI tokens too.
       */
      warnings: ThemeContrastWarning[];
    }
  | { ok: false; reason: TmThemeCompileFailure; ignored: IgnoredThemeEntry[] };

/**
 * The only value shape accepted out of a `.tmTheme`.
 *
 * These strings are written into a declaration, and unlike option A's values
 * they have not passed a whitelist first — so the rule is not "does this look
 * like a colour" but "may this text sit inside a declaration". A `#` and a run
 * of hexadecimal digits cannot end the declaration, cannot open an at-rule and
 * cannot escape the block, which is what lets everything downstream treat the
 * value as opaque. Named colours and `rgb()` / `hsl()` forms are therefore
 * *dropped and reported* rather than passed through; TextMate themes in the wild
 * are overwhelmingly hex.
 */
const HEX_COLOUR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The global rule's colours and the tokens they feed.
 *
 * `term` is the same colour converted to an HSL triplet; `expression` is the hex
 * itself. `selectionForeground` feeds the terminal alone — the editor has a
 * selection token but no token for the text drawn over a selection.
 */
const GLOBAL_COLOUR_TOKENS: ReadonlyArray<{
  key: string;
  term?: string;
  expression?: string;
}> = [
  { key: 'background', term: '--term-background', expression: '--editor-bg' },
  { key: 'foreground', term: '--term-foreground', expression: '--editor-fg' },
  { key: 'caret', term: '--term-cursor', expression: '--editor-caret' },
  { key: 'selection', term: '--term-selection-bg', expression: '--editor-selection' },
  { key: 'selectionForeground', term: '--term-selection-fg' },
  { key: 'lineHighlight', expression: '--editor-active-line-bg' },
];

/**
 * TextMate scope → the shared syntax slot it stands for.
 *
 * The slots are the ten semantic names `SYNTAX_TOKEN_MAP` already binds — the
 * ones the editor's highlighter and the chat renderer both consume — so this
 * table is the whole of the translation between the two ecosystems. A rule's
 * scope selector matches a pattern when it *is* that pattern or a dotted
 * descendant of it (`keyword.control` under `keyword`), which is TextMate's own
 * rule; when several patterns match, the longest wins, so `constant.numeric`
 * lands on `number` rather than on the wider `constant`.
 *
 * Rules are read in file order and the last match for a slot wins, which is how
 * TextMate resolves two rules of equal specificity. A scope no pattern claims is
 * simply not reported: this table is a deliberate ten-slot projection, not a
 * whitelist, so most of a real theme's scopes are expected to fall through.
 */
const SYNTAX_SCOPE_PATTERNS: ReadonlyArray<{ pattern: string; slot: SyntaxSemanticName }> = [
  { pattern: 'comment', slot: 'comment' },
  { pattern: 'string.other.link', slot: 'url' },
  { pattern: 'constant.other.reference.link', slot: 'url' },
  { pattern: 'markup.underline.link', slot: 'url' },
  { pattern: 'string', slot: 'string' },
  { pattern: 'constant.numeric', slot: 'number' },
  { pattern: 'constant', slot: 'constant' },
  { pattern: 'keyword', slot: 'keyword' },
  { pattern: 'entity.name.function', slot: 'function' },
  { pattern: 'support.function', slot: 'function' },
  { pattern: 'variable.function', slot: 'function' },
  { pattern: 'entity.name.type', slot: 'className' },
  { pattern: 'entity.name.class', slot: 'className' },
  { pattern: 'support.class', slot: 'className' },
  { pattern: 'entity.other.inherited-class', slot: 'className' },
  { pattern: 'variable.other.property', slot: 'property' },
  { pattern: 'meta.object-literal.key', slot: 'property' },
  { pattern: 'entity.other.attribute-name', slot: 'property' },
  { pattern: 'support.type.property-name', slot: 'property' },
  { pattern: 'punctuation', slot: 'punctuation' },
];

/** One `scope` rule: the scopes it claims, and the values it states. */
type TmThemeScopeRule = { scopes: string[]; foreground: string | null; fontStyle: string | null };

/** What a `.tmTheme` body says, before any of it has been judged. */
type ParsedTmTheme = {
  globals: Map<string, string>;
  rules: TmThemeScopeRule[];
  /** The optional `cloudcli` key's payload, already read out of the plist. */
  embedded: { tokens: Record<string, string>; appearance: string | null } | null;
};

/**
 * The `<key>`/value pairs of a plist `<dict>`.
 *
 * Plist stores a dictionary as a flat run of alternating `<key>` and value
 * elements, so this walks the children and pairs each key with the element after
 * it. A child that is not a `<key>` where one is expected ends the walk: at that
 * point the file is not shaped like a plist, and reading on would invent
 * structure the document does not have.
 */
function readDict(dict: Element): Map<string, Element> {
  const entries = new Map<string, Element>();
  const children = [...dict.children];

  for (let index = 0; index < children.length; index += 1) {
    const key = children[index];
    if (key.tagName !== 'key') break;
    const value = children[index + 1];
    if (!value) break;
    entries.set(key.textContent?.trim() ?? '', value);
    index += 1;
  }

  return entries;
}

/** The `<dict>` a plist key points at, or null when it points at anything else. */
function readChildDict(entries: Map<string, Element>, key: string): Element | null {
  const value = entries.get(key);
  return value?.tagName === 'dict' ? value : null;
}

/** A string value from a plist dict, or null when the key is absent or of another type. */
function readChildString(entries: Map<string, Element>, key: string): string | null {
  const value = entries.get(key);
  if (value?.tagName !== 'string') return null;
  const text = value.textContent?.trim();
  return text ? text : null;
}

/** The raw text of a plist value, whatever kind it is. Judged later, together with the rest. */
function readChildText(entries: Map<string, Element>, key: string): string | null {
  return entries.get(key)?.textContent?.trim() ?? null;
}

/**
 * What the optional `cloudcli` key states, in the shape the option A compiler
 * takes it.
 *
 * The key mirrors a `.json` theme's own object one plist dict at a time: `tokens`
 * is a `<dict>` of token name → string value, `appearance` the optional scope.
 * Both are read with the same leniency as anywhere else in this format — a
 * `tokens` that is not a `<dict>`, an `appearance` that is not a `<string>`, and
 * a token value that is not a `<string>` are each reported and dropped rather
 * than guessed at, because this file was written by a person and they have to be
 * able to see what did not take. Other keys the dict may carry (the file's
 * `coverage` claim among them) belong to the server's metadata channel and are
 * deliberately invisible here: this function returns what a *stylesheet* needs.
 */
function readEmbeddedCloudCli(
  entries: Map<string, Element>,
  ignored: IgnoredThemeEntry[],
): { tokens: Record<string, string>; appearance: string | null } | null {
  const dict = readChildDict(entries, 'cloudcli');
  if (!dict) return null;

  const values = readDict(dict);
  const tokens: Record<string, string> = {};
  const tokensElement = values.get('tokens');
  if (!tokensElement) {
    ignored.push({ what: 'cloudcli.tokens', reason: 'is missing; the embedded token block is ignored' });
  } else if (tokensElement.tagName !== 'dict') {
    ignored.push({ what: 'cloudcli.tokens', reason: 'is not a plist <dict>; the embedded token block is ignored' });
  } else {
    for (const [key, value] of readDict(tokensElement)) {
      if (value.tagName !== 'string') {
        ignored.push({ what: `cloudcli.${key}`, reason: 'is not a string value' });
        continue;
      }
      const text = value.textContent?.trim();
      if (text) tokens[key] = text;
    }
  }

  const appearanceElement = values.get('appearance');
  let appearance: string | null = null;
  if (appearanceElement) {
    if (appearanceElement.tagName !== 'string') {
      ignored.push({ what: 'cloudcli.appearance', reason: 'is not a string value' });
    } else {
      appearance = appearanceElement.textContent?.trim() ?? null;
    }
  }

  return { tokens, appearance };
}

/** The colour in a value, or null when it is not one this compiler may write out. */
function readColour(value: string | null | undefined): string | null {
  if (!value) return null;
  const colour = value.trim();
  return HEX_COLOUR_PATTERN.test(colour) ? colour : null;
}

/**
 * Turns a hexadecimal colour into the `H S% L%` triplet an `hsl()` consumer needs.
 *
 * Alpha is dropped rather than folded in: the tokens this feeds are consumed as
 * `hsl(var(--term-…))`, and that form has no slot for one. Rounding to whole
 * degrees and percentages keeps the output in the same shape the shipped palette
 * uses (`210 45% 8%`) at a cost of at most half a percent, which is well below
 * what a second palette's base colour can absorb.
 */
function hexToHslTriplet(hex: string): string {
  const digits = hex.slice(1);
  const expanded = digits.length <= 4
    ? [...digits].map((digit) => digit + digit).join('')
    : digits;
  const red = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const green = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return `0 0% ${Math.round(lightness * 100)}%`;

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  return `${Math.round(hue * 60)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

/** The slot a scope selector names, or null when no pattern claims it. */
function slotForScope(selector: string): SyntaxSemanticName | null {
  let best: { pattern: string; slot: SyntaxSemanticName } | null = null;

  for (const candidate of SYNTAX_SCOPE_PATTERNS) {
    const matches =
      selector === candidate.pattern || selector.startsWith(`${candidate.pattern}.`);
    if (!matches) continue;
    if (!best || candidate.pattern.length > best.pattern.length) best = candidate;
  }

  return best?.slot ?? null;
}

/**
 * Reads a `.tmTheme` body into the two things a compile needs: the global
 * colours as stated, and the scope rules.
 *
 * Returns null when the body is not a plist — a distinction worth keeping,
 * because "not a plist" is a refusal while "a plist that states nothing usable"
 * is a drop. `DOMParser` is the XML engine the browser already has; parsing this
 * format by hand would mean re-implementing entity handling and self-closing
 * tags to no benefit.
 */
function parseTmTheme(body: string, ignored: IgnoredThemeEntry[]): ParsedTmTheme | null {
  const parsedDocument = new DOMParser().parseFromString(body, 'application/xml');
  if (parsedDocument.querySelector('parsererror')) return null;

  const root = parsedDocument.documentElement;
  if (root?.tagName !== 'plist') return null;

  const top = root.firstElementChild;
  if (top?.tagName !== 'dict') return null;

  const topEntries = readDict(top);
  const settings = topEntries.get('settings');
  if (settings?.tagName !== 'array') return null;

  const globals = new Map<string, string>();
  const rules: TmThemeScopeRule[] = [];
  let sawGlobals = false;

  for (const entry of [...settings.children]) {
    if (entry.tagName !== 'dict') continue;
    const rule = readDict(entry);
    const declared = readChildDict(rule, 'settings');
    if (!declared) continue;
    const values = readDict(declared);
    const scope = readChildString(rule, 'scope');

    // The scope-less dict is the global rule, and only the first one is: a later
    // dict without a scope is structure this format does not define.
    if (!scope) {
      if (sawGlobals) continue;
      sawGlobals = true;
      for (const [key, value] of values) {
        const text = value.textContent?.trim();
        if (text) globals.set(key, text);
      }
      continue;
    }

    rules.push({
      scopes: scope.split(',').map((part) => part.trim()).filter(Boolean),
      foreground: readChildText(values, 'foreground'),
      fontStyle: readChildText(values, 'fontStyle'),
    });
  }

  return { globals, rules, embedded: readEmbeddedCloudCli(topEntries, ignored) };
}

/**
 * Compiles a `.tmTheme` body into the overlay stylesheet the app injects.
 *
 * `themeId` is the id the content is offered under, checked here because it ends
 * up inside a selector. Pure: it logs nothing and touches no document.
 */
export function compileTmTheme(themeId: string, body: string): TmThemeCompileResult {
  if (!isThemableThemeId(themeId)) {
    return { ok: false, reason: 'unsafe-id', ignored: [] };
  }

  const ignored: IgnoredThemeEntry[] = [];
  const parsed = parseTmTheme(body, ignored);
  if (!parsed) return { ok: false, reason: 'unreadable-plist', ignored: [] };
  const declarations = new Map<string, string>();

  for (const { key, term, expression } of GLOBAL_COLOUR_TOKENS) {
    const stated = parsed.globals.get(key);
    if (stated === undefined) continue;
    const colour = readColour(stated);
    if (!colour) {
      ignored.push({ what: key, reason: 'is not a hexadecimal colour' });
      continue;
    }
    if (term) declarations.set(term, hexToHslTriplet(colour));
    if (expression) declarations.set(expression, colour);
  }

  // The colour each slot ends with. A slot no rule mentions falls back to the
  // global foreground rather than to the base palette's colour: in TextMate an
  // unmentioned scope is simply the foreground, and leaving the base value there
  // would mix two palettes in one file.
  const slotColours = new Map<SyntaxSemanticName, string>();
  let sawFontStyle = false;

  for (const rule of parsed.rules) {
    if (rule.fontStyle) sawFontStyle = true;
    if (rule.foreground === null) continue;
    const colour = readColour(rule.foreground);
    if (!colour) {
      ignored.push({
        what: rule.scopes.join(', '),
        reason: 'has a foreground that is not a hexadecimal colour',
      });
      continue;
    }
    for (const selector of rule.scopes) {
      const slot = slotForScope(selector);
      if (slot) slotColours.set(slot, colour);
    }
  }

  if (sawFontStyle) {
    ignored.push({
      what: 'fontStyle',
      reason: 'is not carried: no token in this app takes a font style',
    });
  }

  const foreground = readColour(parsed.globals.get('foreground'));
  for (const slot of Object.keys(SYNTAX_TOKEN_MAP) as SyntaxSemanticName[]) {
    const colour = slotColours.get(slot) ?? foreground;
    if (colour) declarations.set(SYNTAX_TOKEN_MAP[slot], colour);
  }

  // The embedded `cloudcli` key, if the author wrote one, is the option A
  // payload restated in plist syntax — so it is judged by the option A compiler
  // itself, never by a second opinion. The dict is handed over as JSON, which is
  // exactly what it is: the same `{ tokens, appearance }` object a `.json`
  // theme's body would parse into. Everything the compiler reports is prefixed
  // `cloudcli.` so a console line cannot be mistaken for a TextMate half drop.
  //
  // A refusal here drops the embedded block and nothing else. The compiler's
  // verdict is scoped to the payload it was given; the TextMate half was judged
  // by its own rules and stands. `unreadable-json` cannot happen (the body was
  // stringified here) and `unsafe-id` was checked above, so every remaining
  // verdict means "drop the block, say why".
  let embeddedCss: string | null = null;
  let warnings: ThemeContrastWarning[] = [];
  if (parsed.embedded) {
    const { tokens, appearance } = parsed.embedded;
    const body: Record<string, unknown> = { tokens };
    if (appearance !== null) body.appearance = appearance;

    const compiled = compileUserThemeTokens(themeId, JSON.stringify(body));
    if (compiled.ok) {
      embeddedCss = compiled.css;
      warnings = compiled.warnings;
      ignored.push(...compiled.ignored.map(({ what, reason }) => ({ what: `cloudcli.${what}`, reason })));
    } else {
      ignored.push(...compiled.ignored.map(({ what, reason }) => ({ what: `cloudcli.${what}`, reason })));
      if (compiled.reason === 'unsafe-value') {
        ignored.push({
          what: `cloudcli.${compiled.token}`,
          reason: 'is not an option-A value; the whole embedded token block is refused',
        });
      } else {
        ignored.push({
          what: 'cloudcli',
          reason: `states no usable token (${compiled.reason}); the embedded token block is ignored`,
        });
      }
    }
  }

  if (declarations.size === 0 && embeddedCss === null) {
    return { ok: false, reason: 'nothing-usable', ignored };
  }

  const blocks: string[] = [];
  if (declarations.size > 0) {
    const lines = [...declarations].map(([token, value]) => `  ${token}: ${value};`);
    blocks.push(`${themeOverlaySelector(themeId, 'system')} {\n${lines.join('\n')}\n}\n`);
  }
  // The embedded block goes last. The two halves are plain declarations under
  // same-specificity selectors, so when both state one token — an embedded
  // `--term-background` meeting the TextMate global of the same name — document
  // order decides, and the key the author wrote *for this app* is the more
  // deliberate of the two statements.
  if (embeddedCss) blocks.push(embeddedCss);
  return { ok: true, css: blocks.join(''), ignored, warnings };
}
