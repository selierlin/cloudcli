import { useCallback, useRef } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

/** Finger travel needed before the gesture commits to an axis, so a near-vertical scroll is never read as a sideways swipe. */
const AXIS_LOCK_SLOP_PX = 10;

/** Horizontal travel past the axis lock needed to fire the swipe. */
const SWIPE_TRIGGER_PX = 60;

type SwipeDirection = 'left' | 'right';

type SwipeGesture = {
  startX: number;
  startY: number;
  /** Locked on the first move past the slop; once vertical the gesture is abandoned for the rest of the touch. */
  axis: 'horizontal' | 'vertical' | null;
};

type SidebarSwipeGestureOptions = {
  /** The gesture is only armed while this is true. */
  enabled: boolean;
  /** Direction the finger must travel for `onSwipe` to fire. */
  direction: SwipeDirection;
  /** When set, the touch must begin within this many pixels of the viewport's left edge. */
  startZonePx?: number;
  onSwipe: () => void;
};

type SidebarSwipeGestureHandlers = {
  onTouchStart: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchMove: (event: ReactTouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
};

/** Used by ProjectWorkspaceShell to open the mobile drawer from the left edge and by ProjectSidebarRegion to swipe the drawer panel shut. */
export function useSidebarSwipeGesture({
  enabled,
  direction,
  startZonePx,
  onSwipe,
}: SidebarSwipeGestureOptions): SidebarSwipeGestureHandlers {
  // Origin and locked axis of the in-flight touch; null while no gesture is being tracked.
  const gestureRef = useRef<SwipeGesture | null>(null);

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      gestureRef.current = null;
      if (!enabled) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      if (startZonePx !== undefined && touch.clientX > startZonePx) {
        return;
      }
      gestureRef.current = { startX: touch.clientX, startY: touch.clientY, axis: null };
    },
    [enabled, startZonePx],
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const gesture = gestureRef.current;
      if (!enabled || !gesture) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;

      if (gesture.axis === null) {
        // Commit to one axis as soon as the finger has travelled far enough to tell them
        // apart; ties go to the vertical axis so an ambiguous start scrolls rather than swipes.
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_SLOP_PX) {
          return;
        }
        gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      // A vertical gesture stays abandoned for the rest of the touch, so scrolling the
      // sidebar's own list can never trip the swipe however far it drifts sideways.
      if (gesture.axis !== 'horizontal') {
        return;
      }

      const travel = direction === 'right' ? dx : -dx;
      if (travel <= SWIPE_TRIGGER_PX) {
        return;
      }
      gestureRef.current = null;
      onSwipe();
    },
    [direction, enabled, onSwipe],
  );

  const handleTouchEnd = useCallback(() => {
    gestureRef.current = null;
  }, []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
  };
}
