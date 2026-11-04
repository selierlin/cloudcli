import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useRef } from 'react';
import type { MutableRefObject } from 'react';
import { act, render } from '@testing-library/react';

import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';

/**
 * Drivable IntersectionObserver stand-in: jsdom has none, so these tests
 * install one and fire its callback by hand to walk a row through the
 * near-viewport / far-away transitions.
 */
class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    StubIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(element: Element): void {
    this.observed = this.observed.filter((observed) => observed !== element);
  }

  disconnect(): void {
    this.observed = [];
  }
}

function fireIntersection(
  observer: StubIntersectionObserver,
  target: Element,
  isIntersecting: boolean,
  rect: { width: number; height: number } = { width: 100, height: 40 },
): void {
  act(() => {
    observer.callback(
      [{ target, isIntersecting, boundingClientRect: rect } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
}

/**
 * The row measures itself with `getBoundingClientRect` (sub-pixel heights and
 * 0-height rows both matter), which jsdom always reports as zeros. Give the
 * element a real box so the measurement is taken.
 */
function stubMeasuredHeight(element: HTMLElement, height: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: height,
      width: 640,
      height,
      toJSON: () => ({}),
    }),
  });
}

function Harness({
  initiallyNearViewport,
  isProcessCollapsed = false,
  renderRow = true,
  estimatedHeight,
  scrollTopRef,
}: {
  initiallyNearViewport: boolean;
  isProcessCollapsed?: boolean;
  renderRow?: boolean;
  estimatedHeight?: number;
  /** Lets a test read back the writes the row registered. */
  scrollTopRef?: MutableRefObject<number | null>;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const ownScrollTopRef = useRef<number | null>(null);
  const programmaticScrollTopRef = scrollTopRef ?? ownScrollTopRef;
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  return (
    // The real pane's class name is what the row anchors itself against.
    <div ref={scrollContainerRef} className="chat-messages-pane">
      {renderRow && (
        <LazyMessageRow
          lazyRows={lazyRows}
          rowKey="session-1:message-1"
          timestamp="2026-01-01T00:00:00.000Z"
          initiallyNearViewport={initiallyNearViewport}
          estimatedHeight={estimatedHeight}
          isProcessCollapsed={isProcessCollapsed}
          programmaticScrollTopRef={programmaticScrollTopRef}
        >
          <span data-testid="row-content">expensive content</span>
        </LazyMessageRow>
      )}
    </div>
  );
}

afterEach(() => {
  StubIntersectionObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('LazyMessageRow', () => {
  it('starts far rows as an addressable placeholder instead of mounting content', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { container, queryByTestId } = render(<Harness initiallyNearViewport={false} />);

    expect(queryByTestId('row-content')).toBeNull();
    const wrapper = container.querySelector('[data-message-timestamp="2026-01-01T00:00:00.000Z"]');
    expect(wrapper).not.toBeNull();
    expect((wrapper as HTMLElement).style.height).not.toBe('');
  });

  it('unmounts to a placeholder of the measured height and remounts when near again', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { queryByTestId } = render(<Harness initiallyNearViewport />);
    expect(queryByTestId('row-content')).not.toBeNull();

    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    stubMeasuredHeight(wrapper, 123);

    fireIntersection(observer, wrapper, false);
    expect(queryByTestId('row-content')).toBeNull();
    expect(wrapper.style.height).toBe('123px');

    fireIntersection(observer, wrapper, true);
    expect(queryByTestId('row-content')).not.toBeNull();
    expect(wrapper.style.height).toBe('');
  });

  it('reuses the measured height when the same stable row is mounted again', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const view = render(<Harness initiallyNearViewport />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    stubMeasuredHeight(wrapper, 246);

    fireIntersection(observer, wrapper, false);
    expect(wrapper.style.height).toBe('246px');

    view.rerender(<Harness initiallyNearViewport={false} renderRow={false} />);
    view.rerender(<Harness initiallyNearViewport={false} />);

    const remountedWrapper = view.container.querySelector(
      '[data-message-timestamp="2026-01-01T00:00:00.000Z"]',
    ) as HTMLElement;
    expect(remountedWrapper.style.height).toBe('246px');
  });

  it('uses the caller estimate until an unseen row has a measured height', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { container } = render(
      <Harness initiallyNearViewport={false} estimatedHeight={320} />,
    );

    const wrapper = container.querySelector(
      '[data-message-timestamp="2026-01-01T00:00:00.000Z"]',
    ) as HTMLElement;
    expect(wrapper.style.height).toBe('320px');
  });

  it('ignores the zero-rect non-intersections a hidden tab reports', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const { queryByTestId } = render(<Harness initiallyNearViewport />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;

    fireIntersection(observer, wrapper, false, { width: 0, height: 0 });

    expect(queryByTestId('row-content')).not.toBeNull();
  });

  it('keeps every row mounted where IntersectionObserver does not exist', () => {
    const { queryByTestId } = render(<Harness initiallyNearViewport={false} />);

    expect(queryByTestId('row-content')).not.toBeNull();
    expect(StubIntersectionObserver.instances).toHaveLength(0);
  });

  it('puts a lazily re-anchored row back where it sat and registers the write', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const scrollTopRef: MutableRefObject<number | null> = { current: null };
    const { container } = render(
      <Harness initiallyNearViewport scrollTopRef={scrollTopRef} />,
    );
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const pane = container.querySelector('.chat-messages-pane') as HTMLElement;

    // A real pane has a scrollable range. jsdom reports both of these as 0,
    // which puts every offset past the end and would trip the out-of-range
    // guard — the subject of its own test below.
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 });

    // jsdom has no layout, so the pane's scroll position and the row's screen
    // position are both faked. The sequence matters: the row reads its own top
    // to remember where it sat, reads its box to measure the placeholder, and
    // the commit then lands with the browser having moved it 400px down — the
    // re-anchor this correction exists to undo.
    let scrollTop = 1000;
    Object.defineProperty(pane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    let reads = 0;
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        reads += 1;
        const top = reads <= 2 ? 500 : 900;
        return { x: 0, y: top, top, left: 0, right: 640, bottom: top + 123, width: 640, height: 123, toJSON: () => ({}) };
      },
    });

    fireIntersection(observer, wrapper, false);

    expect(pane.scrollTop).toBe(1400);
    // Registered, so `handleScroll` does not read the upward move as the reader
    // pulling away and latch the follow off.
    expect(scrollTopRef.current).toBe(1400);
  });

  it('leaves the offset to the browser while the pane is still past its end', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const scrollTopRef: MutableRefObject<number | null> = { current: null };
    const { container } = render(
      <Harness initiallyNearViewport scrollTopRef={scrollTopRef} />,
    );
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const pane = container.querySelector('.chat-messages-pane') as HTMLElement;

    // iOS reports a drag past the end as an offset beyond the clamp: 4700 is
    // 300px past the 4400 this pane can reach, and the platform is springing the
    // content back. Mounting this row while that runs moves it on screen — the
    // displacement is the animation, not the layout. Correcting for it rewrites
    // the offset, and the write is clamped to the edge, which ends the spring.
    let scrollTop = 4700;
    Object.defineProperty(pane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 });
    let reads = 0;
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        reads += 1;
        const top = reads <= 2 ? 500 : 900;
        return { x: 0, y: top, top, left: 0, right: 640, bottom: top + 123, width: 640, height: 123, toJSON: () => ({}) };
      },
    });

    fireIntersection(observer, wrapper, false);

    expect(scrollTop).toBe(4700);
    expect(scrollTopRef.current).toBeNull();
  });

  it('leaves the offset to a pane that moved under the row', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const scrollTopRef: MutableRefObject<number | null> = { current: null };
    const { container } = render(
      <Harness initiallyNearViewport scrollTopRef={scrollTopRef} />,
    );
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const pane = container.querySelector('.chat-messages-pane') as HTMLElement;

    let scrollTop = 1000;
    Object.defineProperty(pane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 });

    // The pane keeps scrolling between the measurement and the commit — a
    // finger, or the inertia tail of one. The row's 400px of screen travel is
    // exactly the scroll and nothing else, so there is no layout shift to pay
    // back, and writing the travel would steer the pane against whatever is
    // moving it: on iOS that write ends the deceleration.
    let reads = 0;
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        reads += 1;
        if (reads === 2) scrollTop += 400;
        const top = reads <= 2 ? 500 : 100;
        return { x: 0, y: top, top, left: 0, right: 640, bottom: top + 123, width: 640, height: 123, toJSON: () => ({}) };
      },
    });

    fireIntersection(observer, wrapper, false);

    expect(scrollTop).toBe(1400);
    expect(scrollTopRef.current).toBeNull();
  });

  it('corrects a large layout shift even while the pane is coasting', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const scrollTopRef: MutableRefObject<number | null> = { current: null };
    const { container } = render(
      <Harness initiallyNearViewport scrollTopRef={scrollTopRef} />,
    );
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const pane = container.querySelector('.chat-messages-pane') as HTMLElement;

    // Measured on a phone: the row sat 303px below the pane top and mounted as
    // 1290px of real content, while inertia carried the pane 12px. The reader
    // saw the transcript drop 610px because the old rule stood down on any
    // offset change, however small next to the shift.
    let scrollTop = 2096;
    Object.defineProperty(pane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 });
    let reads = 0;
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        reads += 1;
        if (reads === 2) scrollTop = 2084;
        const top = reads <= 2 ? 303 : 925;
        return { x: 0, y: top, top, left: 0, right: 640, bottom: top + 1290, width: 640, height: 1290, toJSON: () => ({}) };
      },
    });

    fireIntersection(observer, wrapper, false);

    // 622px of layout growth less the 12px the pane coasted.
    expect(scrollTop).toBe(2694);
    expect(scrollTopRef.current).toBe(2694);
  });

  it('measures the visible row when the row being mounted sits above the viewport', () => {
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const scrollTopRef: MutableRefObject<number | null> = { current: null };
    function AboveViewportHarness() {
      const ownRef = useRef<HTMLDivElement>(null);
      const lazyRows = useLazyRowObserver(ownRef);
      return (
        <div ref={ownRef} className="chat-messages-pane">
          <LazyMessageRow
            lazyRows={lazyRows}
            rowKey="session-1:above"
            timestamp="2026-01-01T00:00:00.000Z"
            initiallyNearViewport={false}
            programmaticScrollTopRef={scrollTopRef}
          >
            <span data-testid="row-content">expensive content</span>
          </LazyMessageRow>
          <div data-message-timestamp="2026-01-01T00:00:01.000Z" />
        </div>
      );
    }

    const { container } = render(<AboveViewportHarness />);
    const observer = StubIntersectionObserver.instances[0];
    const wrapper = observer.observed[0] as HTMLElement;
    const pane = container.querySelector('.chat-messages-pane') as HTMLElement;
    const visibleRow = container.querySelector(
      '[data-message-timestamp="2026-01-01T00:00:01.000Z"]',
    ) as HTMLElement;

    let scrollTop = 1000;
    Object.defineProperty(pane, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 });

    // The row that mounts lives 800px above the pane and grows downward, so its
    // own top never moves: measuring it would report no layout change at all.
    Object.defineProperty(wrapper, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: -800, top: -800, left: 0, right: 640, bottom: -676, width: 640, height: 124, toJSON: () => ({}) }),
    });
    // The row the reader is looking at is pushed down by the 128px that appeared
    // above it. This is the measurement that has to be paid back.
    let visibleReads = 0;
    Object.defineProperty(visibleRow, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        visibleReads += 1;
        const top = visibleReads <= 1 ? 500 : 628;
        return { x: 0, y: top, top, left: 0, right: 640, bottom: top + 123, width: 640, height: 123, toJSON: () => ({}) };
      },
    });

    // Mounting the row above the viewport is what grows the transcript there.
    fireIntersection(observer, wrapper, true);

    expect(scrollTop).toBe(1128);
    expect(scrollTopRef.current).toBe(1128);
  });

  it('removes and unmounts a collapsed process row while retaining its timestamp anchor', () => {
    const { container, queryByTestId } = render(
      <Harness initiallyNearViewport isProcessCollapsed />,
    );

    const wrapper = container.querySelector('[data-message-timestamp="2026-01-01T00:00:00.000Z"]');
    expect(wrapper?.classList.contains('hidden')).toBe(true);
    expect(queryByTestId('row-content')).toBeNull();
  });
});
