import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { useAutoHideScrollbar } from '@/shared/hooks/useAutoHideScrollbar';

/**
 * The bar is hidden by an attribute the stylesheet reads, so the contract this
 * hook has to keep is only about when the attribute is there: absent while the
 * container moves or while the pointer reaches for the bar, present once it has
 * been at rest for the delay. The visual side lives in index.css and is
 * covered by `scrollbarChrome.test.ts`.
 */

const RIGHT_EDGE = 300;

const makeNode = () => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: RIGHT_EDGE,
    bottom: 400,
    width: RIGHT_EDGE,
    height: 400,
    toJSON: () => ({}),
  });
  return element;
};

const setup = (externalRef?: RefObject<HTMLElement>) => {
  const element = makeNode();
  const view = renderHook(() => useAutoHideScrollbar(externalRef));
  act(() => view.result.current(element));
  return { element, ...view };
};

const pointerMove = (element: HTMLElement, clientX: number) => {
  element.dispatchEvent(new MouseEvent('pointermove', { clientX }));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('starts hidden, so the bar never flashes on load', () => {
  const { element } = setup();
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(true);
});

test('scroll paints the bar and rest puts it away again', () => {
  const { element } = setup();

  act(() => element.dispatchEvent(new Event('scroll')));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(false);

  act(() => vi.advanceTimersByTime(699));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(false);

  act(() => vi.advanceTimersByTime(1));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(true);
});

test('a pointer on the bar keeps it up, wherever the container is at rest', () => {
  const { element } = setup();

  act(() => pointerMove(element, RIGHT_EDGE - 4));
  act(() => vi.advanceTimersByTime(5000));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(false);

  act(() => pointerMove(element, RIGHT_EDGE - 120));
  act(() => vi.advanceTimersByTime(700));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(true);
});

test('hovering the content away from the edge does not wake the bar', () => {
  const { element } = setup();

  act(() => pointerMove(element, 40));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(true);
});

test('leaving the container puts the bar back to rest', () => {
  const { element } = setup();

  act(() => pointerMove(element, RIGHT_EDGE - 2));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(false);

  act(() => element.dispatchEvent(new Event('pointerleave')));
  act(() => vi.advanceTimersByTime(700));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(true);
});

test('a container that mounts late still gets wired up', () => {
  const { result } = renderHook(() => useAutoHideScrollbar());
  // First commit renders a spinner instead of the list, so the ref is null.
  act(() => result.current(null));

  const element = makeNode();
  act(() => result.current(element));

  expect(element.hasAttribute('data-scrollbar-idle')).toBe(true);
  act(() => element.dispatchEvent(new Event('scroll')));
  expect(element.hasAttribute('data-scrollbar-idle')).toBe(false);
});

test('mirrors the node into the caller own ref object', () => {
  const externalRef = { current: null } as RefObject<HTMLElement>;
  const { element } = setup(externalRef);

  expect(externalRef.current).toBe(element);
});

test('stops listening once the node goes away', () => {
  const { element, result } = setup();
  element.removeAttribute('data-scrollbar-idle');

  act(() => result.current(null));
  act(() => element.dispatchEvent(new Event('scroll')));
  act(() => vi.advanceTimersByTime(700));

  expect(element.hasAttribute('data-scrollbar-idle')).toBe(false);
});
