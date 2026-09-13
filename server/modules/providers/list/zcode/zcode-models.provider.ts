import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  AppError,
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * Curated ZCode fallback catalog.
 *
 * The authoritative catalog lives in the user's `~/.zcode/cli/config.json`
 * (`provider.<id>.models`); this tiny mirror keeps the picker usable when that
 * document is missing or unreadable. ZCode's own first-run defaults point at
 * Z.AI's `zai` provider, so the fallback matches that rather than inventing a
 * model the CLI would reject.
 */
export const ZCODE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'zai/glm-5.1',
      label: 'GLM-5.1',
      description: 'Z.AI Coding Plan default model.',
      group: 'zai',
    },
  ],
  DEFAULT: 'zai/glm-5.1',
};

/** Expands a leading `~` and resolves a config-provided path against `baseDir`. */
const resolveUserPath = (value: string, baseDir: string): string => {
  const trimmed = value.trim();
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
};

let homeDirOverride: string | null = null;

/**
 * Points ZCode's storage root at a caller-supplied directory (tests only).
 * Pass `null` to restore `~/.zcode`.
 */
export function setZcodeHomeDirForTests(dir: string | null): void {
  homeDirOverride = dir;
}

/**
 * ZCode's storage root, which holds the CLI config, session database, and
 * skills.
 *
 * Always `~/.zcode`. `ZCODE_STORAGE_DIR` deliberately does NOT relocate this:
 * verified against ZCode 0.16.5, a headless run with `ZCODE_STORAGE_DIR` (and
 * even `ZCODE_ENV=beta`) still read `~/.zcode/cli/config.json` and wrote
 * `~/.zcode/cli/db/db.sqlite` — the override only moves auxiliary state such as
 * the plugin cache. Honoring it here would make CloudCLI read a different
 * config/database than the CLI actually uses.
 */
export function getZcodeHomeDir(): string {
  return homeDirOverride ?? path.join(os.homedir(), '.zcode');
}

/**
 * Path of the CLI user config (`<storage root>/cli/config.json`).
 *
 * The CLI reads exactly this file for providers, models, MCP servers, and
 * permission settings; the desktop app's own config under `~/.zcode/v2` is a
 * separate document the CLI does not consume.
 */
export function getZcodeConfigPath(): string {
  return path.join(getZcodeHomeDir(), 'cli', 'config.json');
}

