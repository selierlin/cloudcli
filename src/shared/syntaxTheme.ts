/**
 * The single Prism style object every highlighted code block in the app renders
 * with, plus the `:root` / `.dark` declarations backing its variables.
 *
 * `react-syntax-highlighter` re-tokenizes a block whenever its `style` prop
 * changes, so swapping between the light and dark theme objects re-highlighted
 * every mounted code block at once. Emitting one style object that reads
 * `var(--cc-syntax-*)` keeps the prop constant, so the theme toggle becomes a
 * CSS variable flip and memoized markdown keeps its tokenization.
 *
 * The variables are derived from the two source themes rather than hand-written,
 * so the rendered colours are the same values Prism used before.
 *
 * Shared because both markdown renderers need it: chat's `Markdown` and
 * code-editor's `MarkdownCodeBlock`. code-editor cannot import chat's copy —
 * chat already imports code-editor's `MermaidDiagram`, so that direction would
 * close a module cycle.
 */

import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

export type PrismStyleSheet = Record<string, Record<string, string>>;

const VARIABLE_PREFIX = '--cc-syntax';

export type SyntaxTheme = {
  /** Style object handed to SyntaxHighlighter. Stable across theme changes. */
  style: PrismStyleSheet;
  /** `:root` / `.dark` declarations backing every variable in `style`. */
  css: string;
};

/**
 * The Prism slots the app may name, each bound to the contract token it is
 * published under.
 *
 * **This table is the contract surface, and its keys are the only definition of
 * "a syntax token".** The generator's reverse lookup, the user-theme whitelist's
 * family pattern and the all-or-nothing check each have to agree with it, so
 * none of them may carry a hand-written list or a second pattern of its own
 * (§6.4) — a name this table spells differently would otherwise fail *silently*
 * in one of the three.
 *
 * Ten entries name the colour of one Prism token class, and a built-in overlay
 * that sets them makes every highlighted block in the app follow that theme.
 * - `comment`, `punctuation`, `className`, `constant`, `number`, `keyword`,
 *   `property`, `string`, `function`, `url` — the shared slots the editor's
 *   CodeMirror tags and the chat renderer both resolve through (§5.11). The
 *   editor maps its tags onto them by *colour group* rather than by meaning, so
 *   a few names stand for a Prism class that spells the role differently —
 *   `class-name` and `number` share a colour in both shipped Prism themes, and
 *   `url` is the only cyan. The names follow the group, which is why they look
 *   mismatched against the editor's tags.
 *
 * The eleventh is not a token class but the fallback colour of the block
 * itself — the colour text takes when no token rule matches it:
 * - `blockForeground` → `pre[class*="language-"].color`. It is bound to `<pre>`
 *   rather than `<code>` because `react-syntax-highlighter` only falls back to
 *   its default `codeTagProps` when the caller passes none, and both callers
 *   (chat's `Markdown`, code-editor's `MarkdownCodeBlock`) pass their own — so
 *   the `code[…]` family never reaches the page and the block's body colour is
 *   the one `<pre>` inherits down to `<code>`. It carries no `-color` suffix
 *   because it is not a token's colour; the whitelist pattern admits both
 *   spellings, deliberately.
 *
 * A slot that is none of those eleven but already carries one of their ten
 * colours is *bound* to that colour's token rather than numbered — see
 * `SYNTAX_SLOT_GROUPS`. Binding publishes no new name and adds no new variable:
 * it only makes the ten tokens a theme already sets reach the rest of the block,
 * so no rendered token is left wearing the base palette's colour under a theme.
 * The match is by colour, not by meaning — the same rule the editor's tag
 * mapping follows — which is why a slot sits under a token whose name does not
 * describe it (`tag` under `property`, `boolean` under `constant`).
 *
 * Everything else in the sheet stays numbered, and for a reason rather than by
 * omission. `buildSyntaxTheme` numbers the rest in the order the two themes
 * happen to differ, so those numbers move when Prism does, and publishing one
 * as a contract would pin a theme to a Prism version (§5.9). Explicitly *not*
 * named, with the reason each one would otherwise look like an oversight:
 *
 * - `0` `1` `2` `code[class*="language-"]` `.background` / `.color` /
 *   `.textShadow` — never applied: both callers pass their own `codeTagProps`.
 * - `3` `pre[class*="language-"].background` — half-live: the editor's dark half
 *   falls back to it, its light half and chat's both appearances override it.
 *   The panel colour is a separate question with its own token (see the
 *   code-block background work, §5.1b of the plan).
 * - `5` `pre[class*="language-"].textShadow` — dark-only: the light Prism theme
 *   omits it, so naming it would demand a base value no source has, and nothing
 *   consumes it.
 * - `6`–`17` — twelve `::selection` keys across `code[…]`, `pre[…]` and their
 *   descendants. This library never serializes the style object into CSS: it
 *   looks colours up *by class name* (`createStyleObject`) and inlines the rest
 *   through `preProps` / `codeTagProps`, so a selector key has no path to the
 *   page at all. Naming one would not create that path.
 */
