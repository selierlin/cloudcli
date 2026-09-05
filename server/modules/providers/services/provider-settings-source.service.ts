import fs from 'node:fs/promises';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Provider-level custom settings source (the `claude --settings` equivalent).
 *
 * A user who routes Claude through several relays keeps one JSON settings file
 * per relay (base URL, auth token, …) and points CloudCLI at the file it should
 * load for every run. Because the files are user-maintained, CloudCLI stores
 * only *references* — the optional directory it should scan for `settings-*.json`
 * profiles plus which discovered/typed file is currently active.
 *
 * Persistence is intentionally provider-scoped but user-agnostic: like provider
 * sessions, the selection is a single global value (this is a local-first app),
 * stored in the global `app_config` KV. No credentials ever pass through here —
 * they live in the user's own settings files.
 */

export type ProviderSettingsSourceProfile = {
  /** User-facing label, e.g. `settings-glm.json` -> `glm`. */
  name: string;
  /** Absolute path of the settings file. */
  path: string;
};

export type ProviderSettingsSource = {
  /** Directory scanned for `settings-*.json` profiles, or null. */
  directory: string | null;
  /** Settings file loaded on every run of this provider, or null. */
  activeFile: string | null;
  /** Profiles discovered in `directory`. */
  profiles: ProviderSettingsSourceProfile[];
  /** Set when a configured directory cannot be read (informational). */
  directoryError: string | null;
};

/** Matches `settings-glm.json` and tolerates the singular `setting-glm.json`. */
const SETTINGS_FILE_PATTERN = /^settings?-.*\.json$/i;
const SETTINGS_PREFIX_PATTERN = /^settings?-?/i;

const directoryKey = (provider: string): string => `${provider}.settings.directory`;
const activeFileKey = (provider: string): string => `${provider}.settings.activeFile`;

function readNullableKey(key: string): string | null {
  const value = appConfigDb.get(key)?.trim();
  return value && value.length > 0 ? value : null;
}

function profileNameFromFile(fileName: string): string {
  const withoutExtension = fileName.replace(/\.json$/i, '');
  const withoutPrefix = withoutExtension.replace(SETTINGS_PREFIX_PATTERN, '');
  return withoutPrefix.length > 0 ? withoutPrefix : withoutExtension;
}

async function readDirectory(directory: string): Promise<ProviderSettingsSourceProfile[]> {
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
    .filter((entry) => entry.isFile() && SETTINGS_FILE_PATTERN.test(entry.name))
    .map((entry) => ({
      name: profileNameFromFile(entry.name),
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

    let profiles: ProviderSettingsSourceProfile[] = [];
    let directoryError: string | null = null;
    if (directory) {
      try {
        profiles = await readDirectory(directory);
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
