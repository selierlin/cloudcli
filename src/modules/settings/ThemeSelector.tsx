import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/context/ThemeContext';
import { useThemeOptions } from '@/shared/hooks/useThemeOptions';
import {
  getUserThemeStyleState,
  subscribeToUserThemeStyle,
} from '@/shared/userThemeStyles';
import type { UserThemeStyleState } from '@/shared/userThemeStyles';
import { cn } from '@/shared/utils';
import ThemeContrastReport from '@/modules/settings/ThemeContrastReport';

type ThemeSelectorProps = {
  ariaLabel?: string;
};

/**
 * The host an `inspiredBy` URL points at, when it has one worth printing.
 * Anything else — a relative scheme, a non-URL — is shown verbatim rather than
 * dropped.
 */
function inspiredByLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : url;
  } catch {
    return url;
  }
}

/** The attribution line under a theme file's name: author and host, as much as the file declares. */
function themeProvenance(theme: { author?: string; inspiredBy?: string }): string {
  return [theme.author, theme.inspiredBy ? inspiredByLabel(theme.inspiredBy) : null]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The one place themes are chosen. It is shared by the settings page's
 * appearance tab and, in a plain select, the quick-settings drawer.
 *
 * Everything selectable is here: the default, the registry's overlay themes,
 * and the themes this device supplied from `~/.cloudcli/themes/` or a paste.
 * The two lists are grouped rather than interleaved because that is the one
 * fact a flat list of names cannot show — which themes came with this build and
 * which are ones the user brought. A file's author and inspiration ride under
 * its name, so the provenance the old separate listing carried is not lost.
 *
 * The picker also reports §5.10's contrast warnings for the file theme in
 * force: the report describes what the page is wearing, so it belongs beside
 * the pick that put it there. A paste's report keeps its own moment, in the
 * section that added it.
 *
 * The device-supplied group opens closed unless one of its themes is the pick,
 * because a themes folder can hold far more themes than the registry does and
 * an always-open list is the length this page was trying to shed. Closing it
 * never hides the pick: the chosen option stays on screen, and the header says
 * how many are behind it.
 */
function ThemeSelector({ ariaLabel }: ThemeSelectorProps) {
  const { t } = useTranslation('settings');
  const { themeFallback } = useTheme();
  const { options, selectedId, setThemeId } = useThemeOptions();

  const [styleState, setStyleState] = useState<UserThemeStyleState>(getUserThemeStyleState);
  useEffect(() => subscribeToUserThemeStyle(() => setStyleState(getUserThemeStyleState())), []);

  // The default option carries no source of its own; it belongs with the
  // registry's themes rather than with the ones this device supplied.
  const builtinOptions = options.filter(
    (option) => option.id === null || option.source === 'builtin',
  );
  const userOptions = options.filter(
    (option) => option.source === 'user' || option.source === 'user-paste',
  );

  // `null` means "no choice made on this page yet", which follows the pick: the
  // group is open when the theme in force is one of its own. An explicit toggle
  // wins over that, so collapsing it survives a later pick.
  const [userGroupOpen, setUserGroupOpen] = useState<boolean | null>(null);
  const userGroupExpanded =
    userGroupOpen ?? userOptions.some((option) => option.id === selectedId);
  // A closed group still draws the chosen option, so the pick never disappears
  // from the list that marks it as chosen.
  const visibleUserOptions = userGroupExpanded
    ? userOptions
    : userOptions.filter((option) => option.id === selectedId);

  // A paste's report has its own moment (right after the paste), and showing
  // it here as well would read as the same problem twice.
  const appliedFileWarnings =
    styleState.appliedId
    && styleState.warnings.length > 0
    && userOptions.some(
      (option) => option.id === styleState.appliedId && option.source === 'user',
    )
      ? styleState.warnings
      : null;

  const renderOptions = (groupOptions: typeof options) => (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
      {groupOptions.map((option) => {
        const isActive = option.id === selectedId;
        const provenance = themeProvenance(option);
        return (
          <button
            key={option.id ?? 'default'}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setThemeId(option.id)}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'border-primary bg-background text-foreground shadow-sm'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{option.label}</span>
              {option.nameEn && (
                <span className="truncate text-xs text-muted-foreground">{option.nameEn}</span>
              )}
              {provenance && (
                <span className="truncate text-[11px] text-muted-foreground">{provenance}</span>
              )}
            </div>
            {option.coverage && (
              <span className="flex-shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4">
                {t(`themeSelector.coverage.${option.coverage}`)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="w-full space-y-3">
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? t('themeSelector.label')}
        className="space-y-3"
      >
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t('themeSelector.groups.builtin')}
          </p>
          {renderOptions(builtinOptions)}
        </div>

        {userOptions.length > 0 && (
          <div className="space-y-1.5">
            <button
              type="button"
              aria-expanded={userGroupExpanded}
              onClick={() => setUserGroupOpen(!userGroupExpanded)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('themeSelector.groups.mineCount', { count: userOptions.length })}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'h-3 w-3 transition-transform duration-200',
                  userGroupExpanded && 'rotate-180',
                )}
              />
            </button>
            {visibleUserOptions.length > 0 && renderOptions(visibleUserOptions)}
          </div>
        )}
      </div>
      {appliedFileWarnings && <ThemeContrastReport warnings={appliedFileWarnings} />}
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
