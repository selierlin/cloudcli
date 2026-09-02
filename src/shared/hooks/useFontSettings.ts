import { useEffect } from 'react';

import {
  CODE_FONT_FAMILY_CSS,
  FONT_FAMILY_CSS,
  FONT_SETTINGS_CHANGED_EVENT,
  readFontSettings,
} from '@/shared/utils';

/** Applies the local chat font choices to CSS variables used by transcript rendering. */
export function useFontSettings(): void {
  useEffect(() => {
    const apply = () => {
      const { uiFontSize, fontFamily, codeFontSize, codeFontFamily } = readFontSettings();
      const root = document.documentElement;
      root.style.setProperty('--ui-font-size', `${uiFontSize}px`);
      root.style.setProperty('--ui-font-family', FONT_FAMILY_CSS[fontFamily]);
      root.style.setProperty('--ui-code-font-size', `${codeFontSize}px`);
      root.style.setProperty('--ui-code-font-family', CODE_FONT_FAMILY_CSS[codeFontFamily]);
    };

    apply();
    window.addEventListener(FONT_SETTINGS_CHANGED_EVENT, apply);
    return () => window.removeEventListener(FONT_SETTINGS_CHANGED_EVENT, apply);
  }, []);
}
