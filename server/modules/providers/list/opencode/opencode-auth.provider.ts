import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

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

export class OpenCodeProviderAuth implements IProviderAuth {
  /**
   * Checks whether the OpenCode CLI is available to the server process.
   */
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('opencode', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns OpenCode CLI installation and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'opencode',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads OpenCode's auth store or falls back to provider API key environment variables.
   */
  private async checkCredentials(): Promise<OpenCodeCredentialsStatus> {
    try {
      const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
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

    // A provider declared with options in OpenCode's own global config is
    // connected without an auth-store entry: its `apiKey` may even be a
    // `{file:...}` reference, which is how dotfiles-managed installs keep the
    // key out of the repo. `opencode-models.provider.ts` already reads these
    // same files (in this same load order) to decide which models the picker
    // may offer, so omitting them here made the status badge contradict the
    // model list on every install configured this way.
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

    const envCredential = OPENCODE_ENV_CREDENTIAL_KEYS.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return {
        authenticated: true,
        email: envCredential,
        method: 'environment',
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
