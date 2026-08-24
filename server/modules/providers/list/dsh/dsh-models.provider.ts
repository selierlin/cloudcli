import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated DSH catalog mirroring the models the DeepSeek Harness ACP server
 * composition (`examples/acp-agent/cordis.yml` → `dsh-llm-deepseek`) exposes.
 * The harness itself owns the authoritative list; this mirror keeps the picker
 * usable before the server starts and stays in sync with the demo composition.
 */
export const DSH_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      description: 'Fast and affordable DeepSeek coding model.',
    },
    {
      value: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      description: 'Frontier DeepSeek model for complex coding and research.',
    },
    {
      value: 'deepseek-v4-flash-vision-exp',
      label: 'DeepSeek V4 Flash Vision',
      description: 'Experimental DeepSeek model with image input.',
    },
  ],
  DEFAULT: 'deepseek-v4-pro',
};

/** Location of the DeepSeek Harness repository that hosts the ACP server composition. */
export const getDshHarnessRoot = (): string =>
  process.env.DSH_HARNESS_ROOT
  || path.join(os.homedir(), 'Projects', 'open_projects', 'deepseek-harness');

/**
 * Root where ACP sessions are persisted.
 *
 * Defaults to the DSH Desktop harness sessions directory so claudecodeui
 * sessions land next to the Desktop app's own sessions (visible in the Desktop
 * UI); override with `DSH_SESSIONS_ROOT` to isolate them elsewhere. The ACP
 * composition reads this root via `DSH_SNAPSHOT_SESSIONS_ROOT`, so every
 * reader (synchronizer / history / watcher) must use this same root.
 */
export const getDshSessionsRoot = (): string => {
  const override = process.env.DSH_SESSIONS_ROOT?.trim();
  if (override) {
    return override;
  }
  const desktopHarness = process.env.DSH_HOME?.trim()
    || path.join(os.homedir(), 'Library', 'Application Support', 'dsh-desktop', 'harness');
  return path.join(desktopHarness, 'sessions');
};

/** Provider registry model adapter for DSH predefined models and active config. */
export class DshProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    // `DSH_MODEL` mirrors the `model` key of the ACP demo composition so the
    // default pick stays aligned with what the harness actually runs.
    const configuredModel = process.env.DSH_MODEL?.trim();
    if (!configuredModel) {
      return DSH_PREDEFINED_MODELS;
    }

    return {
      OPTIONS: DSH_PREDEFINED_MODELS.OPTIONS.some((option) => option.value === configuredModel)
        ? DSH_PREDEFINED_MODELS.OPTIONS
        : [{ value: configuredModel, label: configuredModel }, ...DSH_PREDEFINED_MODELS.OPTIONS],
      DEFAULT: configuredModel,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
