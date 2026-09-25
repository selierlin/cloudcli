import { useTranslation } from 'react-i18next';

import { BUILTIN_THEMES } from '@/shared/constants';
import { useTheme } from '@/shared/context/ThemeContext';
import { cn } from '@/shared/utils';

/**
 * The themes this selector offers. `appearance: 'system'` is what marks an overlay
 * theme; the appearance defaults are the base palette itself and are switched with
 * the light/dark/system capsule, so they are deliberately absent here.
 */
const OVERLAY_THEMES = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

type ThemeOption = {
  /** The overlay id to write, or null for the appearance default. */
  id: string | null;
  /**
   * The name shown for the option. A built-in theme carries its own, which is why
   * it is read off the manifest rather than translated: a user theme (§5.5) will
   * bring its name with it the same way.
   */
  label: string;
  /** How far the theme reaches, shown as a badge; absent themes claim nothing. */
  coverage?: 'accent' | 'full';
};

type ThemeSelectorProps = {
  ariaLabel?: string;
};

/** Used by the settings module to pick the overlay theme painted under the current appearance. */
function ThemeSelector({ ariaLabel }: ThemeSelectorProps) {
  const { t } = useTranslation('settings');
  const { themeId, resolvedThemeId, setThemeId } = useTheme();

  // The option to mark as chosen. A default-alias id (`cc-light` / `cc-dark`) is
  // reachable through `setThemeId` but carries no overlay of its own, so it reads
  // as "default" rather than leaving every option unselected.
  const selectedId = OVERLAY_THEMES.some((theme) => theme.id === themeId) ? themeId : null;

  // A pick synced from another device that this build does not ship. The selection
  // stays on the user's own choice while the document has already fallen back, so
  // the mismatch between the two is exactly the case worth surfacing.
  const missingId = themeId !== null && themeId !== resolvedThemeId ? themeId : null;

  const options: ThemeOption[] = [
    { id: null, label: t('themeSelector.default') },
    ...OVERLAY_THEMES.map((theme) => ({
      id: theme.id,
      label: theme.name,
      coverage: theme.coverage,
    })),
  ];

  return (
    <div className="w-40 space-y-1.5">
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? t('themeSelector.label')}
        className="flex flex-col gap-1"
      >
        {options.map(({ id, label, coverage }) => {
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
              <span className="truncate">{label}</span>
              {coverage && (
                <span className="flex-shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4">
                  {t(`themeSelector.coverage.${coverage}`)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {missingId && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('themeSelector.notInstalled', { id: missingId })}
        </p>
      )}
    </div>
  );
}

export default ThemeSelector;
