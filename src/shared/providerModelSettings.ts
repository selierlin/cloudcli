import type { LLMProvider } from '@/shared/types';

/** Models and effort defaults selected by the user for each provider. */
export type ProviderModelSelection = {
  model?: string;
  effort?: string;
};

/** Provider-scoped model preferences, persisted as one user preference. */
export type ProviderModelSettings = Partial<Record<LLMProvider, ProviderModelSelection>>;

/** Providers whose model and effort choices can be saved. */
export const LLM_PROVIDERS: LLMProvider[] = [
  'claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp',
];

/** Collects existing browser-only model and effort choices for first-login migration. */
export function readLegacyProviderModelSettings(): ProviderModelSettings | undefined {
  try {
    const settings: ProviderModelSettings = {};
    let found = false;

    for (const provider of LLM_PROVIDERS) {
      const model = localStorage.getItem(`${provider}-model`);
      const effort = localStorage.getItem(`${provider}-effort`);
      if (model === null && effort === null) continue;

      settings[provider] = {
        ...(model === null ? {} : { model }),
        ...(effort === null ? {} : { effort }),
      };
      found = true;
    }

    return found ? settings : undefined;
  } catch {
    return undefined;
  }
}
