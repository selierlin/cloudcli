import { useEffect } from 'react';
import type { MutableRefObject, RefObject } from 'react';

import { noteScrollWrite } from '@/shared/debug/scrollDiagnostics';

/**
 * Used by the chat transcript pane to keep the transcript glued to the scroll
 * container's bottom edge when that edge moves. The virtual keyboard raising
 * the fixed workspace shell, the composer growing as its draft wraps, and a
 * window resize all shrink or grow the pane; without compensation the browser
 * keeps scrollTop, so the rows that sat against the bottom edge (the input's
 * neighbours) are clipped by a rising edge or drift up on a falling one.
 *
 * Every height change is compensated onto scrollTop inside the pre-paint
 * ResizeObserver callback, in both directions and at any scroll position:
 * the content the reader sees next to the input stays next to the input.
 *
 * Growing the pane moves `scrollTop` *up*, which is the direction the
 * transcript reads as the reader pulling away from the tail. The hook therefore
 * records each write in `programmaticScrollTopRef`, so `handleScroll` can tell
 * this compensation apart from a real pull instead of latching the follow off
 * for the rest of a streaming answer.
 */
export function useBottomEdgeResizeCompensation(
  scrollContainerRef: RefObject<HTMLDivElement>,
  programmaticScrollTopRef: MutableRefObject<number | null>,
) {
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;

    let previousHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = container.clientHeight;
      const delta = height - previousHeight;
      // A pane that grew while already pinned to the tail owes nothing: the
      // browser clamps `scrollTop` to the new maximum itself, and that clamp is
      // the same correction written by hand below. Paying for it twice drags
      // the transcript down by the delta and leaves it there — measured 34 px
      // every time the keyboard rose, because the composer's safe-area padding
      // collapses (the pane grows 34) a frame before the keyboard takes the
      // rest. A shrink never clamps, so it is always paid in full.
      const maxScrollTop = container.scrollHeight - height;
      const clampedToTail = delta > 0 && container.scrollTop >= maxScrollTop - 1;
      if (delta !== 0 && previousHeight > 0 && height > 0 && !clampedToTail) {
        // A shrink (negative delta) scrolls down by the same amount the bottom
        // edge rose, keeping the former bottom rows above it; a grow scrolls
        // back up symmetrically. The browser clamps the write to the
        // scrollable range, which is exact except at scrollTop 0 (short
        // transcripts cannot scroll at all).
        container.scrollTop -= delta;
        noteScrollWrite('bottomEdge', container);
        programmaticScrollTopRef.current = container.scrollTop;
      }
      previousHeight = height;
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [programmaticScrollTopRef, scrollContainerRef]);
}
