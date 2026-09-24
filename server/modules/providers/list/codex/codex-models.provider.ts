import { readFile } from 'node:fs/promises';
import path from 'node:path';

import TOML from '@iarna/toml';

import { providerSettingsSourceService } from '@/modules/providers/services/provider-settings-source.service.js';
import { DEFAULT_CODEX_CONFIG_PATH, resolveCodexConfigOverrides } from '@/shared/codex-config.js';
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
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Most capable frontier agentic coding model.',
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

  /**
   * The base `config.toml` plus whatever the user's selected profile overrides.
   *
   * The profile is read through the same `-c` overrides the runtime hands the
   * CLI, so the catalog the composer shows and the process that actually runs
   * agree on which endpoint and model are in effect. Falls back to the base
   * config when no profile is selected or the file contributes nothing.
   */
  private async readEffectiveConfig(): Promise<CodexConfig | null> {
    const base = await readCodexConfig(this.configPath);
    const profilePath = providerSettingsSourceService.resolveActiveSettingsFile('codex');
    if (!profilePath) {
      return base;
    }

    const overrides = await resolveCodexConfigOverrides(profilePath, this.configPath);
    if (!overrides) {
      return base;
    }

    // A relative `model_catalog_json` is already resolved against the declaring
    // file by resolveCodexConfigOverrides, matching how readCodexConfig resolves
    // the base value against this.configPath.
    const model = readOptionalString(overrides.model) ?? base?.model;
    const modelCatalogPath = readOptionalString(overrides.model_catalog_json) ?? base?.modelCatalogPath;
    const modelReasoningEffort = readOptionalString(overrides.model_reasoning_effort)
      ?? base?.modelReasoningEffort;

    return model ? { model, modelCatalogPath, modelReasoningEffort } : base;
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const config = await this.readEffectiveConfig();
    if (!config) {
      return CODEX_PREDEFINED_MODELS;
    }

    // Curated entries always win over a CC Switch catalog copy of the same
    // model, so an overlap keeps the maintained label and effort metadata
    // instead of surfacing the raw catalog entry again.
    const predefinedByValue = new Map(
      CODEX_PREDEFINED_MODELS.OPTIONS.map((option) => [option.value, option] as const),
    );

    // Catalog JSON entries that are not duplicates of a curated model, ordered
    // like the catalog file and deduped by slug.
    const configOptions: ProviderModelOption[] = [];
    const addedValues = new Set<string>();
    const pushUnique = (option: ProviderModelOption): void => {
      if (addedValues.has(option.value)) {
        return;
      }
      addedValues.add(option.value);
      configOptions.push(option);
    };

    if (config.modelCatalogPath) {
      for (const option of await readCodexCatalogModels(config.modelCatalogPath)) {
        pushUnique(predefinedByValue.get(option.value) ?? option);
      }
    }

    // A configured model the curated catalog already knows needs no extra row:
    // it renders in place from the curated list. Only a model outside that
    // catalog (e.g. a third-party one switched in via CC Switch) gets a leading
    // entry so "what is Codex set to?" stays visible.
    if (config.model && !predefinedByValue.has(config.model)) {
      const existingIndex = configOptions.findIndex((option) => option.value === config.model);
      if (existingIndex >= 0) {
        const [activeOption] = configOptions.splice(existingIndex, 1);
        configOptions.unshift(activeOption);
      } else {
        configOptions.unshift({
          value: config.model,
          label: config.model,
          description: 'Configured in ~/.codex/config.toml',
        });
      }
    }

    const remainingPredefined = CODEX_PREDEFINED_MODELS.OPTIONS.filter(
      (option) => !addedValues.has(option.value),
    );
    const options = [...configOptions, ...remainingPredefined];

    // Mirror `model_reasoning_effort` from config.toml as the default reasoning
    // effort of whichever entry represents the configured model, when the value
    // is among that model's supported levels.
    if (config.model && config.modelReasoningEffort) {
      const configuredIndex = options.findIndex((option) => option.value === config.model);
      if (configuredIndex >= 0) {
        const configuredOption = options[configuredIndex];
        const effortValues = configuredOption.effort?.values ?? [];
        if (
          effortValues.length > 0
          && effortValues.some((level) => level.value === config.modelReasoningEffort)
        ) {
          options[configuredIndex] = {
            ...configuredOption,
            effort: {
              ...(configuredOption.effort ?? { values: effortValues }),
              default: config.modelReasoningEffort,
            },
          };
        }
      }
    }

    return {
      OPTIONS: options,
      DEFAULT: config.model ?? CODEX_PREDEFINED_MODELS.DEFAULT,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const config = await this.readEffectiveConfig();
    if (config?.model) {
      return {
        model: config.model,
      };
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
