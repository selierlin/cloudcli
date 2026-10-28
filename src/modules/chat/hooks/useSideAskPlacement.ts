import { useEffect, useState } from 'react';

/**
 * How the side-question drawer is laid out for the width of the chat column.
 *
 * `docked` puts it beside the transcript so neither surface covers the other;
 * `overlay` floats it over a column too narrow to split but wide enough that
 * the reader can still see the transcript around it; `sheet` takes the whole
 * column, which is the only option on a phone.
 */
export type SideAskPlacement = 'docked' | 'overlay' | 'sheet';

/**
 * Below this the transcript would keep less than ~480px beside a 420px dock,
 * which is narrower than the columns code and tables need.
 */
export const SIDE_ASK_DOCKED_MIN_WIDTH = 900;

/** Below this an overlay would cover the whole column, so it becomes a sheet. */
export const SIDE_ASK_OVERLAY_MIN_WIDTH = 640;

/** Maps a measured column width to a placement. Kept pure so the thresholds are testable. */
export function resolveSideAskPlacement(width: number): SideAskPlacement {
  if (width >= SIDE_ASK_DOCKED_MIN_WIDTH) {
    return 'docked';
  }
  if (width >= SIDE_ASK_OVERLAY_MIN_WIDTH) {
    return 'overlay';
  }
  return 'sheet';
}

/**
 * Tracks the measured element's inline size and returns the drawer placement
 * that width allows.
 *
 * Measured rather than read from a viewport breakpoint: the project sidebar is
 * user-resizable (220–640px) and the editor sidebar can take the right half, so
 * the same viewport holds very different chat widths. A callback ref, not a
 * `RefObject`, because the host mounts this column only once a project is
 * selected — the node can appear long after the first render.
 */
export function useSideAskPlacement(): {
  ref: (node: HTMLElement | null) => void;
  placement: SideAskPlacement;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  // The measured width, not the placement: keeping the raw number means a
  // resize that stays inside one band does not re-render the drawer's parent.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!element) {
      return undefined;
    }

    const measure = () => {
      setWidth(element.getBoundingClientRect().width);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { ref: setElement, placement: resolveSideAskPlacement(width) };
}
