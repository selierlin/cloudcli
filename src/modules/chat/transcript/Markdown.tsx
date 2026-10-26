import React, { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
// The `parseOnly` entry, not the default one: rendering never serializes an mdast
// back to Markdown, so this keeps the serializer out of the client bundle.
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useTranslation } from 'react-i18next';

import { MermaidDiagram } from '@/modules/code-editor';
import { MarkdownImage } from '@/modules/chat/transcript/MarkdownImage';
import ExportCopyButton from '@/modules/chat/transcript/ExportCopyButton';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { normalizeInlineCodeFences } from '@/modules/chat/utils/chatFormatting';
import { normalizeLatexDelimiters } from '@/modules/chat/utils/latexDelimiters';
import { copyTextToClipboard } from '@/shared/utils';
import { SyntaxHighlighter } from '@/shared/syntaxHighlighter';
import { syntaxTheme } from '@/shared/syntaxTheme';
import { usePaletteOps } from '@/modules/command-palette';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  /** Render single newlines as hard line breaks (for user-typed messages). */
  breaks?: boolean;
};

type CopyButtonProps = {
  /** Returns the text to place on the clipboard at click time. */
  getText: () => string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
};

// Hover-revealed clipboard button shared by code blocks and tables. The parent
// must carry the Tailwind `group` class for the reveal-on-hover to work.
const CopyButton = ({ getText, copyLabel, copiedLabel, className = '' }: CopyButtonProps) => {
  const isExporting = useIsExportingTranscript();
  // Marks a recent successful copy so the icon and title can flip to a check.
  const [copied, setCopied] = useState(false);
  // A document has no React handlers: the page's own click listener does the
  // copying, reading the enclosing block, and nothing hovers a static page —
  // so the control has to be visible as rendered.
  if (isExporting) {
    return (
      <ExportCopyButton
        label={copyLabel}
        className={`rounded-md p-1 text-muted-foreground ${className}`}
        iconClassName="h-4 w-4"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        copyTextToClipboard(getText()).then((success) => {
          if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        })
      }
      className={`rounded-md p-1 transition-opacity focus-visible:opacity-100 ${copied
        ? 'text-green-600 opacity-100 dark:text-green-500'
        : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'
        } ${className}`}
      title={copied ? copiedLabel : copyLabel}
      aria-label={copied ? copiedLabel : copyLabel}
    >
      {copied ? (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
        </svg>
      )}
    </button>
  );
};

const MarkdownTable = ({ children, scrollHint }: { children?: React.ReactNode; scrollHint: string }) => {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  return (
    // The outer wrapper owns `relative` + `group` so the copy button stays
    // pinned to the visible top-right corner while the table scrolls beneath it.
    // The export shows that button permanently, so the last header cell gets
    // extra room on wide screens; on a phone the table is wider than the
    // viewport and the icon would sit on top of the first characters, so it is
    // hidden there and the message-level copy stays the way to grab the table.
    <div
      className={`group relative my-3${isExporting ? ' sm:[&_thead_th:last-child]:pr-10' : ''}`}
      data-export-copy-group={isExporting ? 'table' : undefined}
    >
      <CopyButton
        getText={() => childrenToTSV(children)}
        copyLabel={t('codeBlock.copy', { defaultValue: 'Copy' })}
        copiedLabel={t('codeBlock.copied', { defaultValue: 'Copied' })}
        className={`absolute right-2 top-2 z-10 bg-muted/80 backdrop-blur-sm${isExporting ? ' max-sm:hidden' : ''}`}
      />
      <div className="markdown-table-wrapper overflow-x-auto rounded-lg border border-border">
        {/* my-0 cancels Tailwind Typography's table margin, which would show as blank bands inside the border */}
        <table className="markdown-table my-0 min-w-full border-collapse text-sm">{children}</table>
        <div className="markdown-table-scroll-hint" aria-hidden="true">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 8l-4 4 4 4" />
            <path d="M17 8l4 4-4 4" />
            <path d="M3 12h18" />
          </svg>
          <span>{scrollHint}</span>
        </div>
      </div>
    </div>
  );
};

// Links to the wider web (or in-page anchors) keep normal browser navigation;
// everything else is treated as a workspace file reference.
const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

// Read the trailing `:line` / `:line:col` suffix so the editor can reveal it.
// Both this and stripLineSuffix are anchored at the end, so callers pass an
// already-trimmed reference.
const lineFromRef = (value: string): number | null => {
  const match = value.match(/:(\d+)(?::\d+)?$/);
  return match ? Number(match[1]) : null;
};

// Strip a trailing `:line` / `:line:col` suffix (e.g. `src/foo.ts:130`).
const stripLineSuffix = (value: string): string => value.replace(/:\d+(?::\d+)?$/, '');

