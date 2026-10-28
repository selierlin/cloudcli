import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** How long the bar stays painted after the last scroll before it rests again, in ms. */
const SCROLLBAR_IDLE_DELAY_MS = 700;

/** Width of the strip along the container's right edge that counts as reaching for the bar, in px. */
const SCROLLBAR_REACH_PX = 12;

/**
 * Used by the sidebar's project list and the chat transcript to keep their
 * scroll containers quiet: the bar is painted only while the user scrolls or
 * reaches for it, and disappears once the container has been at rest for
 * `SCROLLBAR_IDLE_DELAY_MS`.
 *
 * The container keeps the bar's width the whole time — only the paint is
 * switched — so nothing reflows when the bar comes and goes. The stylesheet
 * reads the `data-scrollbar-idle` attribute this hook toggles; while it is
 * absent the theme's own thumb and track rules paint untouched, which is what
 * keeps the 25 bundled and user themes looking the way they already do.
 *
 * Programmatic scrolling (the transcript following a streaming reply) also
 * fires `scroll`, so the bar stays awake for as long as the content moves.
 */
export function useAutoHideScrollbar(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    let idle = false;
    let reachingForBar = false;
    let idleTimer: number | undefined;

    const paint = (nextIdle: boolean) => {
      if (nextIdle === idle) {
        return;
      }
      idle = nextIdle;
      if (nextIdle) {
        element.setAttribute('data-scrollbar-idle', '');
      } else {
        element.removeAttribute('data-scrollbar-idle');
      }
    };

    const restAfterDelay = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (!reachingForBar) {
          paint(true);
        }
      }, SCROLLBAR_IDLE_DELAY_MS);
    };

    const handleScroll = () => {
      paint(false);
      restAfterDelay();
    };

    // "Reaching for the bar" is a pointer within a few pixels of the right
    // edge — hovering the transcript itself must not keep the bar awake, or
    // the chat pane would show it permanently.
    const handlePointerMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      reachingForBar = event.clientX >= rect.right - SCROLLBAR_REACH_PX
        && event.clientX <= rect.right + 1;
      if (reachingForBar) {
        window.clearTimeout(idleTimer);
        paint(false);
      } else if (!idle) {
        restAfterDelay();
      }
    };

    const handlePointerLeave = () => {
      reachingForBar = false;
      restAfterDelay();
    };

    // Set before the first paint, so the bar never flashes on load.
    idle = true;
    element.setAttribute('data-scrollbar-idle', '');

    element.addEventListener('scroll', handleScroll, { passive: true });
    element.addEventListener('pointermove', handlePointerMove, { passive: true });
    element.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      window.clearTimeout(idleTimer);
      element.removeEventListener('scroll', handleScroll);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [ref]);
}
