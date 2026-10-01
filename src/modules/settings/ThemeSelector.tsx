import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { BUILTIN_THEMES } from '@/shared/constants';
import { useTheme } from '@/shared/context/ThemeContext';
import { refreshUserThemes } from '@/shared/userThemes';
import { cn } from '@/shared/utils';

/**
 * The themes this selector offers apart from the ones from the server: the
 * appearance defaults are the base palette itself and are switched with the
 * light/dark/system capsule, so they are deliberately absent here.
 */
const BUILTIN_OVERLAY_THEMES = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

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

type ThemeSelectorProps = {
  ariaLabel?: string;
};

/** Used by the settings module to pick the overlay theme painted under the current appearance. */
function ThemeSelector({ ariaLabel }: ThemeSelectorProps) {
  const { t } = useTranslation('settings');
  const { themeId, setThemeId, userThemes, themeFallback } = useTheme();

  // The listing is read here as well as on start-up: the start-up attempt can
  // land before the client has a session, and this screen is the one that has
  // to show what the host's themes folder holds.
  useEffect(() => {
    void refreshUserThemes();
  }, []);

  const options: ThemeOption[] = [
    { id: null, label: t('themeSelector.default') },
    ...BUILTIN_OVERLAY_THEMES.map((theme) => ({
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

  return (
    // The list is the row's content rather than a side control, so it owns the
    // full row width on every layout: two compact columns on a phone, three
    // from `sm:` up. The registry keeps growing, and the single narrow column
    // it used to reserve is what made the list read as an endless stripe.
    <div className="w-full space-y-1.5">
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? t('themeSelector.label')}
        className="grid grid-cols-2 gap-1 sm:grid-cols-3"
      >
        {options.map(({ id, label, nameEn, coverage }) => {
          const isActive = id === selectedId;
          return (
            <button
              key={id ?? 'default'}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => setThemeId(id)}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isActive
                  ? 'border-primary bg-background text-foreground shadow-sm'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{label}</span>
                {nameEn && (
                  <span className="truncate text-xs text-muted-foreground">{nameEn}</span>
                )}
              </div>
              {coverage && (
                <span className="flex-shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4">
                  {t(`themeSelector.coverage.${coverage}`)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {themeFallback && (
        <p role="status" className="text-xs text-muted-foreground">
          {themeFallback.reason === 'missing'
            ? t('themeSelector.notInstalled', { id: themeFallback.id })
            : t('themeSelector.loadFailed', { id: themeFallback.id })}
        </p>
      )}
    </div>
  );
}

export default ThemeSelector;
