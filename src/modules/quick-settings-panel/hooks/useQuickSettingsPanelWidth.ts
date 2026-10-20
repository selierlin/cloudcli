import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

const WIDTH_STORAGE_KEY = 'quickSettingsPanelWidth';

/** The overlay's former `w-80`, now shared with the docked column so pinning keeps the footprint. */
export const QUICK_SETTINGS_PANEL_WIDTH_DEFAULT = 320;
export const QUICK_SETTINGS_PANEL_WIDTH_MIN = 240;
export const QUICK_SETTINGS_PANEL_WIDTH_MAX = 560;
/** The docked column takes its width out of the chat area, so its ceiling also follows the viewport. */
export const QUICK_SETTINGS_PANEL_WIDTH_MAX_VIEWPORT_RATIO = 0.5;
export const QUICK_SETTINGS_PANEL_WIDTH_KEYBOARD_STEP = 16;

/** Half the window, capped: the panel may never crowd the conversation off its own screen. */
export const resolveQuickSettingsPanelWidthMax = (viewportWidth: number): number => (
  Math.max(
    QUICK_SETTINGS_PANEL_WIDTH_MIN,
    Math.min(
      QUICK_SETTINGS_PANEL_WIDTH_MAX,
      Math.round(viewportWidth * QUICK_SETTINGS_PANEL_WIDTH_MAX_VIEWPORT_RATIO),
    ),
  )
);

/** Rounds to whole pixels and clamps to the range the viewport allows; the minimum wins so the range never collapses. */
export const clampQuickSettingsPanelWidth = (value: number, viewportWidth: number): number => (
  Math.max(
    QUICK_SETTINGS_PANEL_WIDTH_MIN,
    Math.min(resolveQuickSettingsPanelWidthMax(viewportWidth), Math.round(value)),
  )
);

/** A stored width that is missing, unparseable or out of range falls back to the default, itself clamped. */
export const parseQuickSettingsPanelWidth = (raw: unknown, viewportWidth: number): number => {
  // Number(), not parseInt(): the latter takes a numeric prefix, so '320px' would pass.
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(value)
    ? clampQuickSettingsPanelWidth(value, viewportWidth)
    : clampQuickSettingsPanelWidth(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT, viewportWidth);
};

/** Without a real viewport (SSR, unlaid-out documents) the cap stays at its absolute maximum. */
const readViewportWidth = (): number => (
  typeof window === 'undefined' || !window.innerWidth
    ? QUICK_SETTINGS_PANEL_WIDTH_MAX / QUICK_SETTINGS_PANEL_WIDTH_MAX_VIEWPORT_RATIO
    : window.innerWidth
);

const readStoredWidth = (): number => {
  try {
    return parseQuickSettingsPanelWidth(
      window.localStorage.getItem(WIDTH_STORAGE_KEY),
      readViewportWidth(),
    );
  } catch {
    return clampQuickSettingsPanelWidth(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT, readViewportWidth());
  }
};

const writeStoredWidth = (width: number) => {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Storage unavailable (private mode, quota) — the width just stops persisting.
  }
};

type UseQuickSettingsPanelWidthOptions = {
  /** False on mobile, where the docked column never renders and the overlay keeps its fixed width. */
  resizable: boolean;
};

/**
 * Width of the quick settings panel, shared by the docked column and the desktop
 * overlay, dragged from the column's left edge and persisted across reloads.
 *
 * Kept out of `useUiPreferences` on purpose: that store is boolean-only and
 * synced, while a panel width is a per-device layout choice — same reasoning as
 * `useSidebarWidth`.
 */
export function useQuickSettingsPanelWidth({ resizable }: UseQuickSettingsPanelWidthOptions) {
  // The panel width in CSS pixels: the drag rewrites it on every animation
  // frame, so it has to be state; `localStorage` only receives the final value.
  const [width, setWidth] = useState<number>(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);

  // Drag origin; null while no resize is in progress. The refs keep pointer
  // moves from re-rendering the panel just to remember where the drag started.
  const resizeOriginRef = useRef<{ pointerX: number; width: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number>(width);

  // Read after mount so server-side rendering and hydration see the same value.
  useEffect(() => {
    if (!resizable) return;
    setWidth(readStoredWidth());
  }, [resizable]);

  const commitWidth = useCallback((value: number) => {
    const next = clampQuickSettingsPanelWidth(value, readViewportWidth());
    setWidth(next);
    writeStoredWidth(next);
  }, []);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizable) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeOriginRef.current = { pointerX: event.clientX, width };
    pendingWidthRef.current = width;
    document.body.style.userSelect = 'none';
  }, [resizable, width]);

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = resizeOriginRef.current;
    if (!origin) return;

    // The column is flush right, so dragging its left edge leftwards widens it.
    pendingWidthRef.current = clampQuickSettingsPanelWidth(
      origin.width + (origin.pointerX - event.clientX),
      readViewportWidth(),
    );
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      setWidth(pendingWidthRef.current);
    });
  }, []);

  const handleResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeOriginRef.current) return;
    resizeOriginRef.current = null;

    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.userSelect = '';
    // One write per drag, not one per frame.
    commitWidth(pendingWidthRef.current);
  }, [commitWidth]);

  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!resizable) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      commitWidth(width + QUICK_SETTINGS_PANEL_WIDTH_KEYBOARD_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      commitWidth(width - QUICK_SETTINGS_PANEL_WIDTH_KEYBOARD_STEP);
    } else if (event.key === 'Home') {
      event.preventDefault();
      commitWidth(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
    }
  }, [commitWidth, resizable, width]);

  const handleResizeReset = useCallback(() => {
    if (!resizable) return;
    commitWidth(QUICK_SETTINGS_PANEL_WIDTH_DEFAULT);
  }, [commitWidth, resizable]);

  // Unpinning or crossing into mobile mid-drag unmounts the separator, so the
  // pointerup that would have ended the drag never arrives: drop the live origin
  // and let go of the body or a plain hover would resize the panel later.
  useEffect(() => {
    if (resizable) return;
    resizeOriginRef.current = null;
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    document.body.style.userSelect = '';
  }, [resizable]);

  // A drag interrupted by an unmount must not leave the page unselectable.
  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
    document.body.style.userSelect = '';
  }, []);

  return {
    width,
    minWidth: QUICK_SETTINGS_PANEL_WIDTH_MIN,
    maxWidth: resolveQuickSettingsPanelWidthMax(readViewportWidth()),
    separatorProps: {
      onPointerDown: handleResizeStart,
      onPointerMove: handleResizeMove,
      onPointerUp: handleResizeEnd,
      onPointerCancel: handleResizeEnd,
      onDoubleClick: handleResizeReset,
      onKeyDown: handleResizeKeyDown,
    },
  };
}
