import { css } from '@codemirror/lang-css';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { SYNTAX_TOKEN_MAP } from '@/shared/syntaxTheme';

/**
 * The advanced mode's editing surface: a stylesheet with syntax highlighting
 * (§5.5).
 *
 * Used only by this module's `UserThemesSection`, and deliberately not the
 * code-editor module's surface: that one carries a document's concerns — a path,
 * a dirty flag, a save — none of which applies to a theme typed into a settings
 * box. What the two share is the palette, and it is shared through
 * `SYNTAX_TOKEN_MAP` rather than through a component, so this editor cannot
 * drift into a second naming scheme for the same colours.
 *
 * Every colour is a `var()` reference, so switching themes repaints the editor
 * without rebuilding an extension — the property the file editor relies on too
 * (§5.6 v10). The tag set is CSS's own: this surface only ever reads CSS.
 */

/** The `var()` reference backing one of the shared Prism syntax slots. */
const syntax = (name: keyof typeof SYNTAX_TOKEN_MAP) => `var(${SYNTAX_TOKEN_MAP[name]})`;

/** The tokens `@codemirror/lang-css` tells apart, in the palette's terms. */
const themeCssHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: syntax('comment'), fontStyle: 'italic' },
  { tag: tags.propertyName, color: syntax('property') },
  { tag: [tags.className, tags.typeName], color: syntax('className') },
  { tag: tags.keyword, color: syntax('keyword') },
  { tag: [tags.number, tags.unit], color: syntax('number') },
  { tag: [tags.color, tags.atom], color: syntax('constant') },
  { tag: [tags.string, tags.special(tags.string)], color: syntax('string') },
  { tag: tags.variableName, color: syntax('property') },
  {
    tag: [tags.punctuation, tags.separator, tags.bracket, tags.operator],
    color: syntax('punctuation'),
  },
  { tag: tags.invalid, color: 'var(--editor-invalid)' },
]);

/**
 * The editor's chrome, in the palette's terms — only the rules this surface has
 * a use for, since it has no gutters, search panel or tooltips.
 */
const chrome = (isDarkMode: boolean) =>
  EditorView.theme(
    {
      '&': {
        color: 'var(--editor-fg)',
        backgroundColor: 'var(--editor-bg)',
        fontSize: '0.75rem',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-content': { caretColor: 'var(--editor-caret)', padding: '0.5rem 0' },
      '.cm-scroller': { lineHeight: '1.5' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-cursor)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--editor-selection-focused)',
      },
    },
    { dark: isDarkMode },
  );

type ThemeCssEditorProps = {
  /** The id the section's label points at, so the label still describes this control. */
  id: string;
  /** The example shown while the box is empty; each format has its own. */
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
};

/** Rendered by `UserThemesSection` in advanced mode, as the paste box's CSS surface. */
export default function ThemeCssEditor({ id, placeholder, value, onChange }: ThemeCssEditorProps) {
  const { t } = useTranslation('settings');
  const { isDarkMode } = useTheme();

  const extensions = useMemo(
    () => [
      css(),
      syntaxHighlighting(themeCssHighlightStyle),
      // The editable region is a `contenteditable` div rather than a form
      // control, so the `<label>` above cannot give it a name; it has to be
      // attached to the region itself.
      EditorView.contentAttributes.of({ 'aria-label': t('userThemes.pasteLabel') }),
    ],
    [t],
  );

  const theme = useMemo(() => chrome(isDarkMode), [isDarkMode]);

  return (
    <CodeMirror
      id={id}
      className="mt-1 overflow-hidden rounded-lg border border-input bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      extensions={extensions}
      theme={theme}
      height="8rem"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        highlightSelectionMatches: false,
        searchKeymap: false,
        syntaxHighlighting: false,
        tabSize: 2,
      }}
    />
  );
}