/** Reads and parses the CLI user config, or `null` when missing/unreadable/not an object. */
export function readZcodeConfig(): AnyRecord | null {
  try {
    return readObjectRecord(JSON.parse(fs.readFileSync(getZcodeConfigPath(), 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Resolves the ZCode session SQLite database.
 *
 * `storage.sessionDbPath` wins when configured (the CLI's own override),
 * otherwise the default `<storage root>/cli/db/db.sqlite` applies. `~` and
 * relative values are expanded the same way the CLI resolves them.
 */
export function getZcodeDatabasePath(config: AnyRecord | null = readZcodeConfig()): string {
  const storage = readObjectRecord(config?.storage);
  const configured = readOptionalString(storage?.sessionDbPath);
  if (configured) {
    return resolveUserPath(configured, getZcodeHomeDir());
  }
  return path.join(getZcodeHomeDir(), 'cli', 'db', 'db.sqlite');
}

/** `<providerId>/<modelId>` value shared by the picker and the config key layout. */
const zcodeModelValue = (providerId: string, modelId: string): string => `${providerId}/${modelId}`;

/** Reads the `model.main` value, i.e. the model the CLI would run right now. */
export function readZcodeMainModel(config: AnyRecord | null = readZcodeConfig()): string | null {
  return readOptionalString(readObjectRecord(config?.model)?.main) ?? null;
}

/**
 * Builds the model catalog from the user's ZCode config.
 *
 * Every model declared under `provider.<id>.models` is offered, tagged with its
 * channel so the composer can group the two providers that often share model
 * ids (both `ark` and `deepseek` ship a `deepseek-v4-flash`). The catalog is a
 * faithful mirror of the CLI's own config: anything listed here is something
 * the user made available to ZCode.
 *
 * `DEFAULT` stays `model.main`, the model a run uses when the caller does not
 * ask for a different one — see {@link resolveZcodeModelEnv} for how a
 * selection reaches a run, since headless ZCode has no model flag.
 *
 * Returns `null` when the config yields no model, so callers fall back to
 * {@link ZCODE_PREDEFINED_MODELS}.
 */
export function loadZcodeModels(): ProviderModelsDefinition | null {
  const config = readZcodeConfig();
  if (!config) {
    return null;
  }

  const configuredMain = readZcodeMainModel(config);
  const providers = readObjectRecord(config.provider);
  const options: ProviderModelOption[] = [];

  for (const [providerId, rawProvider] of Object.entries(providers ?? {})) {
    const models = readObjectRecord(readObjectRecord(rawProvider)?.models);
    if (!models) {
      continue;
    }
    for (const [modelId, rawModel] of Object.entries(models)) {
      const name = readOptionalString(readObjectRecord(rawModel)?.name);
      options.push({
        value: zcodeModelValue(providerId, modelId),
        label: name ?? modelId,
        group: providerId,
      });
    }
  }

  if (options.length === 0) {
    return null;
  }

  // `model.main` may name a model that no longer exists; the catalog still
  // reports it as the default so the UI shows what the CLI would actually run.
  return { OPTIONS: options, DEFAULT: configuredMain ?? options[0]!.value };
}

/**
 * Builds the environment that makes one headless run use `model`.
 *
 * ZCode has no model flag, but it does expose a per-invocation channel: the
 * `ZCODE_MODEL` / `ZCODE_BASE_URL` / `ZCODE_API_KEY` trio overrides the config's
 * model layer for that process only. Verified against 0.16.5 — all three are
 * required, and the channel is self-contained (the `<provider>/` prefix is
 * carried through as a label, connectivity comes from the base URL and key
 * alone), so nothing in `~/.zcode/cli/config.json` is read for the model and
 * nothing there is written.
 *
 * Returns `null` when no override is needed, i.e. when the caller asked for the
 * model `model.main` already selects — that path is left to the config, which
 * also carries provider headers, timeouts, and request signing.
 *
 * Throws when the model's channel cannot supply a base URL and key, because
 * silently falling back to `model.main` would run a different model than the
 * user picked.
 */
export function resolveZcodeModelEnv(model: string): Record<string, string> | null {
  const target = model.trim();
  if (!target) {
    return null;
  }

  const config = readZcodeConfig();
  if (!config || readZcodeMainModel(config) === target) {
    return null;
  }

  const separatorIndex = target.indexOf('/');
  const providerId = separatorIndex > 0 ? target.slice(0, separatorIndex) : '';
  const provider = readObjectRecord(readObjectRecord(config.provider)?.[providerId]);
  const options = readObjectRecord(provider?.options);
  const baseURL = readOptionalString(options?.baseURL);
  const apiKey = readOptionalString(options?.apiKey);

  if (!providerId || !baseURL || !apiKey) {
    throw new AppError(
      `ZCode cannot run ${target}: no provider "${providerId || target}" with options.baseURL and options.apiKey in ${getZcodeConfigPath()}.`,
      { code: 'ZCODE_MODEL_CHANNEL_UNRESOLVED', statusCode: 400 },
    );
  }

  return { ZCODE_MODEL: target, ZCODE_BASE_URL: baseURL, ZCODE_API_KEY: apiKey };
}

/** Provider registry model adapter for ZCode's config-driven catalog. */
export class ZcodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return loadZcodeModels() ?? ZCODE_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    // Headless runs always use `model.main`, and that key is global rather than
    // per-session, so the config value is the active model for every session.
    const configuredMain = readZcodeMainModel();
    if (configuredMain) {
      return { model: configuredMain };
    }
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
