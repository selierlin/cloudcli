import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  QUICK_SETTINGS_PANEL_WIDTH_MAX,
  useQuickSettingsPanelWidth,
} from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelWidth';

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};

// The hook throttles viewport updates to one per frame, so frames are captured
// and flushed by hand instead of waiting on a real animation frame.
let frames: FrameRequestCallback[] = [];

const flushFrames = () => {
  act(() => {
    frames.splice(0).forEach((frame) => frame(0));
  });
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it('renders the widest panel the window allows, keeping the stored preference', () => {
  setViewportWidth(1440);
  window.localStorage.setItem('quickSettingsPanelWidth', String(QUICK_SETTINGS_PANEL_WIDTH_MAX));

  const { result } = renderHook(() => useQuickSettingsPanelWidth({ resizable: true }));
  expect(result.current.width).toBe(QUICK_SETTINGS_PANEL_WIDTH_MAX);
  expect(result.current.maxWidth).toBe(QUICK_SETTINGS_PANEL_WIDTH_MAX);

  // Half of a 900px window is 450: the panel narrows...
  setViewportWidth(900);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  flushFrames();
  expect(result.current.width).toBe(450);
  expect(result.current.maxWidth).toBe(450);
  // ...without rewriting what was dragged on the wider window.
  expect(window.localStorage.getItem('quickSettingsPanelWidth')).toBe(String(QUICK_SETTINGS_PANEL_WIDTH_MAX));

  // Widening the window brings the dragged width back, no reload needed.
  setViewportWidth(1440);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  flushFrames();
  expect(result.current.width).toBe(QUICK_SETTINGS_PANEL_WIDTH_MAX);
});
