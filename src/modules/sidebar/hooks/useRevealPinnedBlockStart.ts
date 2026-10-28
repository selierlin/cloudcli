import { useEffect } from 'react';
import type { RefObject } from 'react';

/** The sidebar's scroll container is ScrollArea's inner `overflow-auto` div. */
const SCROLLER_SELECTOR = '.overflow-auto, .overflow-y-auto, [data-scroll-container]';

/** A pinned header sits within a pixel of the container's top edge. */
const PIN_TOLERANCE_PX = 1;

/**
 * How long after mount the correction may still fire.
 *
 * A single frame after mount is not enough. The offset being corrected does not
 * exist at first paint: the browser's own scroll restore, the saved-expansion
 * effect and the first page of sessions all land later, and a block that grows
 * after mount moves the pinned header into place only then. Correcting once, in
 * the frame right after mount, read a container that had not been scrolled yet
 * and then never looked again — which is how a reload could still land inside a
 * block, showing its last few sessions with the actions row hidden above.
 *
 * Any input from the user ends the window: from that moment the offset is
 * theirs, not the restore's.
 */
const SETTLE_WINDOW_MS = 2000;

/**
 * Moments inside the window at which to re-check. The scroll listener catches
 * offsets that arrive as a scroll (the browser restore, a sibling collapse); the
 * timers catch the ones that arrive as a layout change, which fires no scroll.
 */
const CHECK_DELAYS_MS = [0, 60, 160, 320, 700, 1200, 1800];

/** Input that hands the scroll offset over to the user. */
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * Puts an expanded project block back at the top of the sidebar when a page
 * load lands inside it.
 *
 * The block's header is sticky, so a load that restores an offset below the
 * block's own top makes the block *look* like it starts at whichever session
 * happens to be under the header: the "New session" row and the project row are
 * hidden above the container's top edge, with no cue that anything is missing.
 *
 * Only the block whose header is pinned at the container's top is corrected — a
 * block further up has its header stuck above the viewport and is left alone.
 * Click-initiated expands keep their offset (useExpandScrollAnchor owns that
 * case) because a click fires `pointerdown` first, which closes the window.
 *
 * Mounted once per project list; the blocks are read from the DOM, so this
 * costs one listener instead of one effect per row.
 */
export function useRevealPinnedBlockStart<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
): void {
  useEffect(() => {
    const container = containerRef.current;
    const scroller = container?.closest<HTMLElement>(SCROLLER_SELECTOR) ?? null;
    if (!container || !scroller) {
      return;
    }

    let frame = 0;
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let windowTimer: ReturnType<typeof setTimeout> | undefined;

    const reveal = () => {
      frame = 0;
      if (stopped) {
        return;
      }
      const scrollerTop = scroller.getBoundingClientRect().top;
      for (const block of container.querySelectorAll<HTMLElement>('[data-sidebar-project-block]')) {
        const blockTop = block.getBoundingClientRect().top;
        // Blocks are in document order, so the first one that is not already
        // above the edge ends the search.
        if (blockTop >= scrollerTop - PIN_TOLERANCE_PX) {
          break;
        }
        const header = block.firstElementChild;
        if (!header) {
          continue;
        }
        if (Math.abs(header.getBoundingClientRect().top - scrollerTop) <= PIN_TOLERANCE_PX) {
          scroller.scrollTop += blockTop - scrollerTop;
          break;
        }
      }
    };

    const scheduleReveal = () => {
      if (stopped || frame) {
        return;
      }
      frame = requestAnimationFrame(reveal);
    };

    const stop = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      timers.forEach((timer) => clearTimeout(timer));
      clearTimeout(windowTimer);
      scroller.removeEventListener('scroll', scheduleReveal);
      USER_INPUT_EVENTS.forEach((type) => scroller.removeEventListener(type, stop));
    };

    CHECK_DELAYS_MS.forEach((delay) => timers.push(setTimeout(scheduleReveal, delay)));
    windowTimer = setTimeout(stop, SETTLE_WINDOW_MS);

    scroller.addEventListener('scroll', scheduleReveal, { passive: true });
    USER_INPUT_EVENTS.forEach((type) => scroller.addEventListener(type, stop, { passive: true }));

    return stop;
  }, [containerRef]);
}