const SYNTAX_SELECTORS = {
  comment: { slot: 'comment.color', token: '--cc-syntax-comment-color' },
  punctuation: { slot: 'punctuation.color', token: '--cc-syntax-punctuation-color' },
  className: { slot: 'class-name.color', token: '--cc-syntax-class-name-color' },
  constant: { slot: 'constant.color', token: '--cc-syntax-constant-color' },
  number: { slot: 'number.color', token: '--cc-syntax-number-color' },
  keyword: { slot: 'keyword.color', token: '--cc-syntax-keyword-color' },
  property: { slot: 'property.color', token: '--cc-syntax-property-color' },
  string: { slot: 'string.color', token: '--cc-syntax-string-color' },
  function: { slot: 'function.color', token: '--cc-syntax-function-color' },
  url: { slot: 'url.color', token: '--cc-syntax-url-color' },
  blockForeground: {
    slot: 'pre[class*="language-"].color',
    token: '--cc-syntax-block-foreground',
  },
} as const;

export type SyntaxSemanticName = keyof typeof SYNTAX_SELECTORS;

/** `selector.property` → the name that slot is published under, for the generator's lookup. */
const SEMANTIC_TOKEN_BY_SLOT: ReadonlyMap<string, string> = new Map(
  Object.values(SYNTAX_SELECTORS).map(({ slot, token }) => [slot, token] as const),
);

/**
 * Every *other* slot that already carries one of the ten named colours, grouped
 * under the token that colour is published as.
 *
 * These are the slots that used to be numbered, and a numbered slot is one a
 * theme cannot reach: the ten names above only ever moved the eleven selectors
 * they are bound to, so under a built-in theme the rest of a block — HTML tags,
 * booleans, `@media`, diff insertion/deletion lines, markdown emphasis, CSS
 * property names — kept the base Prism palette's colours and read as foreign
 * text inside the theme's block. Binding them here makes the ten tokens cover
 * the whole block without publishing a single new name, so every theme that
 * already sets a board (the built-ins, a `.json`, a `.css`, a `.tmTheme`) gets
 * the uncovered roles for free.
 *
 * **Why the binding is by colour and not by meaning.** The choice is forced:
 * the whole point is to leave the base appearance byte-identical, and a slot may
 * only be bound to a token whose value it already equals. So `tag` goes to
 * `property` because both are One Dark's red, `boolean` to `constant` because
 * both are its orange — not because the names describe them. That is the same
 * rule `editorTheme.ts` follows when it maps its tags onto these tokens, and it
 * is why the names here look mismatched against the Prism classes beside them.
 *
 * The two slot families with no group are deliberately absent and stay numbered:
 * the whitespace markers (`token.tab:before`, `token.cr:before`, …) are the one
 * translucent colour in the sheet, and the template-literal interpolation
 * punctuation (`…interpolation-punctuation.punctuation.color`) is its own pink
 * in both source themes — binding either would have to change the base value.
 * Prism plugin chrome (code-toolbar, line-highlight, prism-previewer,
 * line-numbers, command-line) is absent too: it is not a token, and a theme
 * naming it is out of scope. The rainbow-brace slots *are* punctuation colours,
 * so they are grouped; the plugin is optional and grouping them costs nothing.
 *
 * The `constant` group stands for the orange that `className` and `number` share
 * in both source themes. A theme is free to split those three apart, and then
 * the slots below follow `constant` — the group's representative, chosen because
 * `attr-name` / `boolean` / `atrule` / `null` are the literal-like roles.
 */
