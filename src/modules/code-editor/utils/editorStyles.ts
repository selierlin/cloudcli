/**
 * Static CSS for the editor's non-CodeMirror surfaces (the loading placeholder,
 * the merge/diff decorations and the toolbar panel), plus the styling the
 * unified-merge extension's generated nodes cannot get from `EditorView.theme`.
 *
 * Every colour is a `var()` reference so the stylesheet does not have to be
 * re-created when the appearance changes — the previous version took an
 * `isDarkMode` flag and baked the chosen colour into the string.
 */

export const EDITOR_LOADING_STYLES = `
    .code-editor-loading {
      background-color: var(--editor-loading-bg) !important;
    }

    .code-editor-loading:hover {
      background-color: var(--editor-loading-bg) !important;
    }
  `;

export const EDITOR_STYLES = `
    .cm-deletedChunk {
      background-color: var(--editor-diff-del-bg) !important;
      border-left: 3px solid var(--editor-diff-del-border) !important;
      padding-left: 4px !important;
    }

    .cm-insertedChunk {
      background-color: var(--editor-diff-add-bg) !important;
      border-left: 3px solid var(--editor-diff-add-border) !important;
      padding-left: 4px !important;
    }

    .cm-editor.cm-merge-b .cm-changedText {
      background: var(--editor-diff-add-text-bg) !important;
      padding-top: 2px !important;
      padding-bottom: 2px !important;
      margin-top: -2px !important;
      margin-bottom: -2px !important;
    }

    .cm-editor .cm-deletedChunk .cm-changedText {
      background: var(--editor-diff-del-text-bg) !important;
      padding-top: 2px !important;
      padding-bottom: 2px !important;
      margin-top: -2px !important;
      margin-bottom: -2px !important;
    }

    .cm-gutter.cm-gutter-minimap {
      background-color: var(--editor-minimap-bg);
    }

    .cm-editor-toolbar-panel {
      padding: 4px 10px;
      background-color: var(--editor-toolbar-bg);
      border-bottom: 1px solid var(--editor-toolbar-border);
      color: var(--editor-toolbar-fg);
      font-size: 12px;
    }

    .cm-diff-nav-btn,
    .cm-toolbar-btn {
      padding: 3px;
      background: transparent;
      border: none;
      cursor: pointer;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: inherit;
      transition: background-color 0.2s;
    }

    .cm-diff-nav-btn:hover,
    .cm-toolbar-btn:hover {
      background-color: var(--editor-toolbar-hover-bg);
    }

    .cm-diff-nav-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
