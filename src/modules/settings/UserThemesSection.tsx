import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { THEME_RESET_PARAM, THEME_RESET_VALUE } from '@/shared/themeReset';
import type { ThemeContrastWarning } from '@/shared/userThemeContrast';
import { addPastedTheme, removePastedTheme } from '@/shared/userThemePastes';
import type { AddPastedThemeFailure, PastedThemeFormat } from '@/shared/userThemePastes';
import {
  getUserThemeStyleState,
  subscribeToUserThemeStyle,
} from '@/shared/userThemeStyles';
import type { UserThemeStyleState } from '@/shared/userThemeStyles';
import { cn } from '@/shared/utils';
import { useThemeCssPreview } from '@/modules/settings/hooks/useThemeCssPreview';
import { useThemePasteFormat } from '@/modules/settings/hooks/useThemePasteFormat';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import ThemeCssEditor from '@/modules/settings/ThemeCssEditor';

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
 * The paste box writes either of §5.5's two formats, and the mode control beside
 * it is which one (§5.5 v5). Switching to raw CSS is the one act on this page
 * that can produce a theme this page cannot undo, so it asks once before it takes
 * effect — and the copy says why, rather than leaving "advanced" to sound like
 * "more options".
 *
 * Advanced mode is also where the box stops being a plain textarea: a stylesheet
 * gets a CSS-aware editor, and the page is made to wear the draft while it is
 * written (§5.5). The preview is not a saved theme and is not presented as one —
 * the section says it is a preview — and it is what the paste would produce,
 * because both go through the same compiler.
 *
 * A theme that compiles but cannot be read is reported here too (§5.10), and the
 * report is careful about what it claims: the theme *was* added, so the copy says
 * it still applies. This is the only moment a pasted theme's author is looking at
 * the page, which makes it the only moment they can be told.
 *
 * The reset hint at the bottom is the visible half of §5.6's forced channel: the
 * channel has to work when the page cannot be read, so it cannot be a button —
 * documenting it is the most a readable page can do for the unreadable one.
 */

/** The badge label for a declared reach; the same keys the picker uses. */
const coverageKey = (coverage: 'accent' | 'full'): string => `themeSelector.coverage.${coverage}`;

/** The two formats the paste box can write, in the order they are offered. */
const PASTE_FORMATS: ReadonlyArray<{ value: PastedThemeFormat; labelKey: string }> = [
  { value: 'json', labelKey: 'userThemes.mode.json' },
  { value: 'css', labelKey: 'userThemes.mode.css' },
];

/** The example shown in the box; each format has its own, since neither is a hint about the other. */
const placeholderKey = (format: PastedThemeFormat): string =>
  `userThemes.pastePlaceholder.${format}`;

/**
 * The §5.10 contrast report, the same shape wherever it appears: a status
 * (not an alert — the theme applies), one line per pair below the floor, and
 * nothing at all when there is nothing to report.
 */
