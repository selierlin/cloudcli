import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject, RefObject } from 'react';

import { useBottomEdgeResizeCompensation } from '@/modules/chat/hooks/useBottomEdgeResizeCompensation';

/**
 * The transcript pane compensates scrollTop when its scroll container's height
 * changes, so the rows sitting against the container's bottom edge (the
 * input's neighbours) stay against it. These tests drive the ResizeObserver
 * callback directly against mocked geometry, mirroring how the transcript
 * scroll ownership tests stub the same reads and writes.
 */

type ObserverStub = { callback: () => void; disconnected: boolean };

let observerStubs: ObserverStub[] = [];

class MockResizeObserver {
  private readonly stub: ObserverStub;

  constructor(callback: () => void) {
    this.stub = { callback, disconnected: false };
    observerStubs.push(this.stub);
  }

  // The real observer reports the observed element's current size once on
  // observe; that initial report is the zero-delta case the hook must ignore.
  observe() {
    this.stub.callback();
  }

  disconnect() {
    this.stub.disconnected = true;
  }
}

/** Notifies every live observer, as a container resize would. */
function fireContainerResize() {
  observerStubs.forEach((stub) => {
    if (!stub.disconnected) stub.callback();
  });
}

/**
 * jsdom has no layout, so clientHeight/scrollHeight are always 0 and assigning
 * scrollTop emits nothing. These are the exact reads the hook makes.
 */
function createContainer(scrollHeight: number, initialClientHeight: number) {
  const element = document.createElement('div');
  const writes: number[] = [];
  let clientHeight = initialClientHeight;
  let scrollTop = 0;

  Object.defineProperty(element, 'scrollHeight', { get: () => scrollHeight });
  Object.defineProperty(element, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes.push(next);
    },
  });

  return {
    element: element as HTMLDivElement,
    currentScrollTop: () => scrollTop,
    writes,
    setClientHeight: (next: number) => {
      clientHeight = next;
    },
    setScrollTop: (next: number) => {
      scrollTop = next;
    },
  };
}

function renderWithContainer(element: HTMLDivElement | null) {
  const scrollContainerRef: RefObject<HTMLDivElement> = { current: element };
  const programmaticScrollTopRef: MutableRefObject<number | null> = { current: null };
  return {
    ...renderHook(() => useBottomEdgeResizeCompensation(scrollContainerRef, programmaticScrollTopRef)),
    programmaticScrollTopRef,
  };
}

beforeEach(() => {
  observerStubs = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBottomEdgeResizeCompensation', () => {
  it('keeps a bottom-pinned reader pinned when the container shrinks', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(2200);
    renderWithContainer(container.element);

    container.setClientHeight(500);
    fireContainerResize();

    expect(container.writes).toEqual([2500]);
    expect(container.currentScrollTop()).toBe(2500);
  });

  it('moves a history-reading reader up by the same amount as the edge', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(1000);
    renderWithContainer(container.element);

    container.setClientHeight(500);
    fireContainerResize();

    expect(container.writes).toEqual([1300]);
    expect(container.currentScrollTop()).toBe(1300);
  });

  it('restores the original position when the container grows back', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(1000);
    renderWithContainer(container.element);

    container.setClientHeight(500);
    fireContainerResize();
    container.setClientHeight(800);
    fireContainerResize();

    expect(container.writes).toEqual([1300, 1000]);
    expect(container.currentScrollTop()).toBe(1000);
  });

  it('ignores the initial same-size observe report', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(2200);
    renderWithContainer(container.element);

    expect(container.writes).toEqual([]);
  });

  it('ignores transitions through a collapsed zero-height container', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(1000);
    renderWithContainer(container.element);

    container.setClientHeight(0);
    fireContainerResize();
    container.setClientHeight(800);
    fireContainerResize();
    expect(container.writes).toEqual([]);

    // After the baseline is re-established by a real edge move, compensation
    // resumes: an 800 -> 500 shrink scrolls down by 300 again.
    container.setClientHeight(500);
    fireContainerResize();
    expect(container.writes).toEqual([1300]);
  });

  it('accumulates stepped shrinks, as an animated keyboard produces them', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(1000);
    renderWithContainer(container.element);

    container.setClientHeight(700);
    fireContainerResize();
    container.setClientHeight(500);
    fireContainerResize();

    expect(container.writes).toEqual([1100, 1300]);
  });

  it('records each write, so the ownership rule can tell it from a pull', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(1000);
    const { programmaticScrollTopRef } = renderWithContainer(container.element);

    // Growing the pane (the keyboard dropping, the composer shrinking) moves the
    // viewport up — the same direction a reader's pull moves it. Recording the
    // write is what keeps `handleScroll` from reading it as one.
    container.setClientHeight(1000);
    fireContainerResize();
    expect(container.currentScrollTop()).toBe(800);
    expect(programmaticScrollTopRef.current).toBe(800);

    container.setClientHeight(500);
    fireContainerResize();
    expect(container.currentScrollTop()).toBe(1300);
    expect(programmaticScrollTopRef.current).toBe(1300);
  });

  it('stops compensating once unmounted', () => {
    const container = createContainer(3000, 800);
    container.setScrollTop(1000);
    const { unmount } = renderWithContainer(container.element);

    unmount();
    container.setClientHeight(500);
    fireContainerResize();

    expect(container.writes).toEqual([]);
  });

  it('observes nothing without a container', () => {
    renderWithContainer(null);

    expect(observerStubs).toEqual([]);
  });
});
