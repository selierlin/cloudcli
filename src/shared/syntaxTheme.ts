/**
 * The single Prism style object every highlighted code block in the app renders
 * with, plus the `:root` / `.dark` declarations backing its variables.
 *
 * `react-syntax-highlighter` re-tokenizes a block whenever its `style` prop
 * changes, so swapping between the light and dark theme objects re-highlighted
 * every mounted code block at once. Emitting one style object that reads
 * `var(--cc-syntax-N)` keeps the prop constant, so the theme toggle becomes a
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

      const variableName = `${VARIABLE_PREFIX}-${variableCount}`;
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

/**
 * The Prism selectors the rest of the app may reference by name, keyed by the
 * semantic role they play rather than by their number.
 *
 * The numbers themselves are an implementation detail: `buildSyntaxTheme`
 * assigns them in the order it happens to meet a difference while walking the
 * two themes, so a Prism bump that adds an attribute renumbers everything after
 * it. Consumers therefore never write a numbered variable by hand; they take
 * the variable from `SYNTAX_TOKEN_MAP`, which `deriveTokenMap` reads back out of
 * the generated sheet — the name/number binding lives here once, and the golden
 * mapping test fails loudly if the numbering ever shifts.
 *
 * `class-name`/`number` are the same colour in both One Dark themes, and
 * likewise the `url` slot is the only cyan; the CodeMirror highlighter maps its
 * tags onto these by colour group, which is why the keys look mismatched there.
 */
const SYNTAX_SELECTORS = {
  comment: 'comment.color',
  punctuation: 'punctuation.color',
  className: 'class-name.color',
  constant: 'constant.color',
  number: 'number.color',
  keyword: 'keyword.color',
  property: 'property.color',
  string: 'string.color',
  function: 'function.color',
  url: 'url.color',
} as const;

export type SyntaxSemanticName = keyof typeof SYNTAX_SELECTORS;

/** Every selector whose colour is theme-dependent, as `selector.property → --cc-syntax-N`. */
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

  for (const [name, key] of Object.entries(SYNTAX_SELECTORS) as [SyntaxSemanticName, string][]) {
    const variable = variables[key];
    // Throwing at module scope turns a renamed/removed Prism selector into a
    // build-time failure instead of a silently missing colour in the editor.
    if (!variable) {
      throw new Error(`syntax token "${name}" points at "${key}", which is not a theme-dependent value`);
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
