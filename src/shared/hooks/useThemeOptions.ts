import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { BUILTIN_THEMES } from '@/shared/constants';
import { useTheme } from '@/shared/context/ThemeContext';
import { refreshUserThemes } from '@/shared/userThemes';

type ThemeOption = {
  /** The overlay id to write, or null for the appearance default. */
  id: string | null;
  /**
   * The name shown for the option. A theme carries its own, which is why it is
   * read off the manifest rather than translated: a user theme brings its name
   * with it the same way.
   */
  label: string;
  /**
   * The Latin-script name shown as the option's second line when the registry
   * carries one. A user theme's file declares a single name, so its options
   * show no second line — which is why this is optional.
   */
  nameEn?: string;
  /** How far the theme reaches, shown as a badge; absent themes claim nothing. */
  coverage?: 'accent' | 'full';
};

type UseThemeOptionsResult = {
  options: ThemeOption[];
  selectedId: string | null;
  setThemeId: (id: string | null) => void;
};

/**
 * The overlay-theme options shared by the settings page's ThemeSelector and the
 * quick-settings panel's compact row: the appearance defaults are the base
 * palette itself and are switched with the light/dark capsule, so they are
 * deliberately absent from the listing.
 */
export function useThemeOptions(): UseThemeOptionsResult {
  const { t } = useTranslation('settings');
  const { themeId, setThemeId, userThemes } = useTheme();

  // The listing is read here as well as on start-up: the start-up attempt can
  // land before the client has a session, and every screen that lists themes
  // has to show what the host's themes folder holds.
  useEffect(() => {
    void refreshUserThemes();
  }, []);

  const options: ThemeOption[] = [
    { id: null, label: t('themeSelector.default') },
    ...BUILTIN_THEMES.filter((theme) => theme.appearance === 'system').map((theme) => ({
      id: theme.id,
      label: theme.name,
      nameEn: theme.nameEn,
      coverage: theme.coverage,
    })),
    // A file-derived theme carries the reach its file declared, and no badge
    // when it declared none (§5.8 v4) — the file is the only thing that can say.
    // A folder `index.json` may localize the name, which becomes the second
    // line here exactly as a builtin's `nameEn` does.
    ...userThemes.map((theme) => ({
      id: theme.id,
      label: theme.name,
      nameEn: theme.nameEn,
      coverage: theme.coverage,
    })),
  ];

  // The option to mark as chosen. A default-alias id (`cc-light` / `cc-dark`) is
  // reachable through `setThemeId` but carries no overlay of its own, and a user
  // theme whose file is still being fetched is not in force yet either, so in
  // both cases no option of its own is marked rather than every option being
  // left unselected.
  const selectedId = options.some((option) => option.id === themeId) ? themeId : null;

  return { options, selectedId, setThemeId };
}
