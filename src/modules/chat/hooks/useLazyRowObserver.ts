import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

/** How far beyond the viewport a transcript row keeps (or gains) its mounted content. */
const LAZY_ROW_VIEWPORT_MARGIN_PX = 1200;

/** Quiet time after the last scroll or input before unmeasured rows above the reader are measured. */
const WARM_IDLE_MS = 160;

/** Rows mounted together for one measuring batch, small enough that the main thread is back within a frame or two. */
const WARM_BATCH_ROWS = 4;

/**
 * How far above the viewport, in the layout as it currently stands, rows are
 * measured ahead of the reader. Bounds the work of one idle period on a session
 * with thousands of rows; the next idle period continues from where the reader is.
 */
const WARM_LOOKAHEAD_PX = 6000;

/** Longest wait for a frame, so a hidden tab (no frames) cannot leave measuring rows mounted. */
const WARM_FRAME_TIMEOUT_MS = 120;

/**
 * What the observer needs from one row to measure it ahead of the reader. Used
 * by LazyMessageRow, which owns the row's mounted state.
 */
export type LazyRowWarmHandle = {
  rowKey: string;
  /** Whether the row's content is mounted right now. */
  isMounted: () => boolean;
  /**
   * Mounts the content so its real height can be read (`true`), or puts the row
   * back where the viewport band says it belongs (`false`). Leaving the band
   * records the measured height, so the placeholder that replaces the content
   * has exactly its height and nothing moves.
   */
  setWarm: (warm: boolean) => void;
};

export type LazyRowObserver = {
  /** Starts watching an element; returns the matching cleanup. */
  observe: (
    element: Element,
    onNearViewportChange: (isNearViewport: boolean) => void,
    warm?: LazyRowWarmHandle,
  ) => () => void;
  /** Returns the last non-zero rendered height recorded for one stable row. */
  readHeight: (rowKey: string) => number | undefined;
  /** Keeps measured geometry available when a lazy row is later remounted. */
  writeHeight: (rowKey: string, height: number) => void;
};

/**
 * Resolves after `count` animation frames, or after a timeout when frames are
 * not being produced.
 */
function waitFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const timeout = window.setTimeout(resolve, WARM_FRAME_TIMEOUT_MS * count);
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearTimeout(timeout);
        resolve();
      } else {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  });
}

/**
 * One shared IntersectionObserver for every LazyMessageRow of a transcript,
 * rooted at its scroll container. Returns null where IntersectionObserver does
 * not exist (jsdom), which keeps every row permanently mounted — the
 * pre-existing behavior.
 *
 * It also measures rows ahead of the reader. A row that has never been mounted
 * holds an estimated height, and the moment it enters the viewport band its real
 * height replaces the estimate: the content above the reader moves by the
 * difference, and while the view is coasting the platform discards the write
 * that would pay it back. Rows that have been measured once change nothing when
 * they mount again, so whenever the reader has been still for a moment the rows
 * just above the viewport are mounted briefly to take that first measurement.
 */
