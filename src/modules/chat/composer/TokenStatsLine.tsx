import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { LLMProvider } from '@/shared/types';

type TokenStatsLineProps = {
  /** The session's token budget payload, or null when the provider reported none. */
  usage: Record<string, unknown> | null;
  /**
   * The provider that produced `usage`. Providers disagree on whether
   * `inputTokens` already counts cache reads, which decides the cache-hit
   * rate's denominator.
   */
  provider: LLMProvider;
  /** Opens the session's token breakdown. */
  onShowDetails: () => void;
};

const readCount = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  // Thresholds sit where rounding would carry into the next unit, so 9,960 reads "10K", not "10.0K".
  if (value >= 999_500) {
    return `${(value / 1_000_000).toFixed(value >= 9_950_000 ? 0 : 1)}M`;
  }

  if (value >= 9_950) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

/**
 * The prompt a cache-hit rate is measured against. Providers disagree on
 * whether `inputTokens` already counts the cache buckets — Claude and WorkBuddy
 * fold them in, Pi/OpenClaw/OMP report them beside a miss-only count — but
 * every payload resolves that disagreement in `breakdown.input`, which is the
 * whole prompt either way. Recomputing it from `inputTokens + cacheTokens`
 * would double a cached turn for the providers that are already inclusive.
 */
const promptTokensOf = (usage: Record<string, unknown>) => {
  const breakdown = usage.breakdown && typeof usage.breakdown === 'object'
    ? usage.breakdown as Record<string, unknown>
    : null;
  return readCount(breakdown?.input) || readCount(usage.inputTokens);
};

/**
 * Whether `used` is how much of the context window the current request holds.
 * Codex reports the session's running token total in `total_token_usage` while
 * `total` is the model's window, so reading the two together claims
 * "1.2M / 200K" by the second turn. OpenCode and ZCode also report a running
 * total, but carry no window, so the pair is absent for them regardless.
 */
const reportsContextOccupancy = (provider: LLMProvider) => provider !== 'codex';

/**
 * The tokens a payload accounts for, or 0 when it reports nothing usable.
 */
const reportedTokenUsage = (usage: Record<string, unknown> | null) => {
  if (!usage) {
    return 0;
  }
  return readCount(usage.used) || readCount(usage.inputTokens) + readCount(usage.outputTokens);
};

/**
 * A rate that rounds to a full hit keeps a decimal instead of reading 100,
 * because a line claiming a full hit while tokens were still billed for misses
 * is a claim the reader cannot check. Cache rates cluster just below 100, so
 * the tail is clamped at 99.9 rather than rounded up to a hundred.
 */
const formatHitPercent = (hitTokens: number, promptTokens: number) => {
  if (hitTokens >= promptTokens) {
    return '100';
  }

  const percent = (hitTokens / promptTokens) * 100;
  const rounded = Math.round(percent);
  if (rounded < 100) {
    return String(rounded);
  }

  return Math.min(99.9, Math.round(percent * 10) / 10).toFixed(1);
};

/**
 * Rendered by chat's ChatComposer under the input: the session's context
 * occupancy, its cache-hit rate and a way into the full breakdown. It stays a
 * line of quiet text because the number is read in passing; clicking it opens
 * the same details a dedicated button used to hide behind one more click.
 */
function TokenStatsLine({ usage, provider, onShowDetails }: TokenStatsLineProps) {
  const { t } = useTranslation();

  const usedTokens = reportedTokenUsage(usage);
  if (!usage || usedTokens <= 0) {
    return null;
  }

  const contextWindow = reportsContextOccupancy(provider) ? readCount(usage.total) : 0;
  const contextPercent = contextWindow > 0
    ? Math.min(100, Math.round((usedTokens / contextWindow) * 100))
    : null;

  // A provider that reports no cache bucket at all is not a 0% hit; it simply
  // has nothing to say about caching.
  const reportsCache = usage.cacheReadTokens !== undefined && usage.cacheReadTokens !== null;
  const promptTokens = reportsCache ? promptTokensOf(usage) : 0;
  const hitPercent = reportsCache && promptTokens > 0
    ? formatHitPercent(readCount(usage.cacheReadTokens), promptTokens)
    : null;

  return (
    <button
      type="button"
      onClick={onShowDetails}
      title={t('chat:misc.tokensUsed', { count: usedTokens })}
      aria-label={t('chat:misc.showTokenUsage')}
      className="chat-token-stats flex w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] leading-tight text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="shrink-0 tabular-nums">
        {formatTokenCount(usedTokens)}
        {contextWindow > 0 && (
          <span className="text-muted-foreground/60"> / {formatTokenCount(contextWindow)}</span>
        )}
        <span className="text-muted-foreground/60"> {t('chat:misc.tokensLabel', { count: usedTokens })}</span>
      </span>

      {contextPercent !== null && (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
          <span className="shrink-0 tabular-nums">{contextPercent}%</span>
        </>
      )}

      {hitPercent !== null && (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
          <span className="min-w-0 truncate">{t('chat:misc.cacheHitRate', { percent: hitPercent })}</span>
        </>
      )}
    </button>
  );
}

/** Memoized: the composer re-renders on every keystroke and this line's numbers only move when usage does. */
export default memo(TokenStatsLine);
