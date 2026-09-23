import { act, renderHook } from '@testing-library/react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSidebarSwipeGesture } from '@/modules/project-workspace/hooks/useSidebarSwipeGesture';

type SwipeGestureOptions = Parameters<typeof useSidebarSwipeGesture>[0];
type SwipeGestureHandlers = ReturnType<typeof useSidebarSwipeGesture>;

/** Minimal touch event carrying a single finger, which is all the gesture's displacement math reads. */
function touchAt(x: number, y: number): ReactTouchEvent<HTMLElement> {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as ReactTouchEvent<HTMLElement>;
}

function renderSwipeGesture(overrides: Partial<SwipeGestureOptions> = {}) {
  const onSwipe = vi.fn();
  const { result } = renderHook(
    (props: SwipeGestureOptions) => useSidebarSwipeGesture(props),
    {
      initialProps: {
        enabled: true,
        direction: 'right',
        onSwipe,
        ...overrides,
      } satisfies SwipeGestureOptions,
    },
  );
  return { onSwipe, handlers: () => result.current };
}

/** Feeds one touch through start/move/end, replaying each point in order. */
function drag(handlers: SwipeGestureHandlers, points: Array<[number, number]>) {
  const [start, ...rest] = points;
  act(() => {
    handlers.onTouchStart(touchAt(start[0], start[1]));
    rest.forEach(([x, y]) => handlers.onTouchMove(touchAt(x, y)));
    handlers.onTouchEnd();
  });
}

describe('useSidebarSwipeGesture', () => {
  it('fires on a rightward drag past the threshold', () => {
    const { handlers, onSwipe } = renderSwipeGesture();

    drag(handlers(), [[10, 100], [100, 110]]);

    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('never fires before the horizontal travel passes the threshold', () => {
    const { handlers, onSwipe } = renderSwipeGesture();

    drag(handlers(), [[10, 100], [50, 105], [65, 108]]);

    expect(onSwipe).not.toHaveBeenCalled();

    drag(handlers(), [[10, 100], [50, 105], [110, 108]]);

    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('ignores a drag headed away from the configured direction', () => {
    const rightward = renderSwipeGesture();
    drag(rightward.handlers(), [[200, 100], [80, 110]]);
    expect(rightward.onSwipe).not.toHaveBeenCalled();

    const leftward = renderSwipeGesture({ direction: 'left' });
    drag(leftward.handlers(), [[80, 100], [200, 110]]);
    expect(leftward.onSwipe).not.toHaveBeenCalled();
  });

  it('fires on a leftward drag when the direction is left', () => {
    const { handlers, onSwipe } = renderSwipeGesture({ direction: 'left' });

    drag(handlers(), [[300, 200], [190, 210]]);

    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('abandons a gesture that began vertically even if the finger later drifts far sideways', () => {
    const { handlers, onSwipe } = renderSwipeGesture();

    // The opening move is dominated by vertical travel, so this is a scroll that
    // happens to end 70px to the right — not a swipe.
    drag(handlers(), [[10, 100], [15, 140], [80, 130]]);

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('keeps scrolling and swiping independent across consecutive touches', () => {
    const { handlers, onSwipe } = renderSwipeGesture();

    drag(handlers(), [[10, 100], [12, 260]]);
    expect(onSwipe).not.toHaveBeenCalled();

    drag(handlers(), [[10, 100], [120, 105]]);

    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it('never arms when the touch starts outside the start zone', () => {
    const { handlers, onSwipe } = renderSwipeGesture({ startZonePx: 32 });

    drag(handlers(), [[100, 100], [260, 110]]);

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('stays inert while disabled and after a cancelled touch', () => {
    const disabled = renderSwipeGesture({ enabled: false });
    drag(disabled.handlers(), [[10, 100], [200, 110]]);
    expect(disabled.onSwipe).not.toHaveBeenCalled();

    const { handlers, onSwipe } = renderSwipeGesture();
    act(() => {
      handlers().onTouchStart(touchAt(10, 100));
      handlers().onTouchCancel();
      handlers().onTouchMove(touchAt(200, 110));
    });

    expect(onSwipe).not.toHaveBeenCalled();
  });
});
