import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Keyboard } from '@capacitor/keyboard';

import { useVisualViewportKeyboardOffset } from '@/modules/project-workspace/hooks/useVisualViewportKeyboardOffset';

/**
 * In the browser/PWA path this hook derives `--keyboard-height` from
 * `window.innerHeight - visualViewport.height`. iOS reconciles the two
 * asynchronously around keyboard dismissal, so transient mismatches can read
 * as the keyboard returning for a frame or two; rising readings are only
 * committed once they survive a stabilization window, while falling readings
 * commit immediately so the UI never lags the keyboard's descent.
 *
 * In the Capacitor path the height comes from the exact keyboardWillShow/Hide
 * plugin events, and keyboardWillHide additionally blurs the editable that
 * still holds focus: WKWebView otherwise retains it, and a later tap would
 * re-present the keyboard for it before collapsing it again.
 */

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn(async () => ({ remove: async () => undefined })),
  },
}));

const VIEWPORT_HEIGHT = 800;

let visualViewportHeight = VIEWPORT_HEIGHT;
const resizeListeners = new Set<() => void>();

const visualViewportStub = {
  get height() {
    return visualViewportHeight;
  },
  addEventListener: (_type: string, listener: () => void) => {
    resizeListeners.add(listener);
  },
  removeEventListener: (_type: string, listener: () => void) => {
    resizeListeners.delete(listener);
  },
};

/** Simulates a visualViewport resize event for the given keyboard height. */
const fireResize = (keyboardHeight: number) => {
  visualViewportHeight = VIEWPORT_HEIGHT - keyboardHeight;
  resizeListeners.forEach((listener) => listener());
};

const keyboardVar = () =>
  document.documentElement.style.getPropertyValue('--keyboard-height');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  visualViewportHeight = VIEWPORT_HEIGHT;
  resizeListeners.clear();
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: VIEWPORT_HEIGHT,
  });
  vi.stubGlobal('visualViewport', visualViewportStub);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--keyboard-height');
});

describe('useVisualViewportKeyboardOffset (browser path)', () => {
  it('commits a rising reading only after the stabilization window', () => {
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    act(() => {
      fireResize(400);
    });
    expect(keyboardVar()).toBe('');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(keyboardVar()).toBe('400px');
  });

  it('commits a falling reading immediately', () => {
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    act(() => {
      fireResize(400);
      vi.advanceTimersByTime(100);
    });
    expect(keyboardVar()).toBe('400px');

    act(() => {
      fireResize(0);
    });
    expect(keyboardVar()).toBe('0px');
  });

  it('never commits a transient rise that its correcting resize cancels', () => {
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    act(() => {
      // The deferred innerHeight/visualViewport reconciliation blip: a full
      // keyboard reading, corrected one resize later.
      fireResize(360);
      fireResize(0);
      vi.advanceTimersByTime(500);
    });
    // The blip's 360px reading is never committed; the state ends at the
    // corrected 0px.
    expect(keyboardVar()).toBe('0px');
  });

  it('commits the geometry as it reads when the timer fires', () => {
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    act(() => {
      fireResize(300);
      // The keyboard keeps rising after the first resize report.
      fireResize(420);
      vi.advanceTimersByTime(100);
    });
    expect(keyboardVar()).toBe('420px');
  });

  it('discards a pending rise on unmount', () => {
    let unmount: () => void = () => undefined;
    act(() => {
      ({ unmount } = renderHook(() => useVisualViewportKeyboardOffset()));
    });

    act(() => {
      fireResize(400);
      unmount();
      vi.advanceTimersByTime(500);
    });
    expect(keyboardVar()).toBe('');
  });
});

describe('useVisualViewportKeyboardOffset (capacitor path)', () => {
  const nativeHandlerNames = (eventName: string) =>
    (Keyboard.addListener as unknown as Mock).mock.calls
      .filter(([name]) => name === eventName)
      .map(([, handler]) => handler as (info?: unknown) => void);

  it('drives --keyboard-height from the exact native show/hide events', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    await act(async () => {
      nativeHandlerNames('keyboardWillShow').forEach((handler) => handler({ keyboardHeight: 336 }));
    });
    expect(keyboardVar()).toBe('336px');

    await act(async () => {
      nativeHandlerNames('keyboardWillHide').forEach((handler) => handler());
    });
    expect(keyboardVar()).toBe('0px');
  });

  it('blurs the editable that still holds focus when the keyboard hides', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);

    await act(async () => {
      nativeHandlerNames('keyboardWillHide').forEach((handler) => handler());
    });

    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it('does not blur when focus is not on an editable element', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    act(() => {
      renderHook(() => useVisualViewportKeyboardOffset());
    });

    const button = document.createElement('button');
    document.body.appendChild(button);
    act(() => {
      button.focus();
    });
    expect(document.activeElement).toBe(button);

    await act(async () => {
      nativeHandlerNames('keyboardWillHide').forEach((handler) => handler());
    });

    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
