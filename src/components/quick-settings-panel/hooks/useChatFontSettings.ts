import { useEffect, useState } from 'react';

import {
  readFontSettings,
  writeFontSettings,
} from '../../settings/constants/constants';
import type { CodeFontFamilyId, FontFamilyId, FontSettingsState } from '../../settings/types/types';

const FONT_SETTINGS_CHANGED_EVENT = 'fontSettingsChanged';

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
    return () => window.removeEventListener(FONT_SETTINGS_CHANGED_EVENT, sync);
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

  return {
    uiFontSize: state.uiFontSize,
    terminalFontSize: state.terminalFontSize,
    fontFamily: state.fontFamily,
    codeFontSize: state.codeFontSize,
    codeFontFamily: state.codeFontFamily,
    setUiFontSize,
    setTerminalFontSize,
    setFontFamily,
    setCodeFontSize,
    setCodeFontFamily,
  };
}
