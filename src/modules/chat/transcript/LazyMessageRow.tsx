import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';

import type { ChatMessage } from '@/shared/types';
import type { LazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import { noteScrollWrite } from '@/shared/debug/scrollDiagnostics';

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

/** Screen drift below this is measurement noise, not a moved anchor. */
const ANCHOR_HOLD_EPSILON_PX = 1;

/**
 * Layout travel below this is left alone. Writing `scrollTop` while the pane is
 * moving is not free — on iOS it ends the deceleration — so the correction is
 * reserved for the shifts a reader would notice, which is exactly the case it
 * exists for: a row that mounts at the 100px estimate and turns out to be a
 * thousand pixels of thinking content.
 */
const LAYOUT_SHIFT_MIN_PX = 24;

/**
 * The row the correction measures from: the first one whose bottom is inside
 * the pane. Measuring the row being mounted is not enough — a row that mounts
 * *above* the viewport grows downward without moving its own top, so its own
 * displacement reads zero while everything the reader can see moves down by the
 * row's whole height. That was the 128px jump the phone still reported after
 * the scroll-while-mounting case was fixed.
 */
function firstVisibleRow(container: HTMLElement): { element: HTMLElement; top: number } | null {
  const paneTop = container.getBoundingClientRect().top;
  for (const candidate of container.querySelectorAll<HTMLElement>('[data-message-timestamp]')) {
    const rect = candidate.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom >= paneTop) return { element: candidate, top: rect.top };
  }
  return null;
}

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
  /**
   * The chat-owned record of the last `scrollTop` our own writers left behind.
   * The anchor correction below moves the viewport upward, which is the
   * direction `handleScroll` reads as the reader pulling away, so the write has
   * to be registered there or a mid-transcript correction would latch the
   * follow off for the rest of the answer.
   */
  programmaticScrollTopRef: MutableRefObject<number | null>;
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
  programmaticScrollTopRef,
  children,
}: LazyMessageRowProps) {
  const [isNearViewport, setIsNearViewport] = useState(initiallyNearViewport);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(
    () => lazyRows?.readHeight(rowKey) ?? null,
  );
  const elementRef = useRef<HTMLDivElement | null>(null);
  const isNearViewportRef = useRef(isNearViewport);
  /// The row the commit will be measured against — the first one the reader can
  /// see, which may be a different row than this one — plus where it sat and the
  /// pane's offset at that same instant.
  const pendingAnchorRef = useRef<{
    element: HTMLElement;
    top: number;
    scrollTop: number;
  } | null>(null);

  const handleNearViewportChange = useCallback((nextIsNearViewport: boolean) => {
    // IntersectionObserver repeats the current state freely; only a real
    // transition is worth anchoring around.
    if (nextIsNearViewport === isNearViewportRef.current) return;
    isNearViewportRef.current = nextIsNearViewport;

    const element = elementRef.current;
    const container = element?.closest<HTMLElement>('.chat-messages-pane') ?? null;
    // WebKit resolves its scroll anchor to a node *inside* the content this row
    // is about to drop (or has just grown). When that node disappears the
    // anchor re-resolves somewhere else and the offset moves by hundreds of
    // pixels even though the layout is byte-for-byte identical — and that jump
    // pushes the row back across the band edge, so it mounts again, which
    // moves the offset back, forever. Record the visible row's screen position
    // here so the commit can be undone before it is ever painted.
    let anchor: { element: HTMLElement; top: number } | null = null;
    if (container) {
      anchor = firstVisibleRow(container)
        ?? (element ? { element, top: element.getBoundingClientRect().top } : null);
    }
    pendingAnchorRef.current = anchor && container
      ? {
          element: anchor.element,
          top: anchor.top,
          scrollTop: container.scrollTop,
        }
      : null;

    if (!nextIsNearViewport) {
      // Measured now, while the content is still in the DOM, so the
      // placeholder that replaces it occupies exactly the same space. That
      // includes 0px (a hidden thinking row renders nothing) and fractions of
      // a pixel, which offsetHeight would round: a placeholder taller than the
      // content, on a row just past the band's top edge, reaches back into the
      // band and drops out again on every frame.
      const rect = elementRef.current?.getBoundingClientRect();
      // A 0x0 box means the row is not rendered at all (hidden tab), which
      // says nothing about its height, so the last measurement is kept.
      if (rect && (rect.width > 0 || rect.height > 0)) {
        lazyRows?.writeHeight(rowKey, rect.height);
        setMeasuredHeight(rect.height);
      }
    }
    setIsNearViewport(nextIsNearViewport);
  }, [lazyRows, rowKey]);

  useEffect(() => {
    const element = elementRef.current;
    if (!lazyRows || !element) return undefined;
    return lazyRows.observe(element, handleNearViewportChange);
  }, [lazyRows, handleNearViewportChange]);

  // Runs before paint, so a jump never reaches the screen. The correction is
  // the visible row's screen displacement, which leaves deliberate shifts (a
  // real height change the browser already compensated) untouched at zero drift.
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!pending || !pending.element.isConnected) return;

    const container = pending.element.closest<HTMLElement>('.chat-messages-pane');
    if (!container) return;
    // The browser owns the offset while the pane is out of range. A drag past
    // either end leaves `scrollTop` beyond the clamp and the platform is already
    // springing the content back, so the drift measured here is that animation
    // moving the row on screen — not a layout change. Writing it, even by a
    // pixel, is a `scrollTop` write the browser clamps to the edge (or discards),
    // which ends the spring: the pane lands in one frame instead of animating.
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (container.scrollTop < 0 || container.scrollTop > maxScrollTop + ANCHOR_HOLD_EPSILON_PX) {
      return;
    }
    // The offset moved between the measurement and this commit, so part of the
    // row's displacement is the pane scrolling, not the layout changing.
    // Scrolling moves the row by the negative of its own travel, so adding the
    // travel back isolates the piece the layout produced. Only that piece is
    // ours to pay back: the reader's own movement must be left where they put
    // it, and standing down on any scroll at all — the previous rule — let a
    // 1290px row mount while the pane coasted 12px, which the reader saw as the
    // transcript jumping 610px down.
    const scrollDelta = container.scrollTop - pending.scrollTop;
    const drift = pending.element.getBoundingClientRect().top - pending.top;
    const layoutShift = drift + scrollDelta;
    if (Math.abs(layoutShift) <= LAYOUT_SHIFT_MIN_PX) return;
    container.scrollTop += layoutShift;
    programmaticScrollTopRef.current = container.scrollTop;
    noteScrollWrite('lazyRowAnchor', container);
  }, [isNearViewport, programmaticScrollTopRef]);

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