// A usable file path contains a separator or a filename with an extension.
const looksLikeFilePath = (value?: string): value is string => {
  if (!value) {
    return false;
  }
  const cleaned = stripLineSuffix(value.trim());
  if (!cleaned || cleaned === '#') {
    return false;
  }
  return /[\\/]/.test(cleaned) || /\.[a-z0-9]+$/i.test(cleaned);
};

// Extract plain text from link children so a reference rendered only as link
// text (e.g. `[src/foo.ts]()` with an empty href) can still be opened.
const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

// Flatten a table's React subtree (thead/tbody > tr > th/td) into TSV so the
// copied text pastes into spreadsheets with rows and columns intact: cells are
// separated by tabs and rows by newlines. Cell contents go through
// childrenToText to survive inline elements like links or code spans; embedded
// whitespace is collapsed so a multi-line cell cannot break the row structure.
const childrenToTSV = (children: React.ReactNode): string => {
  const rows: string[] = [];
  React.Children.forEach(children, (section) => {
    if (!React.isValidElement(section)) {
      return;
    }
    const sectionChildren = (section.props as { children?: React.ReactNode }).children;
    React.Children.forEach(sectionChildren, (row) => {
      if (!React.isValidElement(row)) {
        return;
      }
      const cells = React.Children.toArray((row.props as { children?: React.ReactNode }).children);
      rows.push(cells.map((cell) => childrenToText(cell).replace(/\s+/g, ' ').trim()).join('\t'));
    });
  });
  return rows.join('\n');
};

// The only delimiter `remark-math` recognizes with `singleDollarTextMath` off.
// `\(…\)` and `\[…\]` are already rewritten to `$$` by normalizeLatexDelimiters,
// so this one probe covers both notations.
const MATH_DELIMITER = /\$\$/;

const EMPTY_PLUGINS: never[] = [];

type CodeBlockProps = {
  node?: any;
  className?: string;
  children?: React.ReactNode;
  /** Set by the custom `pre` renderer: this code element is a fenced/indented block. */
  forceBlock?: boolean;
};

