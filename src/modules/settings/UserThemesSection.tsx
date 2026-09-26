import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { THEME_RESET_PARAM, THEME_RESET_VALUE } from '@/shared/themeReset';
import { addPastedTheme, removePastedTheme } from '@/shared/userThemePastes';
import type { AddPastedThemeFailure } from '@/shared/userThemePastes';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';

/**
 * The settings page's user-theme section: what the two sources hold, and the two
 * things only this page can do — remove a pasted theme, and add one.
 *
 * It exists because the two sources are not interchangeable in the one way that
 * matters to a person looking at the list: a theme file lives on the host and the
 * page can only report it, whereas a pasted theme's only copy is the user's
 * preferences, so without a delete button here there is no way to remove one
 * (§5.4 v3). The picker above picks; this section is where a theme is added and
 * taken away, and where the difference is stated rather than left to be guessed
 * from which button is missing.
 *
 * The reset hint at the bottom is the visible half of §5.6's forced channel: the
 * channel has to work when the page cannot be read, so it cannot be a button —
 * documenting it is the most a readable page can do for the unreadable one.
 */

/** The badge label for a declared reach; the same keys the picker uses. */
const coverageKey = (coverage: 'accent' | 'full'): string => `themeSelector.coverage.${coverage}`;

export default function UserThemesSection() {
  const { t } = useTranslation('settings');
  const { userThemes, themeId, setThemeId } = useTheme();
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<AddPastedThemeFailure | null>(null);

  const fileThemes = userThemes.filter((theme) => theme.source === 'user');
  const pastedThemes = userThemes.filter((theme) => theme.source === 'user-paste');

  const submit = () => {
    const result = addPastedTheme(draft);
    if (!result.ok) {
      setFailure(result.reason);
      return;
    }
    setDraft('');
    setFailure(null);
  };

  const rowClass = 'flex items-center justify-between gap-2 py-1';
  const badgeClass =
    'flex-shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium leading-4 text-muted-foreground';
  const actionClass =
    'cursor-pointer rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <SettingsSection title={t('userThemes.title')} description={t('userThemes.description')}>
      <SettingsCard divided>
        <div className="px-4 py-4">
          <div className="text-sm font-medium text-foreground">{t('userThemes.files.title')}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('userThemes.files.hint')}</p>
          {fileThemes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('userThemes.files.empty')}</p>
          ) : (
            <ul className="mt-2">
              {fileThemes.map((theme) => (
                <li key={theme.id} className={rowClass}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-foreground">{theme.name}</span>
                    {theme.coverage && (
                      <span className={badgeClass}>{t(coverageKey(theme.coverage))}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-pressed={themeId === theme.id}
                    onClick={() => setThemeId(theme.id)}
                    className={actionClass}
                  >
                    {t(themeId === theme.id ? 'userThemes.inUse' : 'userThemes.use')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-4">
          <div className="text-sm font-medium text-foreground">{t('userThemes.pastes.title')}</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('userThemes.pastes.hint')}</p>
          {pastedThemes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('userThemes.pastes.empty')}</p>
          ) : (
            <ul className="mt-2">
              {pastedThemes.map((theme) => (
                <li key={theme.id} className={rowClass}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-foreground">{theme.name}</span>
                    {theme.coverage && (
                      <span className={badgeClass}>{t(coverageKey(theme.coverage))}</span>
                    )}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={themeId === theme.id}
                      onClick={() => setThemeId(theme.id)}
                      className={actionClass}
                    >
                      {t(themeId === theme.id ? 'userThemes.inUse' : 'userThemes.use')}
                    </button>
                    <button
                      type="button"
                      aria-label={t('userThemes.deleteAria', { name: theme.name })}
                      onClick={() => removePastedTheme(theme.id)}
                      className={actionClass}
                    >
                      {t('userThemes.delete')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-3 block text-sm text-muted-foreground" htmlFor="user-theme-paste">
            {t('userThemes.pasteLabel')}
          </label>
          <textarea
            id="user-theme-paste"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('userThemes.pastePlaceholder')}
            rows={4}
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-input bg-background p-2 font-mono text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={draft.trim().length === 0}
              className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-sm text-foreground transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('userThemes.pasteSubmit')}
            </button>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {t('userThemes.pasteInvalid', { reason: t(`userThemes.reason.${failure}`) })}
              </p>
            )}
          </div>
        </div>
      </SettingsCard>

      <p className="text-xs text-muted-foreground">
        {t('userThemes.resetHint', { param: `${THEME_RESET_PARAM}=${THEME_RESET_VALUE}` })}
      </p>
    </SettingsSection>
  );
}
