import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { SidebarProjectRevealRequest } from '@/shared/types';

/** The sidebar's scroll container is ScrollArea's inner `overflow-auto` div. */
const SCROLLER_SELECTOR = '.overflow-auto, .overflow-y-auto, [data-scroll-container]';

/**
 * How long to keep looking for the requested block. A locate click can land
 * before the list shows the group: clearing a search settles the debounced
 * query and the group itself may still be re-rendering, so the first frame
 * after the click frequently has no element to scroll to yet.
 */
const FIND_DEADLINE_MS = 1000;

/**
 * Wait for the group's own expand transition before scrolling.
 *
 * SidebarProjectSessions animates grid-template-rows over 200ms and
 * useExpandScrollAnchor holds the row at its pre-click viewport offset for
 * 260ms. Scrolling inside that window is simply undone: the anchor keeps
 * adding the difference back on every frame. Starting after the follow window
 * closes leaves this the only writer.
 */
const EXPAND_SETTLE_MS = 300;

/** A short correction window after the wait, for a sibling group still collapsing. */
const PIN_MS = 150;

/** Sub-pixel drift is ignored; `scrollTop` rounds to device pixels. */
const MIN_DRIFT_PX = 1;

/**
 * Scrolls the project list to the group named by `request` and, when a session
 * was supplied, brings that session's row into view afterwards.
 *
 * Mounted by SidebarProjectList, which owns the list element. The block is
 * found by `data-project-id` rather than by index so a filtered or reordered
 * list cannot scroll to the wrong project.
 */
export function useRevealProjectBlock<T extends HTMLElement>(
  listRef: RefObject<T | null>,
  request: SidebarProjectRevealRequest | null,
): void {
  // Layout effects run twice under StrictMode; the seq keeps the reveal single-shot.
  const handledSeqRef = useRef(0);

  useLayoutEffect(() => {
    if (!request || request.seq === handledSeqRef.current) {
      return;
    }

    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>(SCROLLER_SELECTOR) ?? null;
    if (!list || !scroller) {
      return;
    }

    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const findDeadline = performance.now() + FIND_DEADLINE_MS;

    const settle = (block: HTMLElement) => {
      handledSeqRef.current = request.seq;

      timer = setTimeout(() => {
        const pinDeadline = performance.now() + PIN_MS;

        const pin = () => {
          const drift = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(drift) >= MIN_DRIFT_PX) {
            scroller.scrollTop += drift;
          }
          if (performance.now() < pinDeadline) {
            frame = requestAnimationFrame(pin);
            return;
          }
          frame = 0;
          revealSession(list, scroller, request.sessionId);
        };

        frame = requestAnimationFrame(pin);
      }, EXPAND_SETTLE_MS);
    };

    const find = () => {
      const block = Array.from(list.querySelectorAll<HTMLElement>('[data-project-id]'))
        .find((element) => element.dataset.projectId === request.projectId);
      if (block) {
        settle(block);
        return;
      }
      frame = performance.now() < findDeadline ? requestAnimationFrame(find) : 0;
    };

    frame = requestAnimationFrame(find);

    return () => {
      clearTimeout(timer);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
  }, [listRef, request]);
}

/**
 * Brings the session row into the container's visible area after the group has
 * been pinned to its top. `nearest` leaves a row that is already visible
 * untouched; a long group otherwise lands with its active session below the fold.
 */
function revealSession(
  list: HTMLElement,
  scroller: HTMLElement,
  sessionId: string | null | undefined,
): void {
  if (!sessionId) {
    return;
  }

  const row = Array.from(list.querySelectorAll<HTMLElement>('a[href^="/session/"]'))
    .find((element) => element.getAttribute('href') === `/session/${sessionId}`);
  if (!row) {
    return;
  }

  const rowRect = row.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  if (rowRect.top < scrollerRect.top || rowRect.bottom > scrollerRect.bottom) {
    row.scrollIntoView({ block: 'nearest' });
  }
}
