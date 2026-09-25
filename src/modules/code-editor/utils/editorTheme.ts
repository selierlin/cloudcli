import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { SYNTAX_TOKEN_MAP } from '@/shared/syntaxTheme';
import type { SyntaxSemanticName } from '@/shared/syntaxTheme';

/**
 * The editor's own theme, replacing `@codemirror/theme-one-dark`.
 *
 * Two things the upstream package bundled are now separate concerns:
 *
 * - `EditorView.theme()` paints the chrome (background, caret, selection,
 *   gutters, search, tooltips). Every colour is a `var()` reference, so a theme
 *   change repaints the editor without rebuilding a single extension.
 * - `HighlightStyle.define()` paints the tokens. It shares the Prism sheet with
 *   chat through `SYNTAX_TOKEN_MAP`, so one palette drives both renderers
 *   instead of the editor carrying a second, parallel naming scheme.
 *
 * Both appearances share one rule set, since the only structural difference is
 * the native `::selection` tint the dark theme adds. Each colour resolves
 * through a token, so moving one moves both appearances.
 */

/** The `var()` reference backing one of the shared Prism syntax slots. */
const syntax = (name: SyntaxSemanticName) => `var(${SYNTAX_TOKEN_MAP[name]})`;

/** The chrome rules both appearances share. Exported so the token guard can read them. */
export const editorChrome = {
  '&': {
    color: 'var(--editor-fg)',
    backgroundColor: 'var(--editor-bg)',
  },
  '.cm-content': {
    caretColor: 'var(--editor-caret)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-cursor)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--editor-selection)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection-focused)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-selection-match-bg)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--editor-search-match-bg)',
    outline: 'var(--editor-search-match-outline)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--editor-search-match-selected-bg)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line-bg)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--editor-matching-bracket-bg)' },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--editor-nonmatching-bracket-bg)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-gutter-bg)',
    color: 'var(--editor-gutter-fg)',
  },
  '.cm-gutters-before': { borderRight: 'var(--editor-gutter-separator)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line-gutter-bg)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--editor-fold-placeholder-bg)',
    border: 'var(--editor-fold-placeholder-border)',
    color: 'var(--editor-fold-placeholder-fg)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--editor-panel-bg)',
    color: 'var(--editor-panel-fg)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: 'var(--editor-panel-border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: 'var(--editor-panel-border)' },
  '.cm-tooltip': {
    border: 'var(--editor-tooltip-border)',
    backgroundColor: 'var(--editor-tooltip-bg)',
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: 'var(--editor-tooltip-arrow-border)',
    borderBottomColor: 'var(--editor-tooltip-arrow-border)',
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: 'var(--editor-tooltip-arrow)',
    borderBottomColor: 'var(--editor-tooltip-arrow)',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--editor-autocomplete-selected-bg)',
      color: 'var(--editor-autocomplete-selected-fg)',
    },
  },
};

export const editorLightTheme = EditorView.theme(editorChrome, { dark: false });

export const editorDarkTheme = EditorView.theme(
  {
    ...editorChrome,
    // Only the dark appearance tints the native selection; light leaves it to
    // the browser, which is why this rule is not part of the shared set.
    '.cm-content ::selection': { backgroundColor: 'var(--editor-selection-focused)' },
  },
  { dark: true },
);

export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: syntax('keyword') },
  {
    tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName],
    color: syntax('property'),
  },
  { tag: [tags.function(tags.variableName), tags.labelName], color: syntax('function') },
  {
    tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
    color: syntax('constant'),
  },
  { tag: [tags.definition(tags.name), tags.separator], color: syntax('punctuation') },
  { tag: [tags.typeName, tags.className], color: syntax('className') },
  {
    tag: [tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace],
    color: syntax('number'),
  },
  {
    tag: [
      tags.operator,
      tags.operatorKeyword,
      tags.url,
      tags.escape,
      tags.regexp,
      tags.link,
      tags.special(tags.string),
    ],
    color: syntax('url'),
  },
  { tag: [tags.meta, tags.comment], color: syntax('comment') },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  // Later specs win, so this overrides the cyan group above.
  { tag: tags.link, color: syntax('comment'), textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: syntax('property') },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: syntax('constant') },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: syntax('string') },
  // Prism has no slot for a parse error, so this one keeps its own token.
  { tag: tags.invalid, color: 'var(--editor-invalid)' },
]);

export const editorHighlightExtension = syntaxHighlighting(editorHighlightStyle);
