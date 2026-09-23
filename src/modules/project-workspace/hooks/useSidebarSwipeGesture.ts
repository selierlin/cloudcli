import { useCallback, useRef } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';

/** Horizontal travel needed to fire the swipe, measured from the gesture's current anchor. */
const SWIPE_TRIGGER_PX = 60;

/**
 * How far vertical travel must outrun horizontal before the touch is read as a scroll.
 * The margin keeps a slight sideways wobble mid-scroll from counting toward the swipe.
 */
const SCROLL_HYSTERESIS_PX = 10;

type SwipeDirection = 'left' | 'right';

type SwipeGesture = {
  /**
   * The point travel is measured from. While the touch is scrolling it trails the
   * finger, so a sideways turn after a scroll is measured from where the scroll
   * left off rather than from the original touch-down point.
   */
  anchorX: number;
  anchorY: number;
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
  // Anchor of the in-flight touch; null while no gesture is being tracked.
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
      gestureRef.current = { anchorX: touch.clientX, anchorY: touch.clientY };
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

      const dx = touch.clientX - gesture.anchorX;
      const dy = touch.clientY - gesture.anchorY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx <= absDy) {
        // A touch that leans vertical is scrolling, so it never accumulates toward the
        // swipe — the anchor trails the finger instead. Ties stay vertical so an
        // ambiguous drag scrolls rather than swipes, and a later sideways turn is
        // measured from where the scroll left off rather than being disqualified for
        // the rest of the touch by the opening move.
        if (absDy > absDx + SCROLL_HYSTERESIS_PX) {
          gesture.anchorX = touch.clientX;
          gesture.anchorY = touch.clientY;
        }
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
