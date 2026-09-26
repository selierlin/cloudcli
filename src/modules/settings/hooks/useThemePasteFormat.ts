import { useCallback, useSyncExternalStore } from 'react';

import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import type { PastedThemeFormat } from '@/shared/userThemePastes';

/**
 * The settings page's paste format: the "advanced mode" switch (§5.5).
 *
 * The page offers two ways to write a theme — option A's token JSON, which can
 * only name whitelisted tokens and so cannot break the layout, and option B's raw
 * stylesheet, which can write any selector — and this is which one the paste box
 * currently writes. It is a preference rather than page state because §5.5 makes
 * the choice persistent: once a user settles on CSS they should not have to ask
 * for it again on every device.
 *
 * Reading is deliberately lenient in one direction only: anything that is not
 * `css` is read as `json`. The mirror is writable by other clients, and the safe
 * format is the right answer for a value this build does not recognise — the
 * opposite default would hand a corrupt preference the more dangerous of the two.
 *
 * What it does *not* do is re-read themes already stored. Each entry records the
 * format it was pasted in (`PastedUserTheme.format`), so switching modes changes
 * what the next paste is compiled as and nothing else.
 */

/** Option A's format, and what an unrecognised stored value falls back to. */
const SAFE_FORMAT: PastedThemeFormat = 'json';

function readStoredFormat(): PastedThemeFormat {
  return readUserPreference<PastedThemeFormat>('themePasteFormat', SAFE_FORMAT) === 'css'
    ? 'css'
    : SAFE_FORMAT;
}

/** Used by `UserThemesSection` to show and change the format the paste box writes. */
export function useThemePasteFormat(): [PastedThemeFormat, (format: PastedThemeFormat) => void] {
  const format = useSyncExternalStore(subscribeToUserPreferences, readStoredFormat);

  const setFormat = useCallback((next: PastedThemeFormat) => {
    writeUserPreference('themePasteFormat', next);
  }, []);

  return [format, setFormat];
}
