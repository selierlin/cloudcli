import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type ExportDisclosureProps = {
  className?: string;
  /** Styles the clickable header; the chevron inside should carry `chat-export-details-chevron`. */
  summaryClassName?: string;
  bodyClassName?: string;
  summary: ReactNode;
  children: ReactNode;
};

/**
 * A native disclosure that keeps working in an exported document.
 *
 * The chat's tool surfaces toggle React state: `BashCommandDisplay` flips an
 * `open` flag, `CollapsibleSection` drives a Radix `Collapsible`. A static
 * render has no event loop, so those components force their bodies open in an
 * export (`isExporting`), which keeps collapsed content reachable but leaves
 * the row permanently expanded — clicking it does nothing. This renders
 * `<details>` instead: the same header markup as the summary, no script, and
 * a body that opens and closes on click.
 *
 * Used by chat's BashCommandDisplay, CollapsibleSection, ToolErrorDisplay and
 * ToolGroupContainer while they render a transcript export.
 */
export function ExportDisclosure({
  className,
  summaryClassName,
  bodyClassName,
  summary,
  children,
}: ExportDisclosureProps) {
  return (
    <details className={cn('chat-export-details', className)}>
      <summary className={cn('chat-export-details-summary', summaryClassName)}>
        {summary}
      </summary>
      <div className={cn('chat-export-details-body', bodyClassName)}>
        {children}
      </div>
    </details>
  );
}
