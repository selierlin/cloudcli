import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React, { useRef } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useRevealPinnedBlockStart } from '@/modules/sidebar/hooks/useRevealPinnedBlockStart';

/**
 * jsdom has no layout, so each case scripts the rects the hook reads: the scroll
 * container's top edge, each block's own top (which moves with the scroll) and
 * each header's top (which stays at the edge while it is pinned). scrollTop is
 * writable so the correction can be asserted.
 *
 * The hook corrects over a settle window rather than in a single frame, because
 * the offset it corrects does not exist at first paint; the cases below drive
 * both the timers and the scroll events that window listens to.
 */

let frameCallbacks: FrameRequestCallback[] = [];

function runAnimationFrame(): void {
  const callbacks = [...frameCallbacks];
  frameCallbacks = [];
  callbacks.forEach((callback) => callback(16));
}

/** Advances past the checks scheduled early in the settle window. */
function settle(): void {
  vi.advanceTimersByTime(500);
  runAnimationFrame();
}

function Harness({ blocks = 1 }: { blocks?: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  useRevealPinnedBlockStart(listRef);
  return (
    <div className="overflow-auto">
      <div ref={listRef}>
        {Array.from({ length: blocks }).map((_, index) => (
          <div key={index} data-sidebar-project-block data-testid={`block-${index}`}>
            <div data-testid={`header-${index}`} />
            <div data-testid={`list-${index}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

type BlockGeometry = { blockTop: number; headerTop: number };

function scriptGeometry(container: HTMLElement, options: { scrollerTop?: number; scrollTop?: number } = {}) {
  const { scrollerTop = 0, scrollTop: initialScrollTop = 300 } = options;
  const scroller = container.querySelector('.overflow-auto') as HTMLElement;

  let scrollTop = initialScrollTop;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
  });
  scroller.getBoundingClientRect = () => ({ top: scrollerTop } as DOMRect);

  const place = (index: number, { blockTop, headerTop }: BlockGeometry) => {
    const block = container.querySelector(`[data-testid="block-${index}"]`) as HTMLElement;
    const header = container.querySelector(`[data-testid="header-${index}"]`) as HTMLElement;
    block.getBoundingClientRect = () => ({ top: blockTop } as DOMRect);
    header.getBoundingClientRect = () => ({ top: headerTop } as DOMRect);
  };

  return {
    scrollTop: () => scrollTop,
    place,
    scroll: () => scroller.dispatchEvent(new Event('scroll')),
    input: (type: string) => scroller.dispatchEvent(new Event(type)),
  };
}

beforeEach(() => {
  frameCallbacks = [];
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('realigns a block whose restored offset lands after mount', () => {
  const { container } = render(<Harness />);
  const state = scriptGeometry(container);
  // First paint: the block sits at the container top, nothing to correct.
  state.place(0, { blockTop: 20, headerTop: 20 });
  settle();
  assert.equal(state.scrollTop(), 300);

  // The restore then lands inside the block: its header is pinned while the
  // block's own top edge is 240px above the container.
  state.place(0, { blockTop: -240, headerTop: 0 });
  state.scroll();
  runAnimationFrame();

  // Gave back exactly the 240px the block had scrolled past its own top edge.
  assert.equal(state.scrollTop(), 60);
});

test('leaves a block that is already at the container top alone', () => {
  const { container } = render(<Harness />);
  const state = scriptGeometry(container);
  state.place(0, { blockTop: 0, headerTop: 0 });

  settle();

  assert.equal(state.scrollTop(), 300);
});

test('ignores a block scrolled entirely above the viewport', () => {
  const { container } = render(<Harness />);
  const state = scriptGeometry(container);
  // Header stuck above the edge, not pinned: a block further up the list.
  state.place(0, { blockTop: -300, headerTop: -60 });

  settle();

  assert.equal(state.scrollTop(), 300);
});

test('corrects the pinned block, not the one above it', () => {
  const { container } = render(<Harness blocks={2} />);
  const state = scriptGeometry(container);
  state.place(0, { blockTop: -900, headerTop: -60 });
  state.place(1, { blockTop: -120, headerTop: 0 });

  settle();

  assert.equal(state.scrollTop(), 180);
});

test('stops correcting once the user has scrolled', () => {
  const { container } = render(<Harness />);
  const state = scriptGeometry(container);
  state.place(0, { blockTop: 20, headerTop: 20 });
  settle();

  state.input('wheel');
  state.place(0, { blockTop: -240, headerTop: 0 });
  state.scroll();
  runAnimationFrame();

  assert.equal(state.scrollTop(), 300);
});

test('stops correcting after the settle window closes', () => {
  const { container } = render(<Harness />);
  const state = scriptGeometry(container);
  state.place(0, { blockTop: 20, headerTop: 20 });
  settle();

  vi.advanceTimersByTime(5000);
  state.place(0, { blockTop: -240, headerTop: 0 });
  state.scroll();
  runAnimationFrame();

  assert.equal(state.scrollTop(), 300);
});
