import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';
import type { CodexOptions } from '@openai/codex-sdk';

import type { AnyRecord } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

/** Absolute path of Codex's own configuration file, the layer a profile is applied over. */
export const DEFAULT_CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

/** Shape of the SDK's `CodexOptions.config` — TOML-shaped values it flattens into `--config key=value`. */
export type CodexConfigOverrides = NonNullable<CodexOptions['config']>;

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

/** Narrows a parsed TOML value to the scalar/array/table shapes `--config` accepts. */
const toOverrideValue = (value: unknown): CodexConfigOverrides[string] | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const items: CodexConfigOverrides[string][] = [];
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

  const entries: [string, CodexConfigOverrides[string]][] = [];
  for (const [key, entry] of Object.entries(record)) {
    const converted = toOverrideValue(entry);
    if (converted === undefined) {
      return undefined;
    }
    entries.push([key, converted]);
  }
  return Object.fromEntries(entries);
};

/** Keeps a provider key a bare TOML key so the SDK can emit it as a dotted `-c` path. */
const sanitizeProviderKey = (key: string): string => key.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * Builds the `-c` overrides that layer one user-maintained Codex config file
 * over the base `~/.codex/config.toml`.
 *
 * The SDK exposes no usable `--profile` passthrough, so a selected profile is
 * translated into structured `--config` overrides instead. The profile is a full
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
    const providers: Record<string, CodexConfigOverrides[string]> = {};

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
