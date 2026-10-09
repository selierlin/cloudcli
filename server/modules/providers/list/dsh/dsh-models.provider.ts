import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import {
  applySharedModelDescriptions,
  resolveChannelLabel,
} from '@/shared/model-descriptions.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel, readObjectRecord, readOptionalString } from '@/shared/utils.js';

/**
 * Curated DSH fallback catalog. The authoritative catalog is the harness's
 * own composed configuration (the `llm-pi-ai` routes and `agent-default-model`
 * the runtime boots, read through {@link buildDshModelsFromComposedEntries});
 * the legacy `$DSH_HOME/settings.yaml` (loaded by
 * {@link loadDshSettingsModels}) answers only when the composer is
 * unavailable. This mirror keeps the picker usable on a machine with neither.
 */
export const DSH_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
    },
    {
      value: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
    },
    {
      value: 'deepseek-v4-flash-vision-exp',
      label: 'DeepSeek V4 Flash Vision',
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
 * Profile the runtime boots, shared so every DSH config reader inspects the
 * same profile the sessions load; reading another profile's composition would
 * list servers the chat never receives.
 */
export const DSH_ACP_PROFILE = 'acp';

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

/** Channel prefix of a channel-qualified `<provider>/<model>` value, when present. */
const channelOf = (value: string): string | undefined => {
  const separatorIndex = value.indexOf('/');
  return separatorIndex > 0 ? value.slice(0, separatorIndex) : undefined;
};

const DSH_SETTINGS_FILENAME = 'settings.yaml';

/** Strips surrounding quotes and trailing ` #...` comments from a YAML scalar. */
const cleanScalar = (value: string): string =>
  value.split(/\s+#/)[0].trim().replace(/^['"]|['"]$/g, '');

/**
 * Reads the provider model catalog from the legacy `$DSH_HOME/settings.yaml`.
 *
 * DSH imports this document into the profile patch and renames it to
 * `settings.yaml.imported` the first time a boot sees it, so it is the live
 * source only until the composer takes over — {@link DshProviderModels} reads
 * the composed configuration first and falls back to this document. Its shape
 * is fixed, so this walks it line by line with targeted matching (the same
 * approach dsh-auth uses for `.credentials.yaml`) instead of pulling in a YAML
 * parser: `llm-pi-ai.providers.<id>.models[].id` builds the options, and
 * `agent-default-model` carries the default route. Each option is tagged with
 * its provider id as `group`, so the client separates same-named models that
 * different channels happen to share.
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
        options.push({
          value: modelValue(providerId, modelId),
          label: modelId,
          group: resolveChannelLabel(providerId),
        });
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

/**
 * Builds the picker catalog from the harness's composed loader entries.
 *
 * The `llm-pi-ai` entry's `config.providers` supplies the routes — each
 * provider's `models[]` ids become options tagged with that provider id as
 * `group` — and the `agent-default-model` entry's `config.provider` /
 * `config.model` names the default, mirroring how DSH itself resolves them.
 * Returns `null` when no route declares a model, so callers can fall back to
 * another source instead of surfacing an empty picker.
 *
 * Exported for the DSH model test, which drives it with recorded dump output.
 */
export function buildDshModelsFromComposedEntries(
  entries: Record<string, Record<string, unknown>>,
): ProviderModelsDefinition | null {
  const options: ProviderModelOption[] = [];
  const providers = readObjectRecord(readObjectRecord(entries['llm-pi-ai'])?.config)?.providers;
  for (const [providerId, profile] of Object.entries(readObjectRecord(providers) ?? {})) {
    const models = readObjectRecord(profile)?.models;
    if (!Array.isArray(models)) {
      continue;
    }
    for (const model of models) {
      const modelId = readOptionalString(readObjectRecord(model)?.id);
      if (modelId) {
        options.push({
          value: modelValue(providerId, modelId),
          label: modelId,
          group: resolveChannelLabel(providerId),
        });
      }
    }
  }

  if (options.length === 0) {
    return null;
  }

  const defaultConfig = readObjectRecord(readObjectRecord(entries['agent-default-model'])?.config);
  const defaultProvider = readOptionalString(defaultConfig?.provider);
  const defaultModel = readOptionalString(defaultConfig?.model);
  const defaultValue = defaultProvider && defaultModel ? modelValue(defaultProvider, defaultModel) : '';
  const defaultExists = Boolean(defaultValue)
    && options.some((option) => option.value === defaultValue);

  return {
    OPTIONS: options,
    DEFAULT: defaultExists ? defaultValue : options[0].value,
  };
}

/**
 * Provider registry model adapter for DSH models.
 *
 * The catalog comes from the harness's composed configuration (what the booted
 * profile actually serves), then the legacy `settings.yaml`, then the curated
 * mirror.
 */
export class DshProviderModels implements IProviderModels {
  /**
   * `readComposedEntries` returns the composed loader entries for the booted
   * profile, keyed by entry id (the DSH cordis reader's
   * `readDshComposedEntries`). It is injected by the provider registry rather
   * than imported here so this adapter and the composition reader do not form
   * an import cycle, and so tests can drive the catalog without spawning the
   * CLI.
   */
  constructor(
    private readonly readComposedEntries: () => Record<string, Record<string, unknown>>,
  ) {}

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const baseCatalog = this.loadConfiguredCatalog() ?? DSH_PREDEFINED_MODELS;
    const catalog = {
      ...baseCatalog,
      OPTIONS: applySharedModelDescriptions(baseCatalog.OPTIONS),
    };

    // `DSH_MODEL` overrides the picker default, keeping the env escape hatch
    // aligned with what the harness runs when the settings document is absent.
    // `DSH_MODEL` overrides the picker default, keeping the env escape hatch
    // aligned with what the harness runs when the settings document is absent.
    const configuredModel = process.env.DSH_MODEL?.trim();
    if (!configuredModel) {
      return catalog;
    }

    const configuredChannel = channelOf(configuredModel);
    return {
      OPTIONS: catalog.OPTIONS.some((option) => option.value === configuredModel)
        ? catalog.OPTIONS
        : [
            {
              value: configuredModel,
              label: configuredModel,
              ...(configuredChannel ? { group: resolveChannelLabel(configuredChannel) } : {}),
            },
            ...catalog.OPTIONS,
          ],
      DEFAULT: configuredModel,
    };
  }

  /**
   * Resolves the catalog from the harness's live configuration. The composed
   * tree the booted profile serves is authoritative; the legacy `settings.yaml`
   * only answers when the composer yields nothing (a machine without the CLI,
   * or a document DSH has not imported yet). An empty composed read is treated
   * as "no composition", not "no providers", so a profile that genuinely
   * declares none does not resurface a stale settings document.
   */
  private loadConfiguredCatalog(): ProviderModelsDefinition | null {
    const composed = this.readComposedEntries();
    if (Object.keys(composed).length > 0) {
      return buildDshModelsFromComposedEntries(composed);
    }
    return loadDshSettingsModels();
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
