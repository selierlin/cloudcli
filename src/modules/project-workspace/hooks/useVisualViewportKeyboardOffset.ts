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
      const onHide = () => setKeyboardHeight(0);

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

    const updateKeyboardHeight = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const keyboardHeight = Math.max(0, window.innerHeight - visualViewport.height);
      setKeyboardHeight(keyboardHeight);
    };

    visualViewport.addEventListener('resize', updateKeyboardHeight);
    return () => visualViewport.removeEventListener('resize', updateKeyboardHeight);
  }, []);
}
