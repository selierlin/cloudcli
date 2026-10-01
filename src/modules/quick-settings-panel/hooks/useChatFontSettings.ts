import { useEffect, useState } from 'react';

import { FONT_SETTINGS_CHANGED_EVENT } from '@/shared/utils';
import { readFontSettings, writeFontSettings } from '@/shared/fontSettings';
import { USER_PREFERENCES_CHANGED_EVENT } from '@/shared/userSettings';
import type { CodeFontFamilyId, FontFamilyId, FontSettingsState, TerminalFontFamilyId } from '@/shared/types';

/**
 * Lightweight facade over the shared font-settings localStorage cache.
 *
 * Reads initial values via `readFontSettings`, persists changes via
 * `writeFontSettings`, and stays in sync with other surfaces (e.g. the
 * Settings dialog) through the existing `fontSettingsChanged` event. The
 * global `useFontSettings` hook (mounted in AppContent) listens to the same
 * event and applies the CSS variables that actually render the new size/family.
 */
export function useChatFontSettings() {
  const [state, setState] = useState<FontSettingsState>(() => readFontSettings());

  useEffect(() => {
    const sync = () => setState(readFontSettings());
    window.addEventListener(FONT_SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(FONT_SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, sync);
    };
  }, []);

  const setUiFontSize = (value: string) => {
    const next: FontSettingsState = { ...state, uiFontSize: value };
    setState(next);
    writeFontSettings(next);
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  };

  const setTerminalFontSize = (value: string) => {
    const next: FontSettingsState = { ...state, terminalFontSize: value };
    setState(next);
    writeFontSettings(next);
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  };

  const setFontFamily = (value: FontFamilyId) => {
    const next: FontSettingsState = { ...state, fontFamily: value };
    setState(next);
    writeFontSettings(next);
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  };

  const setCodeFontSize = (value: string) => {
    const next: FontSettingsState = { ...state, codeFontSize: value };
    setState(next);
    writeFontSettings(next);
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  };

  const setCodeFontFamily = (value: CodeFontFamilyId) => {
    const next: FontSettingsState = { ...state, codeFontFamily: value };
    setState(next);
    writeFontSettings(next);
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  };

  const setTerminalFontFamily = (value: TerminalFontFamilyId) => {
    const next: FontSettingsState = { ...state, terminalFontFamily: value };
    setState(next);
    writeFontSettings(next);
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  };

  return {
    uiFontSize: state.uiFontSize,
    terminalFontSize: state.terminalFontSize,
    fontFamily: state.fontFamily,
    codeFontSize: state.codeFontSize,
    codeFontFamily: state.codeFontFamily,
    terminalFontFamily: state.terminalFontFamily,
    setUiFontSize,
    setTerminalFontSize,
    setFontFamily,
    setCodeFontSize,
    setCodeFontFamily,
    setTerminalFontFamily,
  };
}