// `node` is destructured out so react-markdown's hast node never reaches the DOM.
const CodeBlock = ({ node: _node, className, children, forceBlock, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  // Fenced blocks carry a trailing newline in the tree; trim it so the
  // highlighter doesn't render an empty final line.
  const raw = (Array.isArray(children) ? children.join('') : String(children ?? '')).replace(/\n$/, '');
  // react-markdown v9+ dropped the `inline` prop: block code is whatever the
  // `pre` renderer hands us (forceBlock). Multiline is kept as a safety net.
  const shouldInline = !forceBlock && !/[\r\n]/.test(raw);

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted px-1.5 py-0.5 text-foreground ${className || ''
          }`}
        style={{
          // Code font is user-configurable; falls back to the system mono stack.
          fontFamily: 'var(--ui-code-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
          fontSize: 'var(--ui-code-font-size, 0.875em)',
        }}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const languageLabel = language.charAt(0).toUpperCase() + language.slice(1);

  if (language === 'mermaid') {
    return <MermaidDiagram code={raw} />;
  }

  return (
    <div
      className="markdown-code-block group my-3 overflow-hidden rounded-xl border border-border bg-code-block/50 shadow-sm dark:bg-code-block"
      // The export listener scopes a code block's copy to this element so the
      // language label above the code never joins the copied text.
      data-export-copy-group={isExporting ? 'code' : undefined}
    >
      {/* Label row shares the block's background — no divider, ChatGPT-style */}
      <div className="flex items-center justify-between px-4 pt-2">
        <span className="select-none text-xs text-muted-foreground">{languageLabel}</span>
        <CopyButton getText={() => raw} copyLabel={t('codeBlock.copyCode')} copiedLabel={t('codeBlock.copied')} />
      </div>

      <SyntaxHighlighter
        language={language}
        style={syntaxTheme.style}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: 'var(--ui-code-font-size, 0.8125rem)',
          lineHeight: 1.6,
          padding: '0.5rem 1rem 1rem',
          overflowX: 'auto',
          // The container owns the background so the label row and code read as one panel.
          background: 'transparent',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'var(--ui-code-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
            background: 'transparent',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

const markdownComponents = {
  code: CodeBlock,
  // Workspace image paths are fetched through the authenticated files route;
  // a bare <img src> would resolve against the web origin and 404.
  img: MarkdownImage,
  // Fenced/indented code arrives as <pre><code>. Re-render the child CodeBlock
  // with `forceBlock` so it always gets the block treatment (react-markdown v9+
  // no longer passes an `inline` flag), and skip the outer <pre> so Tailwind
  // Typography doesn't wrap the highlighter in a second dark shell.
  pre: ({ children }: { children?: React.ReactNode }) => {
    const child = Array.isArray(children) ? children.find(React.isValidElement) : children;
    if (React.isValidElement(child) && child.type === CodeBlock) {
      return <CodeBlock {...(child.props as CodeBlockProps)} forceBlock />;
    }
    return <>{children}</>;
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-t border-border" />,
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-outside list-disc space-y-1 pl-5 marker:text-current last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-outside list-decimal space-y-1 pl-5 marker:text-current last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="[&>div:last-child]:mb-0 [&>div]:mb-1">{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <MarkdownTable scrollHint="">
      {children}
    </MarkdownTable>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="[&:last-child>td]:border-b-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
  ),
};

/**
 * Used by chat's MessageComponent, ToolErrorDisplay and MarkdownContent to
 * render model-authored markdown with this module's shared prose styling,
 * code highlighting and table rules.
 */
function MarkdownBodyRenderer({ children, breaks = false }: Omit<MarkdownProps, 'className'>) {
  const content = useMemo(
    // The LaTeX pass runs second because it reads the code spans the fence pass
    // normalizes, and must leave the LaTeX inside them literal.
    () => normalizeLatexDelimiters(normalizeInlineCodeFences(String(children ?? ''))),
    [children],
  );
  // Math support costs a remark tree pass plus a full KaTeX walk on every
  // render, and almost no assistant message contains math. Only wire the two
  // plugins up when the text has a delimiter they could act on.
  const hasMath = useMemo(() => MATH_DELIMITER.test(content), [content]);
  const remarkPlugins = useMemo(
    () => {
      // CommonMark's emphasis flanking rules assume space-separated words, so a
      // bold run that ends in punctuation and is followed by a CJK character
      // never closes: in `**…"**的` the closing `**` is preceded by punctuation
      // but followed by `的`, which is neither whitespace nor punctuation, so it
      // is not right-flanking and the asterisks render literally. Chinese text
      // hits this constantly because it puts punctuation inside the emphasis and
      // no space after it. remarkCjkFriendly relaxes the rule only where a CJK
      // character or CJK punctuation is adjacent, leaving other text untouched.
      const plugins: unknown[] = [remarkGfm, remarkCjkFriendly];
      if (hasMath) {
        plugins.push([remarkMath, { singleDollarTextMath: false }]);
      }
      if (breaks) {
        plugins.push(remarkBreaks);
      }
      return plugins as any;
    },
    [breaks, hasMath],
  );
  const rehypePlugins = useMemo(() => (hasMath ? [rehypeKatex] : EMPTY_PLUGINS), [hasMath]);
  const { openFileInEditor, openDirectory } = usePaletteOps();
  const { t } = useTranslation('chat');

  const components = useMemo(
    () => ({
      ...markdownComponents,
      table: ({ children }: { children?: React.ReactNode }) => (
        <MarkdownTable scrollHint={t('table.scrollHint', { defaultValue: '左右滑动查看完整表格' })}>
          {children}
        </MarkdownTable>
      ),
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        // Prefer the href when it is a real path; otherwise fall back to the
        // link text, since models often emit `[src/foo.ts]()` with an empty href.
        const linkText = childrenToText(linkChildren);
        const fileRef = looksLikeFilePath(href) ? href : looksLikeFilePath(linkText) ? linkText : undefined;

        if (fileRef && !isExternalHref(href)) {
          return (
            <a
              href={href || fileRef}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              onClick={(event) => {
                event.preventDefault();
                // Normalized once for every branch below: the href arrives
                // trimmed from the parser, but the link-text fallback keeps a
                // trailing space (``[`src/foo.ts:12` ]()``), and that space
                // defeats the `$`-anchored suffix strip.
                const reference = fileRef.trim();
                if (reference.endsWith('/')) {
                  openDirectory(reference);
                  return;
                }
                openFileInEditor(stripLineSuffix(reference), lineFromRef(reference));
              }}
            >
              {linkChildren}
            </a>
          );
        }

        return (
          <a
            href={href}
            className="text-blue-600 hover:underline dark:text-blue-400"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkChildren}
          </a>
        );
      },
    }),
    [openFileInEditor, openDirectory, t],
  );

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
      {content}
    </ReactMarkdown>
  );
}

/**
 * Markdown blocks without the prose wrapper. Used by StreamingMarkdown so a
 * streamed reply's settled and pending halves render as siblings inside ONE
 * prose container — Tailwind Typography's `> :first-child`/`> :last-child`
 * margin rules are per-container, so two containers would zero the gap at the
 * seam and make it pop back when the boundary moves.
 *
 * Memoized so a re-render does not re-run remark, rehype, KaTeX and Prism over
 * text that has not changed.
 */
export const MarkdownBody = memo(MarkdownBodyRenderer);

/** Markdown in its own prose container. The form every non-streaming caller uses. */
export const Markdown = memo(function Markdown({ children, className, breaks }: MarkdownProps) {
  return (
    <div className={className}>
      <MarkdownBody breaks={breaks}>{children}</MarkdownBody>
    </div>
  );
});
