import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useRef } from 'react';
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

function Harness({
  initiallyNearViewport,
  isProcessCollapsed = false,
  renderRow = true,
  estimatedHeight,
}: {
  initiallyNearViewport: boolean;
  isProcessCollapsed?: boolean;
  renderRow?: boolean;
  estimatedHeight?: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  return (
    <div ref={scrollContainerRef}>
      {renderRow && (
        <LazyMessageRow
          lazyRows={lazyRows}
          rowKey="session-1:message-1"
          timestamp="2026-01-01T00:00:00.000Z"
          initiallyNearViewport={initiallyNearViewport}
          estimatedHeight={estimatedHeight}
          isProcessCollapsed={isProcessCollapsed}
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
    Object.defineProperty(wrapper, 'offsetHeight', { value: 123, configurable: true });

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
    Object.defineProperty(wrapper, 'offsetHeight', { value: 246, configurable: true });

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

  it('removes a collapsed process row from layout without unmounting its content', () => {
    const { container, queryByTestId } = render(
      <Harness initiallyNearViewport isProcessCollapsed />,
    );

    const wrapper = container.querySelector('[data-message-timestamp="2026-01-01T00:00:00.000Z"]');
    expect(wrapper?.classList.contains('hidden')).toBe(true);
    expect(queryByTestId('row-content')).not.toBeNull();
  });
});
