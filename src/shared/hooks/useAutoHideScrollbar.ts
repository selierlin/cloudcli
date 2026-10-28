import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';

/** How long the bar stays painted after the last scroll before it rests again, in ms. */
const SCROLLBAR_IDLE_DELAY_MS = 700;

/** Width of the strip along the container's right edge that counts as reaching for the bar, in px. */
const SCROLLBAR_REACH_PX = 12;

type ScrollbarAttachment = (node: HTMLElement | null) => void;

/**
 * Used by the sidebar list, the chat transcript, the quick-settings tabs and
 * the settings dialog to keep their scroll containers quiet: the bar is
 * painted only while the user scrolls or reaches for it, and disappears once
 * the container has been at rest for `SCROLLBAR_IDLE_DELAY_MS`.
 *
 * It returns a ref callback rather than reading a `RefObject`, because several
 * of these containers mount late — the outline tab renders a spinner until its
 * rows arrive, and the settings dialog returns `null` while closed. A callback
 * ref attaches on that mount, where an effect keyed on a ref object would have
 * seen `null` once and never looked again.
 *
 * The node keeps the bar's width the whole time — only the paint is switched —
 * so nothing reflows when the bar comes and goes. The stylesheet reads the
 * `data-scrollbar-idle` attribute this hook toggles; while it is absent the
 * theme's own thumb and track rules paint untouched, which is what keeps the
 * 25 bundled and user themes looking the way they already do.
 *
 * Programmatic scrolling (the transcript following a streaming reply) also
 * fires `scroll`, so the bar stays awake for as long as the content moves.
 *
 * `externalRef` is for the one caller that owns a ref object of its own (the
 * transcript pane, whose scroll position other hooks read): the node is
 * mirrored into it so both see the same element.
 */
export function useAutoHideScrollbar(externalRef?: RefObject<HTMLElement>): ScrollbarAttachment {
  const detach = useRef<(() => void) | null>(null);

  const attach = useCallback<ScrollbarAttachment>((node) => {
    detach.current?.();
    detach.current = null;

    if (externalRef) {
      // `RefObject.current` is read-only in the public type, but this is the
      // callback the ref object would have been attached through anyway.
      (externalRef as MutableRefObject<HTMLElement | null>).current = node;
    }

    if (!node) {
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
        node.setAttribute('data-scrollbar-idle', '');
      } else {
        node.removeAttribute('data-scrollbar-idle');
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
    // edge — hovering the content itself must not keep the bar awake, or the
    // transcript would show it permanently.
    const handlePointerMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
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

    // Set during the commit that mounts the node, so the bar never flashes.
    idle = true;
    node.setAttribute('data-scrollbar-idle', '');

    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('pointermove', handlePointerMove, { passive: true });
    node.addEventListener('pointerleave', handlePointerLeave);

    detach.current = () => {
      window.clearTimeout(idleTimer);
      node.removeEventListener('scroll', handleScroll);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [externalRef]);

  useEffect(() => () => {
    detach.current?.();
    detach.current = null;
  }, []);

  return attach;
}