const SYNTAX_SLOT_GROUPS: ReadonlyArray<{
  group: SyntaxSemanticName;
  slots: readonly string[];
}> = [
  {
    group: 'comment',
    slots: [
      'prolog.color',
      'cdata.color',
      '.language-markdown .token.blockquote.punctuation.color',
      '.language-markdown .token.hr.punctuation.color',
    ],
  },
  {
    group: 'punctuation',
    slots: [
      'doctype.color',
      'entity.color',
      'attr-value > .token.punctuation.attr-equals.color',
      'special-attr > .token.attr-value > .token.value.css.color',
      '.language-css .token.property.color',
      '.language-json .token.operator.color',
      '.language-markdown .token.url.color',
      '.language-markdown .token.url > .token.operator.color',
      '.language-markdown .token.url-reference.url > .token.string.color',
    ],
  },
  {
    group: 'constant',
    slots: [
      'attr-name.color',
      'boolean.color',
      'atrule.color',
      '.language-json .token.null.keyword.color',
      '.language-markdown .token.bold .token.content.color',
    ],
  },
  {
    group: 'keyword',
    slots: [
      '.language-css .token.important.color',
      '.language-css .token.atrule .token.rule.color',
      '.language-javascript .token.operator.color',
      '.language-markdown .token.italic .token.content.color',
      '.rainbow-braces .token.token.punctuation.brace-level-4.color',
      '.rainbow-braces .token.token.punctuation.brace-level-8.color',
      '.rainbow-braces .token.token.punctuation.brace-level-12.color',
    ],
  },
  {
    group: 'property',
    slots: [
      'tag.color',
      'symbol.color',
      'deleted.color',
      'important.color',
      '.language-css .token.selector.color',
      '.language-markdown .token.strike .token.content.color',
      '.language-markdown .token.strike .token.punctuation.color',
      '.language-markdown .token.list.punctuation.color',
      '.language-markdown .token.title.important > .token.punctuation.color',
      '.rainbow-braces .token.token.punctuation.brace-level-1.color',
      '.rainbow-braces .token.token.punctuation.brace-level-5.color',
      '.rainbow-braces .token.token.punctuation.brace-level-9.color',
    ],
  },
  {
    group: 'string',
    slots: [
      'selector.color',
      'char.color',
      'builtin.color',
      'inserted.color',
      'regex.color',
      'attr-value.color',
      'attr-value > .token.punctuation.color',
      '.language-css .token.url > .token.string.url.color',
      '.language-markdown .token.code-snippet.color',
      '.rainbow-braces .token.token.punctuation.brace-level-2.color',
      '.rainbow-braces .token.token.punctuation.brace-level-6.color',
      '.rainbow-braces .token.token.punctuation.brace-level-10.color',
    ],
  },
  {
    group: 'function',
    slots: [
      'variable.color',
      'operator.color',
      '.language-markdown .token.url > .token.content.color',
      '.rainbow-braces .token.token.punctuation.brace-level-3.color',
      '.rainbow-braces .token.token.punctuation.brace-level-7.color',
      '.rainbow-braces .token.token.punctuation.brace-level-11.color',
    ],
  },
  {
    group: 'url',
    slots: [
      '.language-css .token.function.color',
      '.language-css .token.url > .token.function.color',
      '.language-markdown .token.url > .token.url.color',
      '.language-markdown .token.url-reference.url.color',
    ],
  },
];

/** `selector.property` → the colour group it is bound to, for the generator's lookup. */
const SLOT_GROUP: ReadonlyMap<string, SyntaxSemanticName> = new Map(
  SYNTAX_SLOT_GROUPS.flatMap(({ group, slots }) => slots.map((slot) => [slot, group] as const)),
);

