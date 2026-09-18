import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { LLMProvider, ProviderAuthStatus } from '@/shared/types.js';

const INSTALLED_PROVIDERS_CACHE_TTL_MS = 10 * 60 * 1000;

let installedProvidersCache: { providers: LLMProvider[]; expiresAt: number } | null = null;

export const providerAuthService = {
  /**
   * Resolves a provider and returns its installation/authentication status.
   */
  async getProviderAuthStatus(providerName: string): Promise<ProviderAuthStatus> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.auth.getStatus();
  },

  /**
   * Lists the harnesses whose local runtime is installed. The new-session
   * picker uses this instead of presenting integrations that cannot be run.
   */
  async listInstalledProviders(): Promise<LLMProvider[]> {
    if (installedProvidersCache && installedProvidersCache.expiresAt > Date.now()) {
      return installedProvidersCache.providers;
    }

    const statuses = await Promise.all(
      providerRegistry.listProviders().map(async (provider) => ({
        provider: provider.id,
        status: await provider.auth.getStatus(),
      })),
    );

    const providers = statuses
      .filter(({ status }) => status.installed)
      .map(({ provider }) => provider);

    installedProvidersCache = {
      providers,
      expiresAt: Date.now() + INSTALLED_PROVIDERS_CACHE_TTL_MS,
    };
    return providers;
  },

  /**
   * Returns whether a provider runtime appears installed.
   * Falls back to true if status lookup itself fails so callers preserve the
   * original runtime error instead of replacing it with a status-check failure.
   */
  async isProviderInstalled(providerName: LLMProvider): Promise<boolean> {
    try {
      const status = await this.getProviderAuthStatus(providerName);
      return status.installed;
    } catch {
      return true;
    }
  },
};
