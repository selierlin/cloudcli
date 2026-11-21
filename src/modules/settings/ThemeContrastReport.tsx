import { useTranslation } from 'react-i18next';

import type { ThemeContrastWarning } from '@/shared/userThemeContrast';

/**
 * The §5.10 contrast report, the same shape wherever it appears: a status
 * (not an alert — the theme applies), one line per pair below the floor, and
 * nothing at all when there is nothing to report.
 *
 * Used by the settings module's ThemeSelector for the applied theme and by
 * UserThemesSection for a theme that was just pasted.
 */
export default function ThemeContrastReport({ warnings }: { warnings: ThemeContrastWarning[] }) {
  const { t } = useTranslation('settings');
  return (
    <div role="status" className="mt-2 rounded-lg border border-border bg-muted/40 p-2">
      <p className="text-xs font-medium text-foreground">{t('userThemes.contrastTitle')}</p>
      <ul className="mt-0.5 space-y-0.5">
        {warnings.map((warning) => (
          <li
            key={`${warning.appearance}-${warning.ink}-${warning.surface}`}
            className="text-xs text-muted-foreground"
          >
            {t('userThemes.contrastWarning', {
              appearance: t(`userThemes.contrastAppearance.${warning.appearance}`),
              ink: warning.ink,
              surface: warning.surface,
              ratio: warning.ratio.toFixed(2),
              min: String(warning.min),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
