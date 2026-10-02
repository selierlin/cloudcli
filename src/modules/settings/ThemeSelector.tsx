import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { useThemeOptions } from '@/shared/hooks/useThemeOptions';
import { cn } from '@/shared/utils';

type ThemeSelectorProps = {
  ariaLabel?: string;
};

/** Used by the settings module to pick the overlay theme painted under the current appearance. */
function ThemeSelector({ ariaLabel }: ThemeSelectorProps) {
  const { t } = useTranslation('settings');
  const { themeFallback } = useTheme();
  const { options, selectedId, setThemeId } = useThemeOptions();

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
