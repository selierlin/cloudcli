import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/** Curated Codex catalog shipped as immutable CloudCLI defaults. */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4',
      label: 'GPT-5.4',
      description: 'Strong model for everyday coding.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.4-mini',
      label: 'GPT-5.4 Mini',
      description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

const DEFAULT_CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

/**
 * The subset of `~/.codex/config.toml` that describes which model Codex is
 * configured to run and where its model catalog JSON lives. CC Switch and other
 * config managers write both fields, so this is what makes the UI's Codex list
 * reflect the tool's real configuration instead of only the curated defaults.
 */
type CodexConfig = {
  model?: string;
  modelCatalogPath?: string;
  modelReasoningEffort?: string;
};

const readCodexConfig = async (configPath: string): Promise<CodexConfig | null> => {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = readObjectRecord(TOML.parse(raw));
    if (!parsed) {
      return null;
    }

    const model = readOptionalString(parsed.model);
    const catalogFile = readOptionalString(parsed.model_catalog_json);

    return {
      model,
      modelCatalogPath: catalogFile
        ? path.resolve(path.dirname(configPath), catalogFile)
        : undefined,
      modelReasoningEffort: readOptionalString(parsed.model_reasoning_effort),
    };
  } catch {
    return null;
  }
};

/**
 * Maps one entry of a Codex model catalog JSON (the file referenced by
 * `model_catalog_json` in `config.toml`, written by CC Switch and friends) to
 * a UI model option. `supported_reasoning_levels` becomes the effort picker
 * values so per-model reasoning limits survive into the composer.
 */
const toCatalogModelOption = (entry: unknown): ProviderModelOption | null => {
  const record = readObjectRecord(entry);
  if (!record) {
    return null;
  }

  const value = readOptionalString(record.slug);
  if (!value) {
    return null;
  }

  const label = readOptionalString(record.display_name) ?? value;
  const description = readOptionalString(record.description);
  const effortValues = (Array.isArray(record.supported_reasoning_levels)
    ? record.supported_reasoning_levels
    : []
  )
    .map((level): NonNullable<ProviderModelOption['effort']>['values'][number] | null => {
      const levelRecord = readObjectRecord(level);
      if (!levelRecord) {
        return null;
      }

      const effort = readOptionalString(levelRecord.effort);
      if (!effort) {
        return null;
      }

      return {
        value: effort,
        description: readOptionalString(levelRecord.description),
      };
    })
    .filter((level): level is NonNullable<ProviderModelOption['effort']>['values'][number] => level !== null);

  return {
    value,
    label,
    ...(description ? { description } : {}),
    ...(effortValues.length > 0 ? { effort: { values: effortValues } } : {}),
  };
};

const readCodexCatalogModels = async (catalogPath: string): Promise<ProviderModelOption[]> => {
  try {
    const raw = await readFile(catalogPath, 'utf8');
    const parsed = readObjectRecord(JSON.parse(raw) as unknown);
    const entries = Array.isArray(parsed?.models) ? parsed.models : [];
    return entries
      .map(toCatalogModelOption)
      .filter((option): option is ProviderModelOption => option !== null);
  } catch {
    return [];
  }
};

/** Provider registry model adapter for Codex config-driven and predefined models. */
export class CodexProviderModels implements IProviderModels {
  constructor(private readonly configPath: string = DEFAULT_CODEX_CONFIG_PATH) {}

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const config = await readCodexConfig(this.configPath);
    if (!config) {
      return CODEX_PREDEFINED_MODELS;
    }

    const configOptions: ProviderModelOption[] = [];
    if (config.modelCatalogPath) {
      configOptions.push(...(await readCodexCatalogModels(config.modelCatalogPath)));
    }

    // The model Codex is configured to use always leads the list, even when the
    // catalog JSON does not mention it, so "what is Codex currently set to?" is
    // the first thing a user sees after picking the Codex tool.
    if (config.model) {
      const existingIndex = configOptions.findIndex((option) => option.value === config.model);
      let activeOption: ProviderModelOption;
      if (existingIndex >= 0) {
        [activeOption] = configOptions.splice(existingIndex, 1);
      } else {
        activeOption = {
          value: config.model,
          label: config.model,
          description: 'Configured in ~/.codex/config.toml',
        };
      }

      // Mirror `model_reasoning_effort` from config.toml as the model's default
      // reasoning effort when the configured value is among the model's options.
      const effortValues = activeOption.effort?.values ?? [];
      if (
        config.modelReasoningEffort
        && effortValues.length > 0
        && effortValues.some((level) => level.value === config.modelReasoningEffort)
      ) {
        activeOption = {
          ...activeOption,
          effort: {
            ...(activeOption.effort ?? { values: effortValues }),
            default: config.modelReasoningEffort,
          },
        };
      }

      configOptions.unshift(activeOption);
    }

    const seenValues = new Set(configOptions.map((option) => option.value));
    const remainingPredefined = CODEX_PREDEFINED_MODELS.OPTIONS.filter(
      (option) => !seenValues.has(option.value),
    );

    return {
      OPTIONS: [...configOptions, ...remainingPredefined],
      DEFAULT: config.model ?? CODEX_PREDEFINED_MODELS.DEFAULT,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const config = await readCodexConfig(this.configPath);
    if (config?.model) {
      return {
        model: config.model,
      };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
