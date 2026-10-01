import type { FontFamilyId, FontSettingsState, CodeFontFamilyId, TerminalFontFamilyId } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';
import {
  CODE_FONT_FAMILY_OPTIONS,
  FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_FAMILY_OPTIONS,
} from '@/shared/utils';

const DEFAULT_FONT_SETTINGS: FontSettingsState = {
  uiFontSize: '14',
  terminalFontSize: '14',
  fontFamily: 'serif',
  codeFontSize: '13',
  codeFontFamily: 'system',
  terminalFontFamily: 'theme',
};

/** Reads synchronized font choices, falling back to pre-migration local values. */
export function readFontSettings(): FontSettingsState {
  const stored = readUserPreference<Partial<FontSettingsState>>('fontSettings', {});
  const get = (key: keyof FontSettingsState) => (
    typeof stored[key] === 'string' ? stored[key] as string : localStorage.getItem(`fontSettings.${key}`)
  );
  const fontFamily = get('fontFamily');
  const codeFontFamily = get('codeFontFamily');
  const terminalFontFamily = get('terminalFontFamily');

  return {
    uiFontSize: get('uiFontSize') ?? DEFAULT_FONT_SETTINGS.uiFontSize,
    terminalFontSize: get('terminalFontSize') ?? DEFAULT_FONT_SETTINGS.terminalFontSize,
    fontFamily: FONT_FAMILY_OPTIONS.some(({ id }) => id === fontFamily) ? fontFamily as FontFamilyId : DEFAULT_FONT_SETTINGS.fontFamily,
    codeFontSize: get('codeFontSize') ?? DEFAULT_FONT_SETTINGS.codeFontSize,
    codeFontFamily: CODE_FONT_FAMILY_OPTIONS.some(({ id }) => id === codeFontFamily) ? codeFontFamily as CodeFontFamilyId : DEFAULT_FONT_SETTINGS.codeFontFamily,
    terminalFontFamily: TERMINAL_FONT_FAMILY_OPTIONS.some(({ id }) => id === terminalFontFamily) ? terminalFontFamily as TerminalFontFamilyId : DEFAULT_FONT_SETTINGS.terminalFontFamily,
  };
}

/** Persists font choices in the server-backed user preference store. */
export function writeFontSettings(settings: FontSettingsState): void {
  writeUserPreference('fontSettings', settings);
}
