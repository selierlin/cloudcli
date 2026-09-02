import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated DSH fallback catalog. The authoritative model list lives in the
 * user's own `$DSH_HOME/settings.yaml` (loaded by {@link loadDshSettingsModels});
 * this mirror keeps the picker usable before that document exists and as a
 * last-resort fallback when it is unreadable.
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

/** Harness home the ACP server child and the session readers agree on. */
export const getDshHome = (): string =>
  process.env.DSH_HOME?.trim()
  || path.join(os.homedir(), '.dsh');

/**
 * Root where ACP sessions are persisted.
 *
 * Defaults to `$DSH_HOME/sessions`, matching where the npm `dsh --profile acp`
 * server writes its sessions, so cloudcli's synchronizer, history, and watcher
 * read the same files the harness produces; override with `DSH_SESSIONS_ROOT`
 * to isolate cloudcli sessions elsewhere.
 */
export const getDshSessionsRoot = (): string => {
  const override = process.env.DSH_SESSIONS_ROOT?.trim();
  if (override) {
    return override;
  }
  return path.join(getDshHome(), 'sessions');
};

/** Model value shared by the picker and the ACP `model` config route. */
const modelValue = (provider: string, model: string): string => `${provider}/${model}`;

const DSH_SETTINGS_FILENAME = 'settings.yaml';

/** Strips surrounding quotes and trailing ` #...` comments from a YAML scalar. */
const cleanScalar = (value: string): string =>
  value.split(/\s+#/)[0].trim().replace(/^['"]|['"]$/g, '');

/**
 * Reads the provider model catalog from `$DSH_HOME/settings.yaml` — the same
 * document the `dsh --profile acp` server composes its model options from.
 *
 * The settings document has a fixed shape, so this walks it line by line with
 * targeted matching (the same approach dsh-auth uses for `.credentials.yaml`)
 * instead of pulling in a YAML parser: `llm-pi-ai.providers.<id>.models[].id`
 * builds the options, and `agent-default-model` carries the default route.
 *
 * Returns `null` when the file is missing or declares no provider models, so
 * callers can fall back to the curated mirror instead of surfacing an empty
 * picker.
 */
export function loadDshSettingsModels(): ProviderModelsDefinition | null {
  let content: string;
  try {
    content = fs.readFileSync(path.join(getDshHome(), DSH_SETTINGS_FILENAME), 'utf8');
  } catch {
    return null;
  }

  const options: ProviderModelOption[] = [];
  let defaultProvider = '';
  let defaultModel = '';

  // Top-level section the current line belongs to.
  let section: 'llm-pi-ai' | 'agent-default-model' | null = null;
  // Within `llm-pi-ai`, the active provider id and whether its `models` block is open.
  let inProviders = false;
  let providerId = '';
  let providerIndent = -1;
  let inModels = false;

  const sectionHeader = /^([A-Za-z0-9_.-]+):\s*$/;
  const mapping = /^([A-Za-z0-9_.-]+):\s*(.*)$/;
  const modelItem = /^-\s+id:\s*(.*)$/;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const text = line.trim();
    if (!text || text.startsWith('#')) {
      continue;
    }
    const indent = line.length - text.length;
    const isTopLevel = indent === 0;

    const header = sectionHeader.exec(text);
    if (header) {
      const key = header[1];
      if (isTopLevel) {
        section = key === 'llm-pi-ai'
          ? 'llm-pi-ai'
          : key === 'agent-default-model'
            ? 'agent-default-model'
            : null;
        inProviders = false;
        providerId = '';
        providerIndent = -1;
        inModels = false;
        continue;
      }

      if (section !== 'llm-pi-ai') {
        continue;
      }
      if (key === 'providers') {
        inProviders = true;
        providerId = '';
        providerIndent = -1;
        inModels = false;
      } else if (inProviders && key === 'models') {
        inModels = true;
      } else if (inProviders && (providerIndent === -1 || indent <= providerIndent)) {
        // A bare key at (or shallower than) the last provider id starts a new provider.
        providerId = key;
        providerIndent = indent;
        inModels = false;
      }
      continue;
    }

    const entry = mapping.exec(text);
    if (entry) {
      const key = entry[1];
      const value = cleanScalar(entry[2]);
      if (section === 'agent-default-model') {
        if (key === 'provider') {
          defaultProvider = value;
        } else if (key === 'model') {
          defaultModel = value;
        }
      } else if (section === 'llm-pi-ai' && inProviders && key === 'models') {
        inModels = true;
      }
      continue;
    }

    const item = modelItem.exec(text);
    if (item && section === 'llm-pi-ai' && inModels && providerId) {
      const modelId = cleanScalar(item[1]);
      if (modelId) {
        options.push({ value: modelValue(providerId, modelId), label: modelId });
      }
    }
  }

  if (options.length === 0) {
    return null;
  }

  const defaultExists = Boolean(defaultProvider && defaultModel)
    && options.some((option) => option.value === modelValue(defaultProvider, defaultModel));

  return {
    OPTIONS: options,
    DEFAULT: defaultExists ? modelValue(defaultProvider, defaultModel) : options[0].value,
  };
}

/** Provider registry model adapter for DSH models from settings.yaml and the curated fallback. */
export class DshProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const catalog = loadDshSettingsModels() ?? DSH_PREDEFINED_MODELS;

    // `DSH_MODEL` overrides the picker default, keeping the env escape hatch
    // aligned with what the harness runs when the settings document is absent.
    const configuredModel = process.env.DSH_MODEL?.trim();
    if (!configuredModel) {
      return catalog;
    }

    return {
      OPTIONS: catalog.OPTIONS.some((option) => option.value === configuredModel)
        ? catalog.OPTIONS
        : [{ value: configuredModel, label: configuredModel }, ...catalog.OPTIONS],
      DEFAULT: configuredModel,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
