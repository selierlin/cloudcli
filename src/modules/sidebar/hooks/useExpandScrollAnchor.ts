import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * How long to keep compensating after an expand, in milliseconds.
 * SidebarProjectSessions animates grid-template-rows over 200ms; the margin
 * covers the closing frame so the last sliver of movement is not left behind.
 */
const ANCHOR_FOLLOW_MS = 260;

/**
 * Sub-pixel drift below this is ignored. `scrollTop` is rounded to device
 * pixels by the engine, so chasing a fraction of a pixel would make the loop
 * oscillate forever instead of converging.
 */
const MIN_DRIFT_PX = 0.5;

/** The sidebar's scroll container is ScrollArea's inner `overflow-auto` div. */
const SCROLLER_SELECTOR = '.overflow-auto, .overflow-y-auto, [data-scroll-container]';

/**
 * Keeps the row that just expanded at the viewport offset it had when clicked,
 * while the accordion in useSidebarController collapses the previously
 * expanded project (200ms grid-template-rows transition below it).
 *
 * A collapsed project removes height above the clicked row, so the browser's
 * own scrollTop would leave the row shifted out of view. Native scroll
 * anchoring cannot fix this cross-platform: `overflow-anchor` only reached
 * iOS WebKit in Safari 27, so the CSS property is a no-op on mobile.
 *
 * Used by SidebarProjectItem: call the returned `beginAnchor()` in the click
 * path that is about to expand the row, then the layout effect triggered by
 * `isExpanded` becoming true follows the transition.
 */
export function useExpandScrollAnchor<T extends HTMLElement>(
  isExpanded: boolean,
  anchorRef: RefObject<T | null>,
): () => void {
  // Viewport offset of the row captured at click time. `null` means the expand
  // was not initiated by this row (e.g. the auto-expand effect in
  // useSidebarController), so the layout effect falls back to the live offset.
  const pendingOffsetRef = useRef<number | null>(null);

  const measureOffset = useCallback(
    (element: HTMLElement, scroller: HTMLElement) =>
      element.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    [],
  );

  const beginAnchor = useCallback(() => {
    const element = anchorRef.current;
    const scroller = element?.closest<HTMLElement>(SCROLLER_SELECTOR) ?? null;
    pendingOffsetRef.current = element && scroller ? measureOffset(element, scroller) : null;
  }, [anchorRef, measureOffset]);

  useLayoutEffect(() => {
    if (!isExpanded) {
      pendingOffsetRef.current = null;
      return;
    }

    const element = anchorRef.current;
    const scroller = element?.closest<HTMLElement>(SCROLLER_SELECTOR) ?? null;
    if (!element || !scroller) {
      return;
    }

    // Click-initiated expands use the offset caught before the click; an
    // externally initiated one falls back to the live offset, which is still
    // the pre-transition position because layout effects run before paint.
    const target = pendingOffsetRef.current ?? measureOffset(element, scroller);
    pendingOffsetRef.current = null;

    let frame = 0;
    const deadline = performance.now() + ANCHOR_FOLLOW_MS;

    const stop = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const follow = () => {
      const drift = measureOffset(element, scroller) - target;
      if (Math.abs(drift) >= MIN_DRIFT_PX) {
        scroller.scrollTop += drift;
      }
      frame = performance.now() < deadline ? requestAnimationFrame(follow) : 0;
    };

    frame = requestAnimationFrame(follow);

    // Hand control back the moment the user scrolls themselves, so the loop
    // never fights a wheel, touch or keyboard scroll.
    scroller.addEventListener('wheel', stop, { passive: true });
    scroller.addEventListener('touchstart', stop, { passive: true });
    scroller.addEventListener('keydown', stop);

    return () => {
      stop();
      scroller.removeEventListener('wheel', stop);
      scroller.removeEventListener('touchstart', stop);
      scroller.removeEventListener('keydown', stop);
    };
  }, [anchorRef, isExpanded, measureOffset]);

  return beginAnchor;
}
