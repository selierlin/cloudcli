import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/**
 * Frames a mount's anchor correction may wait for the document height to stop
 * moving. The band around the viewport mounts as one flush, so the first frames
 * after it are the ones where estimated heights are replaced; a transcript that
 * is still growing on every frame has no stable height to pay against.
 */
const ANCHOR_SETTLE_RETRY_FRAMES = 8;

/** Screen drift below this is measurement noise, not a moved anchor. */
const ANCHOR_HOLD_EPSILON_PX = 1;

/**
 * Net `scrollTop` travel this file has written to each pane. Rows that mount in
 * the same flush all captured the same pinned row before the commit, so each
 * would size its correction from the whole displacement: the first pays it and
 * every later one pays it again, pushing the content the other way. A row
 * subtracts what has been written since its own capture to see only what is
 * still owed.
 */
const writtenTravelByPane = new WeakMap<HTMLElement, number>();

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
  /** Extra classes on the row's own box, which is what the list spaces. */
  className?: string;
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
  className,
  children,
}: LazyMessageRowProps) {
  const [isNearViewport, setIsNearViewport] = useState(initiallyNearViewport);
  // True only while the observer has this row mounted ahead of the reader to take
  // its first height measurement (see `useLazyRowObserver`); the row is
  // otherwise mounted purely by `isNearViewport`.
  const [isWarm, setIsWarm] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(
    () => lazyRows?.readHeight(rowKey) ?? null,
  );
  const elementRef = useRef<HTMLDivElement | null>(null);
  const isNearViewportRef = useRef(isNearViewport);
  // Mirrors the committed mounted state for the observer, which asks from outside React.
  const isMountedRef = useRef(false);
  /// The row the commit will be measured against — the first one the reader can
  /// see, which may be a different row than this one — plus where it sat and the
  /// pane's offset at that same instant.
  const pendingAnchorRef = useRef<{
    element: HTMLElement;
    top: number;
    scrollTop: number;
    /** Net travel written to the pane when this was captured; see `writtenTravelByPane`. */
    writtenTravel: number;
  } | null>(null);
  /** Document height the last correction attempt saw, for the settle retry. */
  const settledGeometryRef = useRef<string | null>(null);
  /** The retry frame, or null. */
  const measureFrameRef = useRef<number | null>(null);

  /**
   * Records which row the reader is looking at and where it sits, so the commit
   * that follows can pay back whatever it displaces before anything paints.
   */
  const captureAnchor = useCallback(() => {
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
          writtenTravel: writtenTravelByPane.get(container) ?? 0,
        }
      : null;
  }, []);

  /** Writes the row's exact rendered height down, so its placeholder takes the same space. */
  const recordMeasuredHeight = useCallback(() => {
    // Measured while the content is still in the DOM. That includes 0px (a hidden
    // thinking row renders nothing) and fractions of a pixel, which offsetHeight
    // would round: a placeholder taller than the content, on a row just past the
    // band's top edge, reaches back into the band and drops out again on every
    // frame.
    const rect = elementRef.current?.getBoundingClientRect();
    // A 0x0 box means the row is not rendered at all (hidden tab), which
    // says nothing about its height, so the last measurement is kept.
    if (rect && (rect.width > 0 || rect.height > 0)) {
      lazyRows?.writeHeight(rowKey, rect.height);
      setMeasuredHeight(rect.height);
    }
  }, [lazyRows, rowKey]);

  const handleNearViewportChange = useCallback((nextIsNearViewport: boolean) => {
    // IntersectionObserver repeats the current state freely; only a real
    // transition is worth anchoring around.
    if (nextIsNearViewport === isNearViewportRef.current) return;
    isNearViewportRef.current = nextIsNearViewport;

    captureAnchor();
    if (!nextIsNearViewport) recordMeasuredHeight();
    setIsNearViewport(nextIsNearViewport);
  }, [captureAnchor, recordMeasuredHeight]);

  /**
   * Mounts the row's content so the observer can read its real height while the
   * reader is still, or sends it back. Mounting replaces an estimate with the
   * real height above the reader; the same anchor correction every mount uses
   * pays that back, and it lands while nothing is coasting, which is the only
   * time the platform keeps such a write.
   */
  const setWarm = useCallback((warm: boolean) => {
    // The band already holds this row mounted: nothing flips, so there is no
    // displacement to anchor and no height that is not about to be recorded anyway.
    if (isNearViewportRef.current) {
      setIsWarm(warm);
      return;
    }
    captureAnchor();
    // Leaving: the content is still mounted at this point, so this is the moment
    // its true height can be read.
    if (!warm) recordMeasuredHeight();
    setIsWarm(warm);
  }, [captureAnchor, recordMeasuredHeight]);

  const warmHandle = useMemo(() => ({
    rowKey,
    isMounted: () => isMountedRef.current,
    setWarm,
  }), [rowKey, setWarm]);

  useEffect(() => {
    const element = elementRef.current;
    if (!lazyRows || !element) return undefined;
    return lazyRows.observe(element, handleNearViewportChange, warmHandle);
  }, [lazyRows, handleNearViewportChange, warmHandle]);

  /**
   * Pays back the screen displacement a commit put on the pinned row, or says
   * that the commit is not payable yet. Mounting is the case that answers no:
   * the placeholder band mounts several rows in one flush and every one of them
   * still reports its *estimated* height, so a correction paid from that frame
   * is measured against geometry the next frame replaces and the platform undoes
   * the whole write — a phone recording shows a 2781 px correction reverted 7 ms
   * later, one frame after the row above grew from its 100 px estimate to 3461.
   *
   * `requireSettledGeometry` is the frame-driven pass above. The commit-time
   * pass turns it off: it runs before any frame can paint, pays what the commit
   * itself changed, and leaves whatever grows afterwards to the frame-driven one.
   */
  const payAnchorCorrection = useCallback((
    pending: NonNullable<typeof pendingAnchorRef.current>,
    requireSettledGeometry = true,
  ): boolean => {
    if (!pending.element.isConnected) return true;

    const container = pending.element.closest<HTMLElement>('.chat-messages-pane');
    if (!container) return true;
    // The browser owns the offset while the pane is out of range. A drag past
    // either end leaves `scrollTop` beyond the clamp and the platform is already
    // springing the content back, so the drift measured here is that animation
    // moving the row on screen — not a layout change. Writing it, even by a
    // pixel, is a `scrollTop` write the browser clamps to the edge (or discards),
    // which ends the spring: the pane lands in one frame instead of animating.
    const maxScrollTop = container.scrollHeight - container.clientHeight;
    if (container.scrollTop < 0 || container.scrollTop > maxScrollTop + ANCHOR_HOLD_EPSILON_PX) {
      return true;
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
    // Our own writes cancel out of that sum (they move the row and the offset by
    // the same amount), so it keeps reporting the full displacement after it has
    // been paid. Rows that mounted in the same flush captured the same pinned
    // row, and without this subtraction each of them paid the whole thing again.
    const alreadyPaid = (writtenTravelByPane.get(container) ?? 0) - pending.writtenTravel;
    const layoutShift = drift + scrollDelta - alreadyPaid;
    if (Math.abs(layoutShift) <= LAYOUT_SHIFT_MIN_PX) return true;
    // The document only has to have stopped moving for this to be a
    // measurement. While the estimated heights are still being replaced the
    // number above is a guess about a guess, and retrying costs one more frame.
    if (requireSettledGeometry) {
      const geometry = `${container.scrollHeight}`;
      if (geometry !== settledGeometryRef.current) {
        settledGeometryRef.current = geometry;
        return false;
      }
    }
    const before = container.scrollTop;
    container.scrollTop += layoutShift;
    writtenTravelByPane.set(
      container,
      (writtenTravelByPane.get(container) ?? 0) + (container.scrollTop - before),
    );
    programmaticScrollTopRef.current = container.scrollTop;
    noteScrollWrite(requireSettledGeometry ? 'lazyRowAnchor' : 'lazyRowCommit', container);
    return true;
  }, [programmaticScrollTopRef]);

  /**
   * Runs the correction for a commit, and keeps running it while the document
   * is still settling. The retry is bounded because a transcript that never
   * stops growing has no stable height to pay against.
   */
  const settleAnchorCorrection = useCallback((
    pending: NonNullable<typeof pendingAnchorRef.current>,
    deferFirstFrame: boolean,
  ) => {
    settledGeometryRef.current = null;
    let frame = 0;
    const run = () => {
      measureFrameRef.current = null;
      if (payAnchorCorrection(pending)) return;
      frame += 1;
      if (frame >= ANCHOR_SETTLE_RETRY_FRAMES) return;
      measureFrameRef.current = window.requestAnimationFrame(run);
    };
    // A row that just mounted pays nothing from its own commit: that frame's
    // height is still the placeholder's estimate.
    if (deferFirstFrame) {
      measureFrameRef.current = window.requestAnimationFrame(run);
      return;
    }
    run();
  }, [payAnchorCorrection]);

  // The same correction serves a mount from the viewport band and one from the
  // observer's measuring pass: both are a flip of `isMounted`.
  const isMounted = lazyRows === null || isNearViewport || isWarm;

  useLayoutEffect(() => {
    isMountedRef.current = isMounted;
  }, [isMounted]);

  // Captured before paint, so the correction is in hand before the browser can
  // move anything. A row that just mounted pays in a microtask: it runs after the
  // commit and its synchronous re-renders but before any frame, so the displaced
  // content is never painted. The frame-driven pass behind it only has to catch
  // what keeps growing afterwards. The correction is the visible row's screen
  // displacement, which leaves deliberate shifts (a real height change the
  // browser already compensated) untouched at zero drift.
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!pending) return;
    if (isMounted) {
      queueMicrotask(() => {
        if (elementRef.current?.isConnected) payAnchorCorrection(pending, false);
      });
    }
    settleAnchorCorrection(pending, isMounted);
    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = null;
      }
    };
  }, [isMounted, payAnchorCorrection, settleAnchorCorrection]);
  return (
    <div
      ref={elementRef}
      data-message-timestamp={timestamp || undefined}
      data-user-anchor={dataAnchor || undefined}
      aria-hidden={isProcessCollapsed || undefined}
      // `hidden` removes the parent's `space-y` gap. Folded process content is
      // deliberately unmounted so a long run does not retain hundreds of
      // markdown and tool-detail subtrees behind its one-line summary.
      className={[isProcessCollapsed ? 'hidden' : '', className].filter(Boolean).join(' ') || undefined}
      style={isMounted ? undefined : { height: measuredHeight ?? estimatedHeight }}
    >
      {isMounted && !isProcessCollapsed ? children : null}
    </div>
  );
}
