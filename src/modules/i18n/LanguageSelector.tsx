
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

import { Select } from '@/shared/ui';
import { languages } from '@/modules/i18n/languages';

type LanguageSelectorProps = {
  compact?: boolean;
};

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists it as a user preference.
 *
 * Used by the settings module's appearance tab so the user can switch language.
 *
 * Props:
 * @param {boolean} compact - If true, uses compact style (default: false)
 */
export default function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    i18n.changeLanguage(newLanguage);
  };

  // Compact style for QuickSettingsPanel
  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-transparent bg-muted/50 p-3 transition-colors hover:border-border hover:bg-accent">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <Languages className="h-4 w-4 text-muted-foreground" />
          {t('account.language')}
        </span>
        <select
          value={i18n.language}
          onChange={handleLanguageChange}
          className="w-auto min-w-[120px] max-w-[160px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Full style for the settings page. The row repeats `SettingsRow`'s layout
  // rather than importing it: the settings module already imports this selector,
  // so reaching back into it would make the two barrels import each other.
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {t('account.languageLabel')}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {t('account.languageDescription')}
        </div>
      </div>
      <div className="flex-shrink-0">
        <Select
          className="w-full sm:w-40"
          value={i18n.language}
          onChange={handleLanguageChange}
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
