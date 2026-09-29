import { useState } from 'react';
import type { ComponentProps } from 'react';

import { copyTextToClipboard } from '@/shared/utils';
import { SyntaxHighlighter } from '@/shared/syntaxHighlighter';
import { syntaxTheme } from '@/shared/syntaxTheme';
import MermaidDiagram from '@/modules/code-editor/markdown/MermaidDiagram';

type MarkdownCodeBlockProps = {
  inline?: boolean;
  node?: unknown;
} & ComponentProps<'code'>;

/** Used by MarkdownPreview inside the code-editor module to render fenced code blocks with syntax highlighting, copy support and mermaid diagrams. */
export default function MarkdownCodeBlock({
  inline,
  className,
  children,
  node: _node,
  ...props
}: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const rawContent = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(rawContent);
  const shouldRenderInline = inline || !looksMultiline;

  if (shouldRenderInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-n-gray-200 bg-n-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-n-gray-900 dark:border-n-gray-700 dark:bg-n-gray-800/60 dark:text-n-gray-100 ${className || ''}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const languageMatch = /language-(\w+)/.exec(className || '');
  const language = languageMatch ? languageMatch[1] : 'text';

  if (language === 'mermaid') {
    return <MermaidDiagram code={rawContent} />;
  }

  return (
    <div className="group relative my-2">
      {language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-n-gray-400">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(rawContent).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })}
        className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-foreground/80 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>

      <SyntaxHighlighter
        language={language}
        style={syntaxTheme.style}
        customStyle={{
          margin: 0,
          borderRadius: '0.75rem',
          fontSize: '0.875rem',
          padding: language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
          // Both appearances draw the same token; the dark half used to fall
          // through to Prism's own `pre` background instead.
          background: 'hsl(var(--code-block-bg))',
        }}
        codeTagProps={{ style: { background: 'transparent' } }}
      >
        {rawContent}
      </SyntaxHighlighter>
    </div>
  );
}
