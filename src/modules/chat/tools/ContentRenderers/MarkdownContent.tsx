import React from 'react';

import { Markdown } from '@/modules/chat/transcript/Markdown';

type MarkdownContentProps = {
  content: string;
  /**
   * Render single newlines as hard line breaks. Tool bodies written by a model
   * (plan text, agent prompts and results) use single newlines as line
   * separators, so they need this; markdown's default would join them into one
   * paragraph. Left off by default so the intent is explicit at each call site.
   */
  breaks?: boolean;
  className?: string;
};

/**
 * Renders markdown content with proper styling
 * Used by: exit_plan_mode, long text results, etc.
 *
 * Rendered by chat's ToolRenderer and PlanDisplay as the markdown body of a
 * tool result.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  breaks = false,
  className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'
}) => {
  return (
    <Markdown className={className} breaks={breaks}>
      {content}
    </Markdown>
  );
};
