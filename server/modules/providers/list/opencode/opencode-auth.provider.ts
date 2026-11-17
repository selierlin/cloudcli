import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getOpenCodeDataDir,
  hasFileCredential,
  listConfiguredProviders,
  readOpenCodeConfigs,
  type OpenCodeCredential,
} from '@/modules/providers/list/opencode/opencode-config.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { probeCliVersion, readObjectRecord, readOptionalString } from '@/shared/utils.js';

type OpenCodeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

const OPENCODE_ENV_CREDENTIAL_KEYS = [
  'OPENCODE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
];

/** Global OpenCode config files, in the order the CLI loads them. */
const OPENCODE_CONFIG_FILES = ['config.json', 'opencode.json', 'opencode.jsonc'];

/**
 * Whether a configured `apiKey` resolves to a key. Only presence is checked:
 * no key value is read into, logged or returned by this process.
 */
const isCredentialPresent = async (credential: OpenCodeCredential): Promise<boolean> => {
  switch (credential.kind) {
    case 'literal':
      return true;
    case 'env':
      return Boolean(process.env[credential.name]?.trim());
    case 'file':
      return hasFileCredential(credential);
    default:
      return false;
  }
};

export class OpenCodeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the OpenCode CLI is available to the server process, and
   * which version it is. Unlike the other CLIs it has always needed a clean
   * `--version` exit to count as installed.
   */
  checkInstalled(): CliVersionProbe {
    const probe = probeCliVersion('opencode');
    return { ...probe, installed: probe.exitCode === 0 };
  }

  /**
   * Returns OpenCode CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const { installed, version: installedVersion } = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'opencode',
      installedVersion,
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads OpenCode's auth store, then provider API key environment variables,
   * then provider keys in OpenCode's config (v1 `provider` or v2 `providers`).
   */
  private async checkCredentials(): Promise<OpenCodeCredentialsStatus> {
    try {
      const authPath = path.join(getOpenCodeDataDir(), 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};

      for (const [providerId, providerAuth] of Object.entries(auth)) {
        const providerRecord = readObjectRecord(providerAuth);
        if (!providerRecord) {
          continue;
        }

        const hasCredential = Object.values(providerRecord).some(
          (value) => readOptionalString(value) !== undefined || Boolean(readObjectRecord(value)),
        );
        if (hasCredential) {
          return {
            authenticated: true,
            email: `${providerId} credentials`,
            method: 'credentials_file',
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false,
          email: null,
          method: null,
          error: error instanceof Error ? error.message : 'Failed to read OpenCode auth',
        };
      }
    }

    const envCredential = OPENCODE_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return {
        authenticated: true,
        email: envCredential,
        method: 'environment',
      };
    }

    for (const { id, credential } of listConfiguredProviders(await readOpenCodeConfigs())) {
      if (await isCredentialPresent(credential)) {
        return {
          authenticated: true,
          email: `${id} credentials`,
          method: 'config_file',
        };
      }
    }

    // A provider declared with options in OpenCode's own global config is
    // connected without an auth-store entry even when its `options` carry no
    // credential this app can read (a key it does not understand, or a local
    // endpoint that needs none). `opencode-models.provider.ts` already reads
    // these same files to decide which models the picker may offer, so
    // omitting them here made the status badge contradict the model list on
    // every install configured this way.
    if (await this.hasConfiguredProvider()) {
      return {
        authenticated: true,
        // No account exists to name here: the credential is whatever the
        // user's own config points at. The UI reports the source itself
        // rather than printing a provider id as if it were a user.
        email: null,
        method: 'opencode_config',
      };
    }

    return {
      authenticated: false,
      email: null,
      method: null,
      error: 'OpenCode not configured',
    };
  }

  /**
   * Reports whether OpenCode's global config declares a provider it can route
   * with, i.e. a `provider.<id>` block carrying options such as a `baseURL` or
   * an `apiKey` (possibly a `{file:...}` reference).
   *
   * A block that only declares `models` is skipped: it describes what the user
   * wants to pick, not a connection, and reporting it as configured would
   * claim a credential the install may not have.
   */
  private async hasConfiguredProvider(): Promise<boolean> {
    const configDir = path.join(os.homedir(), '.config', 'opencode');

    for (const configFile of OPENCODE_CONFIG_FILES) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path.join(configDir, configFile), 'utf8'));
      } catch {
        // Missing, unreadable, or comment-bearing (.jsonc) files contribute
        // nothing; the remaining candidates and the env fallback still apply.
        continue;
      }

      const providers = readObjectRecord(readObjectRecord(parsed)?.provider) ?? {};
      for (const rawProvider of Object.values(providers)) {
        const options = readObjectRecord(readObjectRecord(rawProvider)?.options);
        if (options && Object.keys(options).length > 0) {
          return true;
        }
      }
    }

    return false;
  }
}
