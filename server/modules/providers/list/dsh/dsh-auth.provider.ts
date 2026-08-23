import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

import { getDshHarnessRoot } from './dsh-models.provider.js';

const PLACEHOLDER_KEY = 'sk-your-deepseek-api-key-here';

/** Provider registry auth adapter for DSH CLI installation and API-key state. */
export class DshProviderAuth implements IProviderAuth {
  /**
   * Checks whether the `dsh` CLI is on PATH and the DeepSeek API key is
   * configured for the ACP server (environment variable or harness `.env`).
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const authenticated = installed && this.checkCredentials();

    return {
      installed,
      provider: 'dsh',
      authenticated,
      email: null,
      method: authenticated ? 'deepseek_api_key' : null,
      error: installed
        ? (authenticated ? undefined : 'DEEPSEEK_API_KEY is not configured in the DSH harness .env')
        : 'dsh CLI is not installed',
    };
  }

  private checkInstalled(): boolean {
    try {
      execFileSync('dsh', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private checkCredentials(): boolean {
    const environmentKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (environmentKey && environmentKey !== PLACEHOLDER_KEY) {
      return true;
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
