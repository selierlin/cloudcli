import fs from 'node:fs/promises';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Provider-level custom settings source (the `claude --settings` equivalent).
 *
 * A user who routes a provider through several relays keeps one config file per
 * relay (base URL, auth token, default model, …) and points CloudCLI at the file
 * it should load for every run. Because the files are user-maintained, CloudCLI
 * stores only *references* — the optional directory it should scan for profile
 * files plus which discovered/typed file is currently active.
 *
 * Discovery is per-provider (see `PROFILE_FILE_CONVENTIONS`); how a resolved
 * file is applied is entirely up to the provider runtime.
 *
 * Persistence is intentionally provider-scoped but user-agnostic: like provider
 * sessions, the selection is a single global value (this is a local-first app),
 * stored in the global `app_config` KV. No credentials ever pass through here —
 * they live in the user's own config files.
 */

export type ProviderSettingsSourceProfile = {
  /** User-facing label, e.g. `settings-glm.json` -> `glm`. */
  name: string;
  /** Absolute path of the profile file. */
  path: string;
};

export type ProviderSettingsSource = {
  /** Directory scanned for this provider's profile files, or null. */
  directory: string | null;
  /** Config file applied on every run of this provider, or null. */
  activeFile: string | null;
  /** Profiles discovered in `directory`. */
  profiles: ProviderSettingsSourceProfile[];
  /** Set when a configured directory cannot be read (informational). */
  directoryError: string | null;
};

/**
 * Naming convention for the profile files scanned in a provider's configured
 * directory. Every provider keeps one file per relay/provider side by side and
 * CloudCLI lists them, so nothing has to be registered by hand.
 */
type ProfileFileConvention = {
  /** Matches a profile file name, e.g. `settings-glm.json`. */
  pattern: RegExp;
  /** Strips the extension before the profile label is derived. */
  extensionPattern: RegExp;
  /** Strips the leading prefix so `settings-glm.json` is labelled `glm`. */
  prefixPattern: RegExp;
};

/**
 * Providers whose config files can be discovered and switched from the
 * settings UI. A provider absent from this map has no scan rule, so its
 * profile list simply stays empty.
 *
 * Claude is pointed at its file per run (`--settings <path>`). Codex has no
 * usable equivalent flag through the SDK, so its selected file is read and
 * layered over `~/.codex/config.toml` as `-c` overrides instead.
 */
const PROFILE_FILE_CONVENTIONS: Partial<Record<LLMProvider, ProfileFileConvention>> = {
  // Matches `settings-glm.json` and tolerates the singular `setting-glm.json`.
  claude: {
    pattern: /^settings?-.*\.json$/i,
    extensionPattern: /\.json$/i,
    prefixPattern: /^settings?-?/i,
  },
  // Matches one `config-<name>.toml` per provider; the plain `config.toml`
  // base file is never listed as a profile.
  codex: {
    pattern: /^config-.*\.toml$/i,
    extensionPattern: /\.toml$/i,
    prefixPattern: /^config-?/i,
  },
};

const directoryKey = (provider: string): string => `${provider}.settings.directory`;
const activeFileKey = (provider: string): string => `${provider}.settings.activeFile`;

function readNullableKey(key: string): string | null {
  const value = appConfigDb.get(key)?.trim();
  return value && value.length > 0 ? value : null;
}

function profileNameFromFile(fileName: string, convention: ProfileFileConvention): string {
  const withoutExtension = fileName.replace(convention.extensionPattern, '');
  const withoutPrefix = withoutExtension.replace(convention.prefixPattern, '');
  return withoutPrefix.length > 0 ? withoutPrefix : withoutExtension;
}

async function readDirectory(
  directory: string,
  convention: ProfileFileConvention,
): Promise<ProviderSettingsSourceProfile[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new AppError(`Cannot read settings directory: ${directory}`, {
      code: 'SETTINGS_DIRECTORY_UNREADABLE',
      statusCode: 400,
    });
  }

  return entries
    .filter((entry) => entry.isFile() && convention.pattern.test(entry.name))
    .map((entry) => ({
      name: profileNameFromFile(entry.name, convention),
      path: path.join(directory, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const providerSettingsSourceService = {
  /**
   * Current configured source (directory + active file) plus a live scan of the
   * directory. Never throws on an unreadable directory — the error is surfaced
   * on the payload so the settings UI can show it without losing the form.
   */
  async getSource(providerName: LLMProvider): Promise<ProviderSettingsSource> {
    const directory = readNullableKey(directoryKey(providerName));
    const activeFile = readNullableKey(activeFileKey(providerName));
    const convention = PROFILE_FILE_CONVENTIONS[providerName];

    let profiles: ProviderSettingsSourceProfile[] = [];
    let directoryError: string | null = null;
    if (directory && convention) {
      try {
        profiles = await readDirectory(directory, convention);
      } catch (error) {
        directoryError = error instanceof Error ? error.message : String(error);
      }
    }

    return { directory, activeFile, profiles, directoryError };
  },

  /**
   * Updates the configured source. `undefined` keeps the current value; an empty
   * string clears it. A non-empty directory must exist and be readable.
   * Returns the freshly computed source.
   */
  async updateSource(
    providerName: LLMProvider,
    input: { directory?: string; activeFile?: string },
  ): Promise<ProviderSettingsSource> {
    if (input.directory !== undefined) {
      const directory = input.directory.trim();
      if (directory.length > 0) {
        let stat;
        try {
          stat = await fs.stat(directory);
        } catch {
          throw new AppError(`Settings directory does not exist: ${directory}`, {
            code: 'SETTINGS_DIRECTORY_INVALID',
            statusCode: 400,
          });
        }
        if (!stat.isDirectory()) {
          throw new AppError(`Settings path is not a directory: ${directory}`, {
            code: 'SETTINGS_DIRECTORY_INVALID',
            statusCode: 400,
          });
        }
      }

      if (directory.length > 0) {
        appConfigDb.set(directoryKey(providerName), directory);
      } else {
        appConfigDb.set(directoryKey(providerName), '');
      }
    }

    if (input.activeFile !== undefined) {
      const activeFile = input.activeFile.trim();
      appConfigDb.set(activeFileKey(providerName), activeFile);
    }

    return this.getSource(providerName);
  },

  /**
   * Resolves the settings file a run of this provider should load, or null.
   * Synchronous so provider runtimes can read it per run without awaiting.
   * Existence is deliberately NOT checked here — runtimes decide whether a
   * missing file is fatal or skippable.
   */
  resolveActiveSettingsFile(providerName: LLMProvider): string | null {
    return readNullableKey(activeFileKey(providerName));
  },
};
