import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { AgentProvider, ProviderQuota } from '@/shared/types';

type ProviderQuotaResult = {
  /** Latest snapshot for the requested provider, or null when it reports no quota or the read failed. */
  quota: ProviderQuota | null;
  /** True until the request for the current provider settles, so the panel can hold back an empty state. */
  loading: boolean;
};

type ProviderQuotaState = ProviderQuotaResult & {
  /** The provider a stored snapshot belongs to, so a switch cannot render one agent's numbers under another agent's name. */
  provider: AgentProvider;
};

type ProviderQuotaApiResponse = {
  success?: boolean;
  data?: { quota?: ProviderQuota | null };
};

/**
 * Reads the selected provider's quota snapshot for the settings account panel.
 *
 * Refetches whenever the selected provider changes and drops the previous
 * provider's snapshot on the way, so switching between agents never leaves one
 * agent's numbers under another agent's name.
 */
export function useProviderQuota(provider: AgentProvider): ProviderQuotaResult {
  const [state, setState] = useState<ProviderQuotaState>({ provider, quota: null, loading: true });

  if (state.provider !== provider) {
    // Dropped during render rather than from an effect: the previous provider's
    // snapshot must not reach the DOM even for the frame before an effect runs.
    setState({ provider, quota: null, loading: true });
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await api.providers.quota(provider);
        const body = (await response.json()) as ProviderQuotaApiResponse;
        if (cancelled) {
          return;
        }
        setState({
          provider,
          quota: body.success ? body.data?.quota ?? null : null,
          loading: false,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error(`Error loading ${provider} quota:`, error);
        // A provider that cannot report quota is not an error the account
        // panel should surface; it just renders nothing.
        setState({ provider, quota: null, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider]);

  return { quota: state.quota, loading: state.loading };
}
