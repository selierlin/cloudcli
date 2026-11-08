import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { AnyRecord } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

/** Absolute path of Codex's own configuration file, the layer a profile is applied over. */
export const DEFAULT_CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

/**
 * A TOML-shaped value the CLI's config override accepts.
 *
 * Declared here rather than imported from the SDK: the values are handed to the
 * CLI's own `config` field, so the shape is the protocol's, and it has to keep
 * compiling once the SDK dependency is gone.
 */
export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };

/** A config override table: keys map to the TOML values the CLI merges into its own config. */
export type CodexConfigOverrides = { [key: string]: CodexConfigValue };

/**
 * Top-level `config.toml` keys a profile file may override.
 *
 * Deliberately a whitelist: `--config` unions tables with the base config and
 * cannot remove a key, so forwarding `mcp_servers`, `projects`, `plugins` or
 * `shell_environment_policy` would only merge extra entries into the user's
 * existing set-ups. Only the keys that decide which endpoint and model a run
 * targets are forwarded.
 */
const PROFILE_OVERRIDE_KEYS = [
  'model',
  'model_provider',
  'model_reasoning_effort',
  'model_catalog_json',
  'disable_response_storage',
  'web_search',
] as const;

/**
 * Prefix for a profile-defined provider table whose key the base config already
 * defines. The CLI merges same-named tables, so a shared key would silently
 * inherit base-only fields (headers, bearer tokens) — the prefixed copy stays
 * independent of the base definition.
 */
const PROVIDER_KEY_NAMESPACE = 'cloudcli__';

const readTomlRecord = async (filePath: string): Promise<AnyRecord | null> => {
  try {
    return readObjectRecord(TOML.parse(await readFile(filePath, 'utf8')));
  } catch {
    return null;
  }
};

/** Narrows a parsed TOML value to the scalar/array/table shapes a config override accepts. */
const toOverrideValue = (value: unknown): CodexConfigValue | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const items: CodexConfigValue[] = [];
    for (const item of value) {
      const converted = toOverrideValue(item);
      if (converted === undefined) {
        return undefined;
      }
      items.push(converted);
    }
    return items;
  }

  const record = readObjectRecord(value);
  if (!record) {
    return undefined;
  }

  const entries: [string, CodexConfigValue][] = [];
  for (const [key, entry] of Object.entries(record)) {
    const converted = toOverrideValue(entry);
    if (converted === undefined) {
      return undefined;
    }
    entries.push([key, converted]);
  }
  return Object.fromEntries(entries);
};

/** Keeps a provider key a bare TOML key so it can be emitted as a dotted config path. */
const sanitizeProviderKey = (key: string): string => key.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * Builds the structured overrides that layer one user-maintained Codex config
 * file over the base `~/.codex/config.toml`.
 *
 * The CLI exposes no usable `--profile` passthrough, so a selected profile is
 * translated into structured config overrides instead. The profile is a full
 * `config.toml` the user maintains by hand (CC Switch exports exactly that
 * shape), therefore only `PROFILE_OVERRIDE_KEYS` and the profile's own provider
 * tables are forwarded — everything else stays whatever the base config says.

 *
 * Returns null when the file is missing, malformed or contributes nothing: an
 * unconfigured host is a normal state, not an error. Callers then fall back to
 * Codex's own configuration.
 *
 * Used by the Codex runtime (to configure the CLI process) and the Codex model
 * catalog (so the composer lists the models the selected profile actually runs).
 */
