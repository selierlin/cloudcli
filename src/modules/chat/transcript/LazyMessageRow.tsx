import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage } from '@/shared/types';
import type { LazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';

/**
 * Mounts a transcript row's real content only while the row is near the
 * viewport, and swaps it for a fixed-height placeholder otherwise.
 *
 * The transcript renders every loaded message into the DOM, so "Load all" on a
 * long session used to commit tens of thousands of markdown/tool subtrees at
 * once — a gigabyte-scale tab. The wrapper element here always stays in the
 * DOM (carrying the row's `data-message-timestamp`, so search jumps and scroll
 * anchors keep working against unmounted rows), while the expensive subtree
 * exists only inside a band around the viewport.
 *
 * The placeholder reuses the row's last measured height, so scrolling back
 * through previously seen content changes no scroll geometry at all; rows
 * never yet measured use an estimate and rely on browser scroll anchoring
 * while they settle.
 */

/** Placeholder height for rows that have never been measured. */
const ESTIMATED_ROW_HEIGHT_PX = 100;

type LazyMessageRowProps = {
  lazyRows: LazyRowObserver | null;
  /** Stable within one session, so measured geometry survives row remounts and prepends. */
  rowKey: string;
  /** Mirrors the row's own `data-message-timestamp`, present even while unmounted. */
  timestamp: ChatMessage['timestamp'] | undefined;
  /**
   * Rows near the tail render their content on first commit so the initial
   * scroll-to-bottom measures real heights; everything older starts as a
   * placeholder and mounts when scrolled toward.
   */
  initiallyNearViewport: boolean;
  /** Content-aware placeholder height used until this row has rendered once. */
  estimatedHeight?: number;
  /** Hides and unmounts a folded process member while retaining its timestamp anchor. */
  isProcessCollapsed?: boolean;
  /** Optional section-anchor marker for the user message that started a turn. */
  dataAnchor?: string;
  children: ReactNode;
};

export default function LazyMessageRow({
  lazyRows,
  rowKey,
  timestamp,
  initiallyNearViewport,
  estimatedHeight = ESTIMATED_ROW_HEIGHT_PX,
  isProcessCollapsed = false,
  dataAnchor,
  children,
}: LazyMessageRowProps) {
  const [isNearViewport, setIsNearViewport] = useState(initiallyNearViewport);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(
    () => lazyRows?.readHeight(rowKey) ?? null,
  );
  const elementRef = useRef<HTMLDivElement | null>(null);

  const handleNearViewportChange = useCallback((nextIsNearViewport: boolean) => {
    if (!nextIsNearViewport) {
      // Measured now, while the content is still in the DOM, so the
      // placeholder that replaces it occupies exactly the same space.
      const height = elementRef.current?.offsetHeight ?? 0;
      if (height > 0) {
        lazyRows?.writeHeight(rowKey, height);
        setMeasuredHeight(height);
      }
    }
    setIsNearViewport(nextIsNearViewport);
  }, [lazyRows, rowKey]);

  useEffect(() => {
    const element = elementRef.current;
    if (!lazyRows || !element) return undefined;
    return lazyRows.observe(element, handleNearViewportChange);
  }, [lazyRows, handleNearViewportChange]);

  const isMounted = lazyRows === null || isNearViewport;

  return (
    <div
      ref={elementRef}
      data-message-timestamp={timestamp || undefined}
      data-user-anchor={dataAnchor || undefined}
      aria-hidden={isProcessCollapsed || undefined}
      // `hidden` removes the parent's `space-y` gap. Folded process content is
      // deliberately unmounted so a long run does not retain hundreds of
      // markdown and tool-detail subtrees behind its one-line summary.
      className={isProcessCollapsed ? 'hidden' : undefined}
      style={isMounted ? undefined : { height: measuredHeight ?? estimatedHeight }}
    >
      {isMounted && !isProcessCollapsed ? children : null}
    </div>
  );
}
