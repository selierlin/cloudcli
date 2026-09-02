import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { cn } from '@/shared/utils';

type ThemeMode = 'light' | 'system' | 'dark';

type ThemeModeSelectorProps = {
  ariaLabel?: string;
};

function ThemeModeSelector({ ariaLabel }: ThemeModeSelectorProps) {
  const { t } = useTranslation('settings');
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: ThemeMode; icon: typeof Sun; label: string }> = [
    { value: 'light', icon: Sun, label: t('themeMode.light') },
    { value: 'system', icon: Monitor, label: t('themeMode.system') },
    { value: 'dark', icon: Moon, label: t('themeMode.dark') },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? t('themeMode.label')}
      className="inline-flex flex-shrink-0 touch-manipulation items-center rounded-full border border-border bg-muted p-0.5"
    >
      {options.map(({ value, icon: Icon, label }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-6 w-8 cursor-pointer items-center justify-center rounded-full transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="sr-only">{label}</span>
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export default ThemeModeSelector;
