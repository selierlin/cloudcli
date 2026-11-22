import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { act, render } from '@testing-library/react';

import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import type { LazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';

/**
 * The observer measures unmeasured rows above the reader while they are
 * stationary, so a row entering the viewport band already carries its real
 * height. These tests drive the idle timer and the frames it waits for by hand;
 * the rows themselves are stand-in handles, because what is under test is the
 * pass's choice of rows, not the row's rendering.
 */

class InertIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

/** Rows sit above the pane (paneTop = 1000) unless a test says otherwise. */
const PANE_TOP = 1000;

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 100,
    bottom,
    width: 100,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

type WarmRowSpec = { key: string; bottom: number; height?: number };

function WarmHarness({
  rows,
  calls,
  warmEnabled = true,
  measured = [],
  mounted = [],
  observerRef,
}: {
  rows: WarmRowSpec[];
  calls: { key: string; warm: boolean }[];
  warmEnabled?: boolean;
  /** Row keys whose height is already known, as if the viewport band had mounted them once. */
  measured?: string[];
  /** Row keys whose content is mounted right now. */
  mounted?: string[];
  observerRef: MutableRefObject<LazyRowObserver | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lazyRows = useLazyRowObserver(containerRef, null, warmEnabled);
  const mountedKeys = useRef(new Set(mounted));

  useEffect(() => {
    if (!lazyRows) return undefined;
    observerRef.current = lazyRows;
    for (const key of measured) lazyRows.writeHeight(key, 40);
    const cleanups = rows.map((row) => {
      const element = containerRef.current?.querySelector(`[data-warm-row="${row.key}"]`);
      if (!element) return () => {};
      return lazyRows.observe(element, () => {}, {
        rowKey: row.key,
        isMounted: () => mountedKeys.current.has(row.key),
        setWarm: (warm) => {
          calls.push({ key: row.key, warm });
          if (warm) {
            mountedKeys.current.add(row.key);
            return;
          }
          mountedKeys.current.delete(row.key);
          lazyRows.writeHeight(row.key, row.height ?? 40);
        },
      });
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [lazyRows, rows, calls, measured, observerRef]);

  return (
    <div ref={containerRef} className="chat-messages-pane">
      {rows.map((row) => (
        <div key={row.key} data-warm-row={row.key} data-row-bottom={row.bottom} />
      ))}
    </div>
  );
}

/** Runs the idle timer plus the frames one measuring pass waits for. */
async function letPassRun(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

function inputEvent(type: string): Event {
  return new Event(type);
}

describe('useLazyRowObserver idle measuring pass', () => {
  let observerRef: MutableRefObject<LazyRowObserver | null>;

  beforeEach(() => {
    observerRef = { current: null };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.stubGlobal('IntersectionObserver', InertIntersectionObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('chat-messages-pane')) return rect(PANE_TOP, PANE_TOP + 900);
      const bottom = this.getAttribute('data-row-bottom');
      if (bottom !== null) return rect(Number(bottom) - 40, Number(bottom));
      return rect(0, 0);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('measures the nearest unmeasured rows above the reader, once each', async () => {
    const calls: { key: string; warm: boolean }[] = [];
    const rows: WarmRowSpec[] = [
      { key: 'nearest', bottom: 900 },
      { key: 'second', bottom: 800 },
      { key: 'third', bottom: 700 },
      { key: 'below-pane', bottom: 1100 },
      { key: 'already-mounted', bottom: 950 },
      { key: 'beyond-lookahead', bottom: PANE_TOP - 6200 },
    ];

    render(
      <WarmHarness
        rows={rows}
        calls={calls}
        mounted={['already-mounted']}
        observerRef={observerRef}
      />,
    );
    await letPassRun();

    expect(calls.map((call) => `${call.key}:${call.warm}`)).toEqual([
      'nearest:true',
      'second:true',
      'third:true',
      'nearest:false',
      'second:false',
      'third:false',
    ]);

    // The rows the pass measured now carry a height, so a second idle period
    // leaves them alone instead of mounting them again.
    calls.length = 0;
    await letPassRun();
    expect(calls).toEqual([]);
  });

  it('skips rows whose height is already known', async () => {
    const calls: { key: string; warm: boolean }[] = [];
    const rows: WarmRowSpec[] = [
      { key: 'measured', bottom: 900 },
      { key: 'unknown', bottom: 800 },
    ];

    render(
      <WarmHarness rows={rows} calls={calls} measured={['measured']} observerRef={observerRef} />,
    );
    await letPassRun();

    expect(calls.map((call) => call.key)).toEqual(['unknown', 'unknown']);
  });

  it('does not measure while a finger is down', async () => {
    const calls: { key: string; warm: boolean }[] = [];
    const rows: WarmRowSpec[] = [{ key: 'row', bottom: 900 }];
    const { container } = render(
      <WarmHarness rows={rows} calls={calls} observerRef={observerRef} />,
    );
    const pane = container.querySelector('.chat-messages-pane') as HTMLElement;

    act(() => {
      pane.dispatchEvent(inputEvent('touchstart'));
    });
    await letPassRun();
    expect(calls).toEqual([]);

    act(() => {
      pane.dispatchEvent(inputEvent('touchend'));
    });
    await letPassRun();
    expect(calls.map((call) => `${call.key}:${call.warm}`)).toEqual(['row:true', 'row:false']);
  });

  it('does nothing when the transcript turns measuring off', async () => {
    const calls: { key: string; warm: boolean }[] = [];
    const rows: WarmRowSpec[] = [{ key: 'row', bottom: 900 }];

    render(
      <WarmHarness rows={rows} calls={calls} warmEnabled={false} observerRef={observerRef} />,
    );
    await letPassRun();

    expect(calls).toEqual([]);
  });
});
