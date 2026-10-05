import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React, { useEffect, useRef } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useExpandScrollAnchor } from '@/modules/sidebar/hooks/useExpandScrollAnchor';

/**
 * The hook compensates the sidebar's scrollTop while the collapse animation of
 * the previously expanded project pulls the clicked row upwards. jsdom has no
 * layout, so the harness scripts the only two facts the hook reads: the row's
 * document position (which the collapse shrinks) and a writable scrollTop that
 * feeds back into the measured offset, the way real geometry does — otherwise
 * the follow loop would chase a rect that never converges.
 */

let nextFrameId = 1;
let frameCallbacks = new Map<number, FrameRequestCallback>();

function runAnimationFrame(): void {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  callbacks.forEach((callback) => callback(16));
}

/** Mirrors SidebarProjectItem: captures the click-time offset on the current row. */
let beginAnchor: () => void = () => {};

function Harness({ expanded }: { expanded: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const anchor = useExpandScrollAnchor(expanded, rowRef);
  useEffect(() => {
    beginAnchor = anchor;
  }, [anchor]);
  return (
    <div className="overflow-auto">
      <div data-testid="row" ref={rowRef} />
    </div>
  );
}

/** The row with no scroll container above it, so the hook must stay inert. */
function RowWithoutScroller({ expanded }: { expanded: boolean }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const anchor = useExpandScrollAnchor(expanded, rowRef);
  useEffect(() => {
    beginAnchor = anchor;
  }, [anchor]);
  return <div data-testid="row" ref={rowRef} />;
}

/** jsdom scroll containers have no geometry: supply scrollTop and a fixed top. */
function scriptScroller(element: HTMLElement, initialScrollTop: number) {
  let scrollTop = initialScrollTop;
  const writes: number[] = [];
  element.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes.push(next);
    },
  });
  return { writes, scrollTop: () => scrollTop };
}

/** The row sits `getDocumentTop()` down the scrolled content. */
function scriptRow(row: HTMLElement, scroller: HTMLElement, getDocumentTop: () => number) {
  row.getBoundingClientRect = () => ({ top: getDocumentTop() - scroller.scrollTop } as DOMRect);
}

function rowOffset(row: HTMLElement, scroller: HTMLElement): number {
  return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

beforeEach(() => {
  nextFrameId = 1;
  frameCallbacks = new Map();
  beginAnchor = () => {};
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('pins the expanded row to its clicked offset while the collapse pulls it up', () => {
  let documentTop = 500;
  const { getByTestId, rerender } = render(<Harness expanded={false} />);
  const row = getByTestId('row');
  const scroller = row.parentElement as HTMLElement;
  const scrollerState = scriptScroller(scroller, 300);
  scriptRow(row, scroller, () => documentTop);

  // A click is about to expand this row; SidebarProjectItem captures the
  // pre-click offset (500 - 300 = 200).
  beginAnchor();

  // The previously expanded project collapses 260px above the row.
  documentTop = 240;
  rerender(<Harness expanded />);

  runAnimationFrame();
  runAnimationFrame();

  // scrollTop gave back exactly the collapsed height, so the row stays put.
  assert.equal(scrollerState.scrollTop(), 40);
  assert.equal(rowOffset(row, scroller), 200);
});

test('stops following as soon as the user scrolls the container', () => {
  let documentTop = 500;
  const { getByTestId, rerender } = render(<Harness expanded={false} />);
  const row = getByTestId('row');
  const scroller = row.parentElement as HTMLElement;
  const scrollerState = scriptScroller(scroller, 300);
  scriptRow(row, scroller, () => documentTop);

  beginAnchor();
  documentTop = 240;
  rerender(<Harness expanded />);

  scroller.dispatchEvent(new Event('wheel'));
  runAnimationFrame();

  assert.deepEqual(scrollerState.writes, []);
  assert.equal(scrollerState.scrollTop(), 300);
});

test('stays inert when the row has no scroll container', () => {
  const { rerender } = render(<RowWithoutScroller expanded={false} />);

  beginAnchor();
  rerender(<RowWithoutScroller expanded />);

  assert.equal(frameCallbacks.size, 0);
});
