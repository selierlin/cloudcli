import fs from 'node:fs';
import path from 'node:path';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { CliVersionProbe, ProviderAuthStatus } from '@/shared/types.js';
import { probeCliVersion } from '@/shared/utils.js';

import { getDshHarnessRoot, getDshHome } from './dsh-models.provider.js';

const PLACEHOLDER_KEY = 'sk-your-deepseek-api-key-here';

/** Provider registry auth adapter for DSH CLI installation and API-key state. */
export class DshProviderAuth implements IProviderAuth {
  /**
   * Checks whether the `dsh` CLI is on PATH and a provider key is configured
   * for the ACP server (environment, the `$DSH_HOME/.credentials.yaml` store,
   * or the legacy harness `.env`).
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const probe = this.checkInstalled();
    const installed = probe.installed;
    const authenticated = installed && this.checkCredentials();

    return {
      installed,
      installedVersion: probe.version,
      provider: 'dsh',
      authenticated,
      email: null,
      method: authenticated ? 'api_key' : null,
      error: installed
        ? (authenticated ? undefined : 'No dsh provider API key is configured (env, credentials store, or harness .env)')
        : 'dsh CLI is not installed',
    };
  }

  checkInstalled(): CliVersionProbe {
    return probeCliVersion('dsh');
  }

  private checkCredentials(): boolean {
    const hasEnvKey = (name: string): boolean => {
      const value = process.env[name]?.trim();
      return Boolean(value && value !== PLACEHOLDER_KEY);
    };
    if (hasEnvKey('DEEPSEEK_API_KEY') || hasEnvKey('GATEWAY_API_KEY')) {
      return true;
    }

    // The npm `dsh --profile acp` server resolves apiKeyEnv references from
    // `$DSH_HOME/.credentials.yaml`; any non-empty ref counts as configured.
    try {
      const content = fs.readFileSync(path.join(getDshHome(), '.credentials.yaml'), 'utf8');
      const refsSection = content.split(/\nrecords:/)[0];
      return /\n[ \t]+[A-Za-z0-9_.-]+:[ \t]*\S/m.test(refsSection);
    } catch {
      // Fall through to the legacy harness `.env` convention.
    }

    try {
      const content = fs.readFileSync(`${getDshHarnessRoot()}/.env`, 'utf8');
      const match = /^DEEPSEEK_API_KEY=(.+)$/m.exec(content);
      return Boolean(match?.[1]?.trim() && match[1].trim() !== PLACEHOLDER_KEY);
    } catch {
      return false;
    }
  }
}
