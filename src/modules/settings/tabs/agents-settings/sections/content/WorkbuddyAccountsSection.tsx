import { useTranslation } from 'react-i18next';

import { useWorkbuddyAccounts } from '@/modules/settings/hooks/useWorkbuddyAccounts';
import { Badge, Button } from '@/shared/ui';
import type { WorkbuddySwitchAccount } from '@/shared/types';

/** Expiry as a calendar date; the session either works before it or needs a fresh sign-in after. */
function formatExpiry(expiresAt: number | null, language: string): string | null {
  if (expiresAt === null) {
    return null;
  }
  return new Date(expiresAt).toLocaleDateString(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** The secondary line under an account name: whichever identity detail the companion reported. */
function accountDetail(account: WorkbuddySwitchAccount): string | null {
  return account.phoneNumber ?? account.email ?? null;
}

/**
 * Formats a balance for the row.
 *
 * The gateway reports fractional credits (e.g. 2759.93). Rounding down keeps
 * the number honest about what can still be spent instead of promising the
 * 2760 a plain round would show.
 */
function formatCredits(remaining: number, language: string): string {
  return Math.floor(remaining).toLocaleString(language);
}

/**
 * Rendered by AgentCategoryContentSection in the workbuddy account category to
 * list the accounts stored by the optional workbuddy-switch companion and sign
 * WorkBuddy in as one of them.
 *
 * Switching is what makes this worth its own panel: CloudCLI's workbuddy
 * provider reads the same auth file the companion writes, so the account
 * chosen here decides which credits and which rate limit the next turn uses.
 */
export default function WorkbuddyAccountsSection() {
  const { t, i18n } = useTranslation('settings');
  const { status, credits, loading, switching, progress, error, hasActiveSessions, switchTo } =
    useWorkbuddyAccounts();

  // Held back until the first read settles: rendering "not installed" while the
  // companion is still being queried would flash an instruction the reader does
  // not need.
  if (loading || !status) {
    return null;
  }

  if (!status.available) {
    return (
      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">
          {t('agents.workbuddyAccounts.title')}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('agents.workbuddyAccounts.unavailable')}
        </p>
        {/* Copyable rather than a button: starting the companion is the
            reader's own terminal action, and CloudCLI cannot do it for them. */}
        <div className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
          <div>npm i -g workbuddy-switch</div>
          <div>wb-switch serve</div>
        </div>
      </div>
    );
  }

  const sessionWarning = hasActiveSessions
    ? t('agents.workbuddyAccounts.restartWithSessions')
    : status.running
      ? t('agents.workbuddyAccounts.restartRunning')
      : null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">
          {t('agents.workbuddyAccounts.title')}
        </h3>
        {status.version && (
          <span className="text-xs text-muted-foreground">workbuddy-switch v{status.version}</span>
        )}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{t('agents.workbuddyAccounts.sessionsHint')}</p>

      {sessionWarning && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
          {sessionWarning}
        </p>
      )}

      <div className="space-y-3">
        {status.accounts.map((account) => {
          const isCurrent = account.uid !== null && account.uid === status.currentUid;
          const expiry = formatExpiry(account.expiresAt, i18n.language);
          const detail = accountDetail(account);
          const name = account.nickname ?? detail ?? account.uid ?? account.id;
          const credit = credits?.credits.find((entry) => entry.accountId === account.id) ?? null;
          const creditLabel = credit === null
            ? null
            : credit.remaining === null
              ? t('agents.workbuddyAccounts.creditsUnavailable')
              : t('agents.workbuddyAccounts.creditsRemaining', {
                  credits: formatCredits(credit.remaining, i18n.language),
                });

          return (
            <div
              key={account.id}
              className="flex items-start justify-between gap-3 border-t border-border/50 pt-3 first:border-0 first:pt-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{name}</span>
                  {isCurrent && (
                    <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                      {t('agents.workbuddyAccounts.current')}
                    </Badge>
                  )}
                  {account.isEnterprise && (
                    <Badge variant="secondary">{t('agents.workbuddyAccounts.enterprise')}</Badge>
                  )}
                  {account.needsRelogin && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                      {t('agents.workbuddyAccounts.reloginRequired')}
                    </Badge>
                  )}
                </div>
                {/* The title carries the companion's own reason when the
                    balance is missing, which is the only place the cause is
                    available without adding a line per row. */}
                <div
                  className="mt-0.5 text-xs text-muted-foreground"
                  title={credit?.error ?? undefined}
                >
                  {[detail, expiry ? t('agents.workbuddyAccounts.expires', { date: expiry }) : null, creditLabel]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>

              <Button
                size="sm"
                className="shrink-0"
                // A row that is already signed in or whose stored session is
                // expired cannot be acted on: the first would restart WorkBuddy
                // for no change, the second needs the companion's own re-login.
              disabled={isCurrent || account.needsRelogin || switching}
              onClick={() => {
                void switchTo(account.id);
              }}
              >
                {isCurrent
                  ? t('agents.workbuddyAccounts.inUse')
                  : switching
                    ? t('agents.workbuddyAccounts.switching')
                    : hasActiveSessions || status.running
                      ? t('agents.workbuddyAccounts.switchAndRestart')
                      : t('agents.workbuddyAccounts.switch')}
              </Button>
            </div>
          );
        })}
      </div>

      {switching && (
        <div className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {progress ?? t('agents.workbuddyAccounts.switching')}
        </div>
      )}

      {error && (
        <div className="mt-4 border-t border-border/50 pt-3 text-sm text-red-600 dark:text-red-400">
          {t('agents.error', { error })}
        </div>
      )}
    </div>
  );
}
