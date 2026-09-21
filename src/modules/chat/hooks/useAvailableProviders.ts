import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider } from '@/shared/types';

const ALL_PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp'];
const AVAILABLE_PROVIDERS_STORAGE_KEY = 'available-providers-v1';
const AVAILABLE_PROVIDERS_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

type StoredAvailableProviders = {
  providers: LLMProvider[];
  savedAt: number;
};

function readStoredAvailableProviders(): Set<LLMProvider> | null {
  try {
    const raw = localStorage.getItem(AVAILABLE_PROVIDERS_STORAGE_KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as Partial<StoredAvailableProviders>;
    if (
      !Array.isArray(stored.providers)
      || typeof stored.savedAt !== 'number'
      || Date.now() - stored.savedAt > AVAILABLE_PROVIDERS_STORAGE_TTL_MS
    ) {
      return null;
    }
    return new Set(stored.providers.filter((provider): provider is LLMProvider => ALL_PROVIDERS.includes(provider)));
  } catch {
    return null;
  }
}

function storeAvailableProviders(providers: Set<LLMProvider>): void {
  try {
    const payload: StoredAvailableProviders = { providers: [...providers], savedAt: Date.now() };
    localStorage.setItem(AVAILABLE_PROVIDERS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing or a full storage quota should only disable this cache.
  }
}

let cachedAvailableProviders: Set<LLMProvider> | null = readStoredAvailableProviders();
let inFlightRequest: Promise<Set<LLMProvider>> | null = null;

async function refreshAvailableProviders(): Promise<Set<LLMProvider>> {
  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = (async () => {
    try {
      const response = await api.providers.available();
      const body = await response.json() as { success?: boolean; data?: { providers?: LLMProvider[] } };
      if (!body.success || !Array.isArray(body.data?.providers)) {
        throw new Error('Failed to load available providers');
      }

      cachedAvailableProviders = new Set(body.data.providers);
      storeAvailableProviders(cachedAvailableProviders);
      return cachedAvailableProviders;
    } catch (error) {
      console.error('Error loading available providers:', error);
      // A transient probe failure must not make the new-session page unusable.
      return new Set(ALL_PROVIDERS);
    } finally {
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}

/** Starts a shared background refresh before the new-session picker is opened. */
export function prefetchAvailableProviders(): void {
  void refreshAvailableProviders();
}

/** Used by the new-session picker to show only locally installed harnesses. */
export function useAvailableProviders(): Set<LLMProvider> | null {
  // Null distinguishes the initial probe from a machine that has no harnesses.
  const [availableProviders, setAvailableProviders] = useState<Set<LLMProvider> | null>(cachedAvailableProviders);

  useEffect(() => {
    let cancelled = false;

    void refreshAvailableProviders().then((providers) => {
      if (!cancelled) {
        setAvailableProviders(providers);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return availableProviders;
}