function ContrastReport({ warnings }: { warnings: ThemeContrastWarning[] }) {
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

export default function UserThemesSection() {
  const { t } = useTranslation('settings');
  const { userThemes, themeId, setThemeId } = useTheme();
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<AddPastedThemeFailure | null>(null);
  // §5.10's contrast report for the theme last added. It is state of its own
  // rather than part of `failure`, because the two say opposite things about
  // whether the paste took: a failure means nothing was added, a warning means
  // something was.
  const [warnings, setWarnings] = useState<ThemeContrastWarning[]>([]);
  const [format, setFormat] = useThemePasteFormat();
  const preview = useThemeCssPreview(format, draft);
  // Whether a switch to raw CSS is waiting for its confirmation. It is a state
  // of its own rather than a flag derived from the format, because the whole
  // point of asking is that nothing has been decided yet — writing first and
  // asking after would be the footgun §5.5 warns about, one reload away.
  const [confirmingCss, setConfirmingCss] = useState(false);

  // The contrast report of the stylesheet in the document (§5.10), read from
  // the same store the picker's fallback hint reads. A theme file's compile
  // happens at apply time on the client — the listing never reads content — so
  // this is where a file's warnings surface without breaking that boundary.
  const [styleState, setStyleState] = useState<UserThemeStyleState>(getUserThemeStyleState);
  useEffect(() => subscribeToUserThemeStyle(() => setStyleState(getUserThemeStyleState())), []);

  const fileThemes = userThemes.filter((theme) => theme.source === 'user');
  const pastedThemes = userThemes.filter((theme) => theme.source === 'user-paste');

  // The report belongs to the file list only when the theme wearing the page is
  // one of these files. A paste's report has its own moment (right after the
  // paste), and showing the same warnings twice would read as two problems.
  const appliedFileWarnings = useMemo<ThemeContrastWarning[] | null>(() => {
    if (!styleState.appliedId || styleState.warnings.length === 0) return null;
    return fileThemes.some((theme) => theme.id === styleState.appliedId)
      ? styleState.warnings
      : null;
  }, [fileThemes, styleState]);

  const chooseFormat = (next: PastedThemeFormat) => {
    if (next === format) return;
    if (next === 'json') {
      // Going back to the format that cannot break anything is not a decision
      // that needs confirming, so it takes effect straight away.
      setConfirmingCss(false);
      setFormat('json');
      return;
    }
    setConfirmingCss(true);
  };

  const submit = () => {
    const result = addPastedTheme(draft, format);
    if (!result.ok) {
      setFailure(result.reason);
      setWarnings([]);
      return;
    }
    setDraft('');
    setFailure(null);
    setWarnings(result.warnings);
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
          {appliedFileWarnings && <ContrastReport warnings={appliedFileWarnings} />}
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

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('userThemes.mode.label')}</span>
            <div
              role="radiogroup"
              aria-label={t('userThemes.mode.label')}
              className="inline-flex flex-shrink-0 touch-manipulation items-center rounded-full border border-border bg-muted p-0.5"
            >
              {PASTE_FORMATS.map(({ value, labelKey }) => {
                const isActive = format === value;
                // The capsule the confirmation is about wears a ring while the
                // question is open: the tap did register, and this is what is
                // being asked about — without it the switch reads as dead until
                // the answer, which is exactly how "nothing happened" feels.
                const isPending = confirmingCss && value === 'css';
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => chooseFormat(value)}
                    className={cn(
                      'cursor-pointer rounded-full px-2 py-0.5 text-xs transition-colors duration-200',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      isActive
                        ? 'bg-background text-foreground shadow-sm'
                        : isPending
                          ? 'bg-background text-primary shadow-sm ring-1 ring-primary'
                          : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('userThemes.mode.hint')}</p>
          {format === 'css' && (
            <p className="mt-1 text-xs text-muted-foreground">{t('userThemes.mode.cssNote')}</p>
          )}
          {confirmingCss && (
            <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-sm font-medium text-foreground">{t('userThemes.trust.title')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('userThemes.trust.body')}</p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormat('css');
                    setConfirmingCss(false);
                  }}
                  className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {t('userThemes.trust.confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCss(false)}
                  className="cursor-pointer rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t('userThemes.trust.cancel')}
                </button>
              </div>
            </div>
          )}

          <label className="mt-3 block text-sm text-muted-foreground" htmlFor="user-theme-paste">
            {t('userThemes.pasteLabel')}
          </label>
          {format === 'css' ? (
            <ThemeCssEditor
              id="user-theme-paste"
              placeholder={t(placeholderKey(format))}
              value={draft}
              onChange={setDraft}
            />
          ) : (
            <textarea
              id="user-theme-paste"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t(placeholderKey(format))}
              rows={4}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-input bg-background p-2 font-mono text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
          )}
          {preview.kind !== 'idle' && (
            <p
              className={cn(
                'mt-1 text-xs',
                preview.kind === 'previewing' ? 'text-muted-foreground' : 'text-destructive',
              )}
            >
              {preview.kind === 'previewing'
                ? t('userThemes.previewing')
                : t('userThemes.previewUnavailable', {
                    reason: t(`userThemes.reason.${preview.reason}`),
                  })}
            </p>
          )}
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
          {warnings.length > 0 && <ContrastReport warnings={warnings} />}
        </div>
      </SettingsCard>

      <p className="text-xs text-muted-foreground">
        {t('userThemes.resetHint', { param: `${THEME_RESET_PARAM}=${THEME_RESET_VALUE}` })}
      </p>
    </SettingsSection>
  );
}
