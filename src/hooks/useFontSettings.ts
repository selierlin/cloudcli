import { useEffect } from 'react';

import {
  CODE_FONT_FAMILY_CSS,
  FONT_FAMILY_CSS,
  readFontSettings,
} from '../components/settings/constants/constants';

/**
 * Applies the user's font settings as CSS variables on :root so the chat UI
 * can pick them up via var(--ui-font-size) / var(--ui-font-family), and code
 * via var(--ui-code-font-size) / var(--ui-code-font-family). Re-applies
 * whenever the settings controller dispatches a fontSettingsChanged event.
 */
export function useFontSettings(): void {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const apply = () => {
      const { uiFontSize, fontFamily, codeFontSize, codeFontFamily } = readFontSettings();
      const root = document.documentElement;
      root.style.setProperty('--ui-font-size', `${uiFontSize}px`);
      root.style.setProperty('--ui-font-family', FONT_FAMILY_CSS[fontFamily]);
      root.style.setProperty('--ui-code-font-size', `${codeFontSize}px`);
      root.style.setProperty('--ui-code-font-family', CODE_FONT_FAMILY_CSS[codeFontFamily]);
    };

    apply();
    window.addEventListener('fontSettingsChanged', apply);
    return () => window.removeEventListener('fontSettingsChanged', apply);
  }, []);
}
