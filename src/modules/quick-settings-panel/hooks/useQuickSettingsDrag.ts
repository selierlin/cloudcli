import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { QuickSettingsHandleStyle } from '@/shared/types';

const HANDLE_POSITION_STORAGE_KEY = 'quickSettingsHandlePosition';

const DEFAULT_HANDLE_POSITION = 50;
const HANDLE_POSITION_MIN = 10;
const HANDLE_POSITION_MAX = 90;
const DRAG_THRESHOLD_PX = 5;

type UseQuickSettingsDragProps = {
  isMobile: boolean;
};

type PointerDragEvent = ReactPointerEvent<HTMLButtonElement>;

const clampPosition = (value: number): number => (
  Math.max(HANDLE_POSITION_MIN, Math.min(HANDLE_POSITION_MAX, value))
);

const readHandlePosition = (): number => {
  if (typeof window === 'undefined') {
    return DEFAULT_HANDLE_POSITION;
  }

  const saved = localStorage.getItem(HANDLE_POSITION_STORAGE_KEY);
  if (!saved) {
    return DEFAULT_HANDLE_POSITION;
  }

  try {
    const parsed = JSON.parse(saved) as { y?: unknown };
    if (typeof parsed.y === 'number' && Number.isFinite(parsed.y)) {
      return clampPosition(parsed.y);
    }
  } catch {
    localStorage.removeItem(HANDLE_POSITION_STORAGE_KEY);
    return DEFAULT_HANDLE_POSITION;
  }

  return DEFAULT_HANDLE_POSITION;
};

export function useQuickSettingsDrag({ isMobile }: UseQuickSettingsDragProps) {
  const [handlePosition, setHandlePosition] = useState<number>(readHandlePosition);
  const [isDragging, setIsDragging] = useState(false);

  const activePointerIdRef = useRef<number | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragStartPositionRef = useRef(DEFAULT_HANDLE_POSITION);
  const didDragRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const bodyStyleSnapshotRef = useRef<{ cursor: string; userSelect: string } | null>(null);

  const clearBodyDragStyles = useCallback(() => {
    const snapshot = bodyStyleSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    document.body.style.cursor = snapshot.cursor;
    document.body.style.userSelect = snapshot.userSelect;
    bodyStyleSnapshotRef.current = null;
  }, []);

  const applyBodyDragStyles = useCallback(() => {
    if (bodyStyleSnapshotRef.current) {
      return;
    }

    bodyStyleSnapshotRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, []);

  const endDrag = useCallback((event?: PointerDragEvent) => {
    const activePointerId = activePointerIdRef.current;
    if (activePointerId === null || (event && event.pointerId !== activePointerId)) {
      return;
    }

    activePointerIdRef.current = null;
    if (event?.currentTarget.hasPointerCapture(activePointerId)) {
      event.currentTarget.releasePointerCapture(activePointerId);
    }
    // A cancelled pointer gesture does not emit a click; do not swallow the
    // user's next intentional tap in that case.
    suppressNextClickRef.current = event?.type === 'pointerup' && didDragRef.current;
    didDragRef.current = false;
    dragStartYRef.current = null;
    setIsDragging(false);
    clearBodyDragStyles();
  }, [clearBodyDragStyles]);

  const startDrag = useCallback((event: PointerDragEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (activePointerIdRef.current !== null) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    dragStartYRef.current = event.clientY;
    dragStartPositionRef.current = handlePosition;
    didDragRef.current = false;
    setIsDragging(false);
  }, [handlePosition]);

  const handlePointerMove = useCallback((event: PointerDragEvent) => {
    if (event.pointerId !== activePointerIdRef.current || dragStartYRef.current === null) {
      return;
    }

    const rawDelta = event.clientY - dragStartYRef.current;
    if (!didDragRef.current && Math.abs(rawDelta) > DRAG_THRESHOLD_PX) {
      didDragRef.current = true;
      setIsDragging(true);
      applyBodyDragStyles();
    }

    if (!didDragRef.current) {
      return;
    }

    event.preventDefault();
    const viewportHeight = Math.max(window.innerHeight, 1);
    const normalizedDelta = (rawDelta / viewportHeight) * 100;
    const positionDelta = isMobile ? -normalizedDelta : normalizedDelta;
    setHandlePosition(clampPosition(dragStartPositionRef.current + positionDelta));
  }, [applyBodyDragStyles, isMobile]);

  // Persist drag-handle position so users keep their preferred quick-access location.
  useEffect(() => {
    localStorage.setItem(
      HANDLE_POSITION_STORAGE_KEY,
      JSON.stringify({ y: handlePosition }),
    );
  }, [handlePosition]);

  useEffect(() => (
    () => {
      clearBodyDragStyles();
    }
  ), [clearBodyDragStyles]);

  const consumeSuppressedClick = useCallback((): boolean => {
    if (!suppressNextClickRef.current) {
      return false;
    }

    suppressNextClickRef.current = false;
    return true;
  }, []);

  const handleStyle = useMemo<QuickSettingsHandleStyle>(() => {
    if (!isMobile || typeof window === 'undefined') {
      return {
        top: `${handlePosition}%`,
        transform: 'translateY(-50%)',
      };
    }

    return {
      bottom: `${(window.innerHeight * handlePosition) / 100}px`,
    };
  }, [handlePosition, isMobile]);

  return {
    isDragging,
    handleStyle,
    startDrag,
    handlePointerMove,
    endDrag,
    consumeSuppressedClick,
  };
}