export const resolveCodexConfigOverrides = async (
  profilePath: string,
  baseConfigPath: string = DEFAULT_CODEX_CONFIG_PATH,
): Promise<CodexConfigOverrides | null> => {
  const profile = await readTomlRecord(profilePath);
  if (!profile) {
    return null;
  }

  const overrides: CodexConfigOverrides = {};
  for (const key of PROFILE_OVERRIDE_KEYS) {
    const value = toOverrideValue(profile[key]);
    if (value !== undefined) {
      overrides[key] = value;
    }
  }

  // A relative `model_catalog_json` is relative to the file that declares it,
  // while the CLI resolves the override against CODEX_HOME.
  const catalogPath = readOptionalString(overrides.model_catalog_json);
  if (catalogPath && !path.isAbsolute(catalogPath)) {
    overrides.model_catalog_json = path.resolve(path.dirname(profilePath), catalogPath);
  }

  const profileProviders = readObjectRecord(profile.model_providers);
  if (profileProviders) {
    // The base file is read only to detect key collisions; a missing base file
    // means there is nothing to collide with.
    const baseProviders = readObjectRecord((await readTomlRecord(baseConfigPath))?.model_providers);
    const renamedProviders = new Map<string, string>();
    const providers: Record<string, CodexConfigValue> = {};

    for (const [key, definition] of Object.entries(profileProviders)) {
      const value = toOverrideValue(definition);
      if (value === undefined) {
        continue;
      }

      const targetKey = baseProviders && key in baseProviders
        ? `${PROVIDER_KEY_NAMESPACE}${sanitizeProviderKey(key)}`
        : key;
      renamedProviders.set(key, targetKey);
      providers[targetKey] = value;
    }

    if (Object.keys(providers).length > 0) {
      overrides.model_providers = providers;

      // Point the selection at whichever copy made it into the overrides.
      const selectedProvider = readOptionalString(overrides.model_provider);
      const targetKey = selectedProvider ? renamedProviders.get(selectedProvider) : undefined;
      if (targetKey) {
        overrides.model_provider = targetKey;
      }
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : null;
};

/** A TOML bare key, the only shape that can be written without quotes. */
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** Quotes a key segment only when TOML would not accept it bare. */
const toTomlKey = (key: string): string => (TOML_BARE_KEY.test(String(key)) ? key : JSON.stringify(key));

/** Renders one value as the TOML literal the CLI's `-c` parser expects. */
const toTomlValue = (value: CodexConfigValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(toTomlValue).join(', ')}]`;
  }
  if (typeof value === 'string') {
    // JSON string escaping is a subset of TOML basic-string escaping, so the
    // quoted form round-trips through the CLI's parser unchanged.
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    // Only a table inside an array reaches here: every standalone table is
    // flattened into dotted pairs before this runs.
    const fields = Object.entries(value).map(([key, entry]) => `${toTomlKey(key)} = ${toTomlValue(entry)}`);
    return `{ ${fields.join(', ')} }`;
  }
  return String(value);
};

/** Flattens nested override tables into dotted paths, the only form `-c` takes. */
const flattenOverrides = (
  overrides: CodexConfigOverrides,
  prefix: string,
  out: [string, CodexConfigValue][],
): void => {
  for (const [key, value] of Object.entries(overrides)) {
    const path = prefix ? `${prefix}.${toTomlKey(key)}` : toTomlKey(key);
    if (Array.isArray(value) || typeof value !== 'object') {
      out.push([path, value]);
      continue;
    }
    flattenOverrides(value, path, out);
  }
};

/**
 * Renders config overrides as the `-c key=value` pairs `codex app-server` accepts.
 *
 * Consumed by the Codex runtime, which starts one app-server per run. A profile
 * has to be on the command line and not only in `thread/start`'s `config`:
 * Codex 0.166 compares a thread's recorded `model_provider` against the provider
 * resolved at process start and refuses the turn with `modelProviderMismatch`
 * when they differ — an override handed over per request never reaches that
 * process-level value. The bearer token in a provider table therefore ends up
 * in this process's argv; it is already in the profile file the user maintains.
 */
export const toCodexConfigArgs = (overrides: CodexConfigOverrides): string[] => {
  const pairs: [string, CodexConfigValue][] = [];
  flattenOverrides(overrides, '', pairs);
  const args: string[] = [];
  for (const [path, value] of pairs) {
    args.push('-c', `${path}=${toTomlValue(value)}`);
  }
  return args;
};