export function useLazyRowObserver(
  scrollContainerRef: RefObject<HTMLDivElement>,
  heightCacheScope?: string | null,
  warmEnabled = true,
): LazyRowObserver | null {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const callbacksRef = useRef(new Map<Element, (isNearViewport: boolean) => void>());
  const heightsRef = useRef(new Map<string, number>());
  /** Rows already mounted for measuring, including ones that render nothing and so never record a height. */
  const warmedKeysRef = useRef(new Set<string>());
  const warmHandlesRef = useRef(new Map<Element, LazyRowWarmHandle>());
  /** Re-arms the idle timer; set by the effect that owns the listeners. */
  const armWarmRef = useRef<(() => void) | null>(null);
  const isSupported = typeof IntersectionObserver !== 'undefined';

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  useEffect(() => {
    heightsRef.current.clear();
    warmedKeysRef.current.clear();
  }, [heightCacheScope]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!isSupported || !warmEnabled || !container) return undefined;

    let cancelled = false;
    let running = false;
    let touching = false;
    // Counts the reader's own input, not scroll events: the compensation a
    // measuring batch writes would otherwise end the pass that wrote it.
    let inputSeq = 0;
    let timer: number | undefined;

    const pickBatch = (): LazyRowWarmHandle[] => {
      const paneTop = container.getBoundingClientRect().top;
      const candidates: { handle: LazyRowWarmHandle; bottom: number }[] = [];
      for (const [element, handle] of warmHandlesRef.current) {
        if (
          warmedKeysRef.current.has(handle.rowKey)
          || heightsRef.current.has(handle.rowKey)
          || handle.isMounted()
        ) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        // A hidden row (folded process member, hidden tab) has no height to take.
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.bottom >= paneTop || rect.bottom < paneTop - WARM_LOOKAHEAD_PX) continue;
        candidates.push({ handle, bottom: rect.bottom });
      }
      // Nearest first: those are the rows the reader reaches first.
      candidates.sort((first, second) => second.bottom - first.bottom);
      return candidates.slice(0, WARM_BATCH_ROWS).map((candidate) => candidate.handle);
    };

    const runPass = async () => {
      if (running || cancelled) return;
      running = true;
      const startedAt = inputSeq;
      try {
        while (!cancelled && !touching && inputSeq === startedAt) {
          const batch = pickBatch();
          if (batch.length === 0) break;
          try {
            for (const handle of batch) {
              warmedKeysRef.current.add(handle.rowKey);
              handle.setWarm(true);
            }
            // One frame to commit and correct the viewport, one to be sure it held.
            await waitFrames(2);
          } finally {
            for (const handle of batch) handle.setWarm(false);
          }
          await waitFrames(1);
        }
      } finally {
        running = false;
      }
      // The reader moved mid-pass; the timer that input armed may have fired while this ran.
      if (!cancelled && inputSeq !== startedAt) arm();
    };

    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!touching) void runPass();
      }, WARM_IDLE_MS);
    };

    const onInput = (event: Event) => {
      inputSeq += 1;
      if (event.type === 'touchstart') touching = true;
      if (event.type === 'touchend' || event.type === 'touchcancel') touching = false;
      arm();
    };

    const inputEvents = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'pointerdown', 'keydown'] as const;
    for (const type of inputEvents) container.addEventListener(type, onInput, { passive: true });
    // Scrolling re-arms the timer without counting as input: momentum after a
    // lift produces scroll events and no touch events.
    container.addEventListener('scroll', arm, { passive: true });
    armWarmRef.current = arm;
    arm();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const type of inputEvents) container.removeEventListener(type, onInput);
      container.removeEventListener('scroll', arm);
      armWarmRef.current = null;
    };
  }, [isSupported, scrollContainerRef, warmEnabled]);

  const observe = useCallback<LazyRowObserver['observe']>((element, onNearViewportChange, warm) => {
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver((observerEntries) => {
        for (const entry of observerEntries) {
          // A zero-sized rect means the row is inside a display:none subtree
          // (the Chat tab is hidden), not that the user scrolled away — keep
          // the row's state, and its recorded height, intact.
          if (
            !entry.isIntersecting
            && entry.boundingClientRect.width === 0
            && entry.boundingClientRect.height === 0
          ) {
            continue;
          }
          callbacksRef.current.get(entry.target)?.(entry.isIntersecting);
        }
      }, {
        root: scrollContainerRef.current,
        rootMargin: `${LAZY_ROW_VIEWPORT_MARGIN_PX}px 0px`,
      });
    }

    callbacksRef.current.set(element, onNearViewportChange);
    if (warm) {
      warmHandlesRef.current.set(element, warm);
      // Rows arrive in bulk (a page, "load all"); the timer only needs to know there is something new.
      armWarmRef.current?.();
    }
    observerRef.current.observe(element);
    return () => {
      callbacksRef.current.delete(element);
      warmHandlesRef.current.delete(element);
      observerRef.current?.unobserve(element);
    };
  }, [scrollContainerRef]);

  const readHeight = useCallback((rowKey: string) => heightsRef.current.get(rowKey), []);
  const writeHeight = useCallback((rowKey: string, height: number) => {
    if (height > 0) heightsRef.current.set(rowKey, height);
  }, []);

  // Identity-stable so each row's observe effect runs once, not per render.
  return useMemo(
    () => (isSupported ? { observe, readHeight, writeHeight } : null),
    [isSupported, observe, readHeight, writeHeight],
  );
}
