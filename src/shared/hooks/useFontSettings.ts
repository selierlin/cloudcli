import { useEffect } from 'react';

import {
  CODE_FONT_FAMILY_CSS,
  FONT_FAMILY_CSS,
  FONT_SETTINGS_CHANGED_EVENT,
} from '@/shared/utils';
import { readFontSettings } from '@/shared/fontSettings';
import { USER_PREFERENCES_CHANGED_EVENT } from '@/shared/userSettings';

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

    const handlePreferencesChanged = () => {
      apply();
      window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
    };

    apply();
    window.addEventListener(FONT_SETTINGS_CHANGED_EVENT, apply);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    return () => {
      window.removeEventListener(FONT_SETTINGS_CHANGED_EVENT, apply);
      window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    };
  }, []);
}
