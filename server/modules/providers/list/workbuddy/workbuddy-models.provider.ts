import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { applySharedModelDescriptions } from '@/shared/model-descriptions.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated list of models WorkBuddy exposes in its chat model picker.
 *
 * WorkBuddy's engine caches a full multi-vendor routing catalog locally, but
 * that catalog is unfiltered (it also lists Claude, Hunyuan, Codewise, image
 * and completion models) and carries no flag marking which models are actually
 * surfaced to users. The desktop client obtains its curated list from a
 * different server layer, not from that cache. So, like every other provider in
 * this repo, WorkBuddy uses a static curated list as the single source of truth
 * for the model picker.
 *
 * Keep this in sync with the models WorkBuddy actually exposes: add or remove an
 * entry here whenever WorkBuddy's lineup changes.
 *
 * Picker subtitles (credit multipliers) live in the shared
 * `CHANNEL_MODEL_DESCRIPTIONS` map keyed by `workbuddy/<model id>`, so any
 * harness that reaches the WorkBuddy gateway shows the same subtitle without
 * redefining it here. It is a 2026-10-02 snapshot: re-read the engine's
 * `credits` field whenever WorkBuddy reprices a model.
 */
export const WORKBUDDY_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'auto',
      label: 'Auto (recommended)',
    },
    {
      // Engine-side id is `hy4-preview`, not `hy4`: the gateway rejects a bare
      // `hy4` with 11102 "model service info not found".
      value: 'hy4-preview',
      label: 'Hy4 preview',
      effort: { values: [{ value: 'low' }, { value: 'high' }], default: 'high' },
    },
    {
      value: 'hy3',
      label: 'Hy3',
      effort: { values: [{ value: 'low' }, { value: 'high' }], default: 'high' },
    },
    {
      value: 'space-bunny',
      label: 'Space-Bunny',
      effort: {
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' }],
        default: 'max',
      },
    },
    {
      value: 'glm-5.3',
      label: 'GLM-5.3',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }],
        default: 'high',
      },
    },
    {
      value: 'glm-5.3-flash',
      label: 'GLM-5.3-Flash',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }],
        default: 'high',
      },
    },
    {
      value: 'glm-5.2',
      label: 'GLM-5.2',
      effort: { values: [{ value: 'high' }, { value: 'xhigh' }], default: 'high' },
    },
    {
      value: 'glm-5.1',
      label: 'GLM-5.1',
    },
    {
      value: 'glm-5v-turbo',
      label: 'GLM-5v-Turbo',
    },
    {
      value: 'minimax-m3',
      label: 'MiniMax-M3',
    },
    {
      value: 'kimi-k3-1',
      label: 'Kimi-K3',
      effort: {
        values: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }],
        default: 'high',
      },
    },
    {
      value: 'kimi-k2.8-preview',
      label: 'Kimi-K2.8-Preview',
      effort: { values: [{ value: 'low' }, { value: 'high' }, { value: 'max' }], default: 'high' },
    },
    {
      value: 'kimi-k2.7',
      label: 'Kimi-K2.7-Code',
    },
    {
      value: 'kimi-k2.6',
      label: 'Kimi-K2.6',
    },
    {
      value: 'deepseek-v4.1-flash',
      label: 'Deepseek-V4.1-Flash',
      effort: { values: [{ value: 'high' }, { value: 'xhigh' }], default: 'high' },
    },
    {
      value: 'deepseek-v4-flash',
      label: 'Deepseek-V4-Flash',
      effort: { values: [{ value: 'high' }, { value: 'xhigh' }], default: 'high' },
    },
    {
      value: 'deepseek-v4-pro',
      label: 'Deepseek-V4-Pro',
      effort: { values: [{ value: 'high' }, { value: 'xhigh' }], default: 'high' },
    },
  ],
  DEFAULT: 'auto',
};

/** Provider registry model adapter for WorkBuddy, sourced from a curated static list. */
export class WorkbuddyProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return {
      ...WORKBUDDY_PREDEFINED_MODELS,
      OPTIONS: applySharedModelDescriptions(WORKBUDDY_PREDEFINED_MODELS.OPTIONS, 'workbuddy'),
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
