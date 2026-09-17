import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useProviderQuota } from '@/modules/settings/hooks/useProviderQuota';
import type { AgentProvider, ProviderQuotaWindow } from '@/shared/types';

type ProviderQuotaSectionProps = {
  agent: AgentProvider;
};

/**
 * Names a window length in the largest unit that divides it exactly, so a
 * five-hour window is not reported as "300 minutes" and a weekly one not as
 * "168 hours". Returns null when the provider did not report a length at all.
 */
function formatWindowLength(windowMinutes: number | null, t: TFunction): string | null {
  if (windowMinutes === null || windowMinutes <= 0) {
    return null;
  }
  if (windowMinutes % 1440 === 0) {
    return t('agents.quota.duration.days', { value: windowMinutes / 1440 });
  }
  if (windowMinutes % 60 === 0) {
    return t('agents.quota.duration.hours', { value: windowMinutes / 60 });
  }
  return t('agents.quota.duration.minutes', { value: windowMinutes });
}

/**
 * Expresses a reset timestamp as the wall-clock moment it happens, formatted in
 * the reader's own locale, so the panel answers "when does this window come
 * back" without the reader adding a duration to their current time.
 */
function formatResetTime(resetsAt: number | null, language: string): string | null {
  if (resetsAt === null) {
    return null;
  }

  return new Date(resetsAt * 1000).toLocaleString(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Restates the same reset as time remaining, which complements the clock time
 * above: the clock answers "until when" and this answers "how long".
 */
function formatResetIn(resetsAt: number | null, t: TFunction): string | null {
  if (resetsAt === null) {
    return null;
  }

  const minutesLeft = Math.ceil((resetsAt * 1000 - Date.now()) / 60_000);
  if (minutesLeft <= 0) {
    return null;
  }
  if (minutesLeft < 60) {
    return t('agents.quota.resetsIn', {
      duration: t('agents.quota.duration.minutes', { value: minutesLeft }),
    });
  }

  const hoursLeft = Math.round(minutesLeft / 60);
  if (hoursLeft < 48) {
    return t('agents.quota.resetsIn', {
      duration: t('agents.quota.duration.hours', { value: hoursLeft }),
    });
  }

  return t('agents.quota.resetsIn', {
    duration: t('agents.quota.duration.days', { value: Math.round(hoursLeft / 24) }),
  });
}

/** Headroom below these shares is worth flagging before the provider starts refusing requests. */
function barClassName(remainingPercent: number): string {
  if (remainingPercent <= 10) {
    return 'bg-red-500';
  }
  if (remainingPercent <= 30) {
    return 'bg-amber-500';
  }
  return 'bg-emerald-500';
}

/** One rolling window as a labelled bar; kept private because the panel is its only consumer. */
function QuotaWindowRow({ quotaWindow }: { quotaWindow: ProviderQuotaWindow }) {
  const { t, i18n } = useTranslation('settings');
  const length = formatWindowLength(quotaWindow.windowMinutes, t);
  const resetTime = formatResetTime(quotaWindow.resetsAt, i18n.language);
  const resetsIn = formatResetIn(quotaWindow.resetsAt, t);
  // Providers report consumption rather than headroom, and headroom is what the
  // reader is deciding on, so the bar and the number beside it both track what
  // is left. A value outside 0-100 is clamped instead of trusted.
  const remainingPercent = 100 - Math.min(100, Math.max(0, quotaWindow.usedPercent));

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">
          {length ? t('agents.quota.window', { duration: length }) : t('agents.quota.title')}
        </span>
        <span className="text-sm text-muted-foreground">
          {t('agents.quota.remaining', { percent: Math.round(remainingPercent) })}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${barClassName(remainingPercent)}`}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>
      {resetTime && (
        <div className="mt-1 text-xs text-muted-foreground">
          {t('agents.quota.resetsAt', { time: resetTime })}
          {resetsIn ? ` · ${resetsIn}` : ''}
        </div>
      )}
    </div>
  );
}

/** Rendered by AgentCategoryContentSection under the account panel to show the selected provider's remaining quota, read from that provider's own account. */
export default function ProviderQuotaSection({ agent }: ProviderQuotaSectionProps) {
  const { t } = useTranslation('settings');
  const { quota, loading } = useProviderQuota(agent);

  // Held back until the first read settles: providers with no quota source
  // answer null, and a placeholder would flash for every one of them.
  if (loading || !quota || quota.windows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{t('agents.quota.title')}</h3>
        {quota.planType && (
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {quota.planType}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {quota.windows.map((quotaWindow, index) => (
          <QuotaWindowRow
            key={`${quotaWindow.windowMinutes ?? 'window'}-${index}`}
            quotaWindow={quotaWindow}
          />
        ))}
      </div>

      {quota.credits && (
        <div className="mt-4 border-t border-border/50 pt-3 text-sm text-muted-foreground">
          {t('agents.quota.credits', { balance: quota.credits })}
        </div>
      )}
    </div>
  );
}
