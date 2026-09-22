import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { readWorkbuddyCredits } from '@/modules/providers/list/workbuddy/workbuddy-credits.client.js';
import type { LLMProvider, ProviderQuota } from '@/shared/types.js';

/**
 * How long a snapshot is served before the provider is asked again.
 *
 * Every read spawns a provider process, and the settings page can mount and
 * switch panels freely, so repeated requests inside this window share one
 * answer. The shortest rate-limit window any supported provider reports is far
 * longer than this, which makes a snapshot stale by under a minute harmless.
 */
const QUOTA_CACHE_TTL_MS = 60_000;

/**
 * Providers that can report a quota, keyed by provider id.
 *
 * A provider missing here is not an error: the endpoint answers null and the
 * UI renders no quota panel for it.
 */
const quotaReaders: Partial<Record<LLMProvider, () => Promise<ProviderQuota>>> = {
  codex: () => codexAppServer.readQuota(),
  workbuddy: () => readWorkbuddyCredits(),
};

type CachedQuota = { value: ProviderQuota; expiresAt: number };

/** Last successful snapshot per provider, keyed so a switch back is free. */
const cache = new Map<LLMProvider, CachedQuota>();
/** Reads already running, so a second caller joins instead of spawning again. */
const inFlightReads = new Map<LLMProvider, Promise<ProviderQuota | null>>();

/** Drops every cached and in-flight snapshot so the next read hits the provider again; used by tests. */
export function resetProviderQuotaCacheForTests(): void {
  cache.clear();
  inFlightReads.clear();
}

/**
 * Application service exposing per-provider quota snapshots to the quota route.
 */
export const providerQuotaService = {
  /**
   * Returns the account's quota as the provider reports it, or null when the
   * provider has no readable quota source or the read failed.
   *
   * Failures answer null deliberately: a provider that is signed out, blocked
   * by the network, or simply does not report quota should leave the settings
   * page without that panel rather than show an error where the rest of the
   * page is fine. Failures are not cached, so the next visit retries.
   */
  async getProviderQuota(provider: LLMProvider): Promise<ProviderQuota | null> {
    const readQuota = quotaReaders[provider];
    if (!readQuota) {
      return null;
    }

    const cached = cache.get(provider);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const pending = inFlightReads.get(provider);
    if (pending) {
      return pending;
    }

    const read = (async () => {
      try {
        const quota = await readQuota();
        cache.set(provider, { value: quota, expiresAt: Date.now() + QUOTA_CACHE_TTL_MS });
        return quota;
      } catch (error) {
        console.warn(`[ProviderQuota] Failed to read ${provider} quota:`, error);
        return null;
      } finally {
        inFlightReads.delete(provider);
      }
    })();

    inFlightReads.set(provider, read);
    return read;
  },
};
