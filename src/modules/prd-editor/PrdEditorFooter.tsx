import { useMemo } from 'react';

type PrdEditorFooterProps = {
  content: string;
};

type ContentStats = {
  lines: number;
  characters: number;
  words: number;
};

function getContentStats(content: string): ContentStats {
  return {
    lines: content.split('\n').length,
    characters: content.length,
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

/** Rendered by PrdEditorWorkspace inside the prd-editor module to show PRD line, character and word counts plus the shortcut hint. */
export default function PrdEditorFooter({ content }: PrdEditorFooterProps) {
  const stats = useMemo(() => getContentStats(content), [content]);

  return (
    <div className="flex flex-shrink-0 items-center justify-between border-t border-n-gray-200 bg-n-gray-50 p-3 dark:border-n-gray-700 dark:bg-n-gray-800">
      <div className="flex items-center gap-4 text-sm text-n-gray-600 dark:text-n-gray-400">
        <span>Lines: {stats.lines}</span>
        <span>Characters: {stats.characters}</span>
        <span>Words: {stats.words}</span>
        <span>Format: Markdown</span>
      </div>

      <div className="text-sm text-n-gray-500 dark:text-n-gray-400">Press Ctrl+S to save and Esc to close</div>
    </div>
  );
}
