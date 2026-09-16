import { useEffect } from 'react';
import { Keyboard } from '@capacitor/keyboard';

const isCapacitorShell = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.(),
  );
};

/**
 * How long a rising keyboard-height reading must survive before it is
 * committed to `--keyboard-height`.
 *
 * iOS reconciles `window.innerHeight` and `visualViewport.height`
 * asynchronously around keyboard dismissal, and a later layout change (a
 * session switch swapping the transcript, for instance) can trigger that
 * deferred reconciliation: for a frame or two the pair reads as if the
 * keyboard had returned, then the next resize corrects it. Committing those
 * readings instantly used to be a one-frame flicker; now that the workspace
 * shell animates its bottom edge, each blip would play a full keyboard
 * open-and-close animation. Falling readings commit immediately so the UI
 * never lags the keyboard's own descent.
 */
const KEYBOARD_RISE_STABILIZATION_MS = 100;

/**
 * Keeps the fixed workspace shell above the virtual keyboard.
 * - In the Capacitor native shell, the @capacitor/keyboard plugin fires
 *   keyboardWillShow/Hide synchronously with the exact height, so we drive
 *   `--keyboard-height` from those.
 * - In a plain browser / PWA we use the Visual Viewport API instead.
 */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const setKeyboardHeight = (px: number) => {
      document.documentElement.style.setProperty('--keyboard-height', `${px}px`);
    };

    if (isCapacitorShell()) {
      let disposed = false;
      const handles: Array<{ remove: () => Promise<void> }> = [];
      const onShow = (info: { keyboardHeight: number }) => setKeyboardHeight(info.keyboardHeight);
      const onHide = () => {
        // WKWebView keeps DOM focus on the dismissed input, and the next tap
        // anywhere then re-presents the keyboard for that still-focused
        // element before the tap's own focus change collapses it again — a
        // visible keyboard flash (tapping a sidebar session right after
        // dismissing the keyboard, for example). Blurring whatever editable
        // still holds focus keeps keyboard visibility and DOM focus
        // consistent, so no later tap can resurrect the keyboard.
        const active = document.activeElement as HTMLElement | null;
        if (
          active
          && (active.tagName === 'INPUT'
            || active.tagName === 'TEXTAREA'
            || active.isContentEditable)
        ) {
          active.blur();
        }
        setKeyboardHeight(0);
      };

      void Keyboard.addListener('keyboardWillShow', onShow).then((handle) => {
        if (disposed) void handle.remove(); else handles.push(handle);
      });
      void Keyboard.addListener('keyboardWillHide', onHide).then((handle) => {
        if (disposed) void handle.remove(); else handles.push(handle);
      });

      return () => {
        disposed = true;
        handles.forEach((handle) => void handle.remove());
        setKeyboardHeight(0);
      };
    }

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    let committedHeight = 0;
    let pendingRiseTimer: ReturnType<typeof setTimeout> | null = null;

    const commitHeight = (px: number) => {
      committedHeight = px;
      setKeyboardHeight(px);
    };

    const updateKeyboardHeight = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const keyboardHeight = Math.max(0, window.innerHeight - visualViewport.height);
      if (pendingRiseTimer !== null) {
        clearTimeout(pendingRiseTimer);
        pendingRiseTimer = null;
      }
      if (keyboardHeight <= committedHeight) {
        commitHeight(keyboardHeight);
        return;
      }
      // Rising: commit only if the reading survives the stabilization window,
      // and commit the geometry as it reads when the timer fires — a blip
      // cancels itself via its correcting resize, and a real keyboard keeps
      // its final value.
      pendingRiseTimer = setTimeout(() => {
        pendingRiseTimer = null;
        commitHeight(Math.max(0, window.innerHeight - visualViewport.height));
      }, KEYBOARD_RISE_STABILIZATION_MS);
    };

    visualViewport.addEventListener('resize', updateKeyboardHeight);
    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardHeight);
      if (pendingRiseTimer !== null) {
        clearTimeout(pendingRiseTimer);
      }
    };
  }, []);
}