export function buildSyntaxTheme(light: PrismStyleSheet, dark: PrismStyleSheet): SyntaxTheme {
  const style: PrismStyleSheet = {};
  const lightDeclarations: string[] = [];
  const darkDeclarations: string[] = [];
  let variableCount = 0;

  for (const selector of unionKeys(light, dark)) {
    const lightRule = light[selector] ?? {};
    const darkRule = dark[selector] ?? {};
    const merged: Record<string, string> = {};

    for (const property of unionKeys(lightRule, darkRule)) {
      const lightValue = lightRule[property];
      const darkValue = darkRule[property];

      // Identical in both themes: no variable needed.
      if (lightValue === darkValue) {
        merged[property] = lightValue;
        continue;
      }

      const key = `${selector}.${property}`;

      // A slot bound to a colour group reads that group's token and declares
      // nothing of its own: the token is declared by the slot it is named for,
      // and the two hold the same value in both source themes. The counter still
      // advances, so binding a slot does not renumber the ones after it.
      const group = SLOT_GROUP.get(key);
      if (group) {
        variableCount += 1;
        merged[property] = `var(${SYNTAX_SELECTORS[group].token})`;
        continue;
      }

      // A slot on the contract surface is published under its stable name; every
      // other slot keeps the number that used to be the only handle on it. The
      // counter advances either way, so naming a slot does not renumber the
      // ones after it: a number means "position in the difference sequence",
      // not "how many slots are still unnamed".
      const named = SEMANTIC_TOKEN_BY_SLOT.get(key);
      const variableName = named ?? `${VARIABLE_PREFIX}-${variableCount}`;
      variableCount += 1;
      merged[property] = `var(${variableName})`;

      // A theme that omits the property leaves the variable undefined, which
      // makes the declaration invalid and drops it — the same result as the
      // theme not setting it. Only the light theme omits properties in the pair
      // this app ships, so the dark side is written unconditionally.
      if (lightValue !== undefined) {
        lightDeclarations.push(`${variableName}:${lightValue};`);
      }
      darkDeclarations.push(`${variableName}:${darkValue};`);
    }

    style[selector] = merged;
  }

  return {
    style,
    css: `:root{${lightDeclarations.join('')}}\n.dark{${darkDeclarations.join('')}}`,
  };
}

function unionKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])];
}

/** The instance both markdown renderers render with. One instance keeps the injected stylesheet unique. */
export const syntaxTheme = buildSyntaxTheme(oneLight as PrismStyleSheet, oneDark as PrismStyleSheet);

/** Every selector whose colour is theme-dependent, as `selector.property → --cc-syntax-*`. */
export function collectSyntaxVariables(style: PrismStyleSheet): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const [selector, rule] of Object.entries(style)) {
    for (const [property, value] of Object.entries(rule)) {
      if (value.startsWith('var(--cc-syntax-')) {
        variables[`${selector}.${property}`] = value.slice('var('.length, -1);
      }
    }
  }

  return variables;
}

function deriveTokenMap(): Record<SyntaxSemanticName, string> {
  const variables = collectSyntaxVariables(syntaxTheme.style);
  const tokens = {} as Record<SyntaxSemanticName, string>;

  for (const [name, { slot }] of Object.entries(SYNTAX_SELECTORS) as [
    SyntaxSemanticName,
    { slot: string },
  ][]) {
    const variable = variables[slot];
    // Throwing at module scope turns a renamed/removed Prism selector into a
    // build-time failure instead of a silently missing colour in the editor.
    if (!variable) {
      throw new Error(`syntax token "${name}" points at "${slot}", which is not a theme-dependent value`);
    }
    tokens[name] = variable;
  }

  return tokens;
}

/** Semantic name → the CSS variable carrying its colour, for renderers that cannot use the Prism style object. */
export const SYNTAX_TOKEN_MAP = deriveTokenMap();

const STYLE_ELEMENT_ID = 'cc-syntax-theme';

/**
 * Puts the syntax palette in the document, ahead of everything else in `<head>`.
 *
 * These variables are a *base* layer, and a user theme is an overlay that has to
 * be able to move them — a `.tmTheme` compiles to exactly these names, and a
 * `.css` theme can set them too. Both sides declare on the same element (`:root`
 * and `[data-theme="…"]` both match `<html>`, and weigh the same), so the one
 * that comes *later* in document order wins, and an overlay's element is
 * appended to the end of `<head>`. Landing at the front is therefore what makes
 * an override work regardless of when this runs: if it ran after an overlay had
 * been injected, appending would put the base palette last and the theme's
 * syntax colours would be discarded without a word.
 *
 * The values are derived from the Prism theme objects at runtime, so they cannot
 * live in `index.css`; `ThemeContext` toggles `.dark` on `<html>`, which is what
 * repaints the tokens. The id check keeps the element unique across a
 * re-evaluation — and is why a caller that wants to exercise the ordering above
 * removes the element before calling this again: a normal import runs once,
 * before any overlay exists.
 *
 * Exported for the tests that drive the late-injection case, where a decoy
 * element is already in `<head>`.
 */
export function ensureSyntaxStyleElement(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const styleElement = document.createElement('style');
  styleElement.id = STYLE_ELEMENT_ID;
  styleElement.textContent = syntaxTheme.css;
  document.head.insertBefore(styleElement, document.head.firstChild);
}

ensureSyntaxStyleElement();
