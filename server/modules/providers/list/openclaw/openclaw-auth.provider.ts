import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readOpenclawConfig } from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

/** Stable entry created by the machines' node-pin setup, tried after PATH. */
const OPENCLAW_STABLE_BIN = path.join(os.homedir(), '.local', 'share', 'node', 'current', 'bin', 'openclaw');

const RESOLUTION_TTL_MS = 30_000;
const AUTH_STATUS_TTL_MS = 30_000;
const VERSION_TIMEOUT_MS = 8_000;
const STATUS_TIMEOUT_MS = 10_000;

/** A resolved OpenClaw launcher: the executable plus any fixed leading arguments. */
export type OpenclawCommandResolution = {
  command: string | null;
  baseArgs: string[];
  source: 'override' | 'path' | 'stable' | 'missing';
};

let resolution: { value: OpenclawCommandResolution; resolvedAt: number } | null = null;
let authStatus: { value: ProviderAuthStatus; checkedAt: number } | null = null;

/** Splits `OPENCLAW_COMMAND` on whitespace, honoring quotes around one token. */
function splitCommandOverride(value: string): string[] {
  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((token) => {
    if (token.length >= 2) {
      const first = token[0];
      const last = token[token.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return token.slice(1, -1);
      }
    }
    return token;
  });
}

/** Wraps one argument for safe use inside a POSIX shell command string. */
function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolves how to launch OpenClaw: an explicit `OPENCLAW_COMMAND` override, a
 * `openclaw` executable on PATH, then the node-pin stable entry under the home
 * directory (so a launchd-launched server without nvm on its PATH still finds
 * it).
 */
function resolveCommandUncached(): OpenclawCommandResolution {
  const override = process.env.OPENCLAW_COMMAND?.trim();
  if (override) {
    const [command, ...baseArgs] = splitCommandOverride(override);
    if (command) {
      return { command, baseArgs, source: 'override' };
    }
  }

  try {
    const resolved = execFileSync('which', ['openclaw'], { encoding: 'utf8' }).trim();
    if (resolved) {
      return { command: resolved, baseArgs: [], source: 'path' };
    }
  } catch {
    // Fall through to the stable entry.
  }

  if (fs.existsSync(OPENCLAW_STABLE_BIN)) {
    return { command: OPENCLAW_STABLE_BIN, baseArgs: [], source: 'stable' };
  }

  return { command: null, baseArgs: [], source: 'missing' };
}

/** Returns the cached command resolution, refreshing it after the TTL. */
export function resolveOpenclawCommand(): OpenclawCommandResolution {
  if (resolution && Date.now() - resolution.resolvedAt < RESOLUTION_TTL_MS) {
    return resolution.value;
  }

  const value = resolveCommandUncached();
  resolution = { value, resolvedAt: Date.now() };
  return value;
}

/**
 * Returns a shell-ready OpenClaw command, with any fixed arguments quoted.
 *
 * Consumed by the websocket shell service to spawn the OpenClaw TUI in a PTY
 * without relying on the PTY's own PATH. Falls back to the bare name so a
 * missing install surfaces as a normal ENOENT.
 */
export function getOpenclawCommand(): string {
  const { command, baseArgs } = resolveOpenclawCommand();
  if (!command) {
    return 'openclaw';
  }
  return [command, ...baseArgs].map(quoteShellArg).join(' ');
}

/** Drops cached resolution and auth status (tests force re-resolution). */
export function resetOpenclawCommandForTests(): void {
  resolution = null;
  authStatus = null;
}

/** Whether the config document declares at least one provider with an inline key. */
function configHasInlineKey(config: AnyRecord): boolean {
  const providers = readObjectRecord(readObjectRecord(config.models)?.providers);
  if (!providers) {
    return false;
  }
  return Object.values(providers).some((rawProvider) =>
    Boolean(readOptionalString(readObjectRecord(rawProvider)?.apiKey)),
  );
}

/**
 * True when `openclaw models status --json` reports at least one usable
 * credential profile and no provider in use is missing auth.
 *
 * The CLI reports `{ auth: { providers: [{ profiles: { apiKey, oauth, token } }],
 * missingProvidersInUse } }`. A provider counts as authed when any of the three
 * profile counts is positive; a non-empty `missingProvidersInUse` means a
 * configured provider cannot run, so the app reports unauthenticated instead.
 */
function modelsStatusAuthenticated(payload: AnyRecord): boolean {
  const auth = readObjectRecord(payload.auth);
  const missingInUse = auth?.missingProvidersInUse;
  if (Array.isArray(missingInUse) && missingInUse.length > 0) {
    return false;
  }
  const providers = auth?.providers;
  if (!Array.isArray(providers)) {
    return false;
  }
  return providers.some((rawProvider) => {
    const profiles = readObjectRecord(readObjectRecord(rawProvider)?.profiles);
    if (!profiles) {
      return false;
    }
    return Number(profiles.apiKey ?? 0) > 0
      || Number(profiles.oauth ?? 0) > 0
      || Number(profiles.token ?? 0) > 0;
  });
}

/** Runs `openclaw models status --json` and parses it, or null when unavailable. */
function readModelsStatus(command: string, baseArgs: string[]): AnyRecord | null {
  try {
    const stdout = execFileSync(command, [...baseArgs, 'models', 'status', '--json'], {
      encoding: 'utf8',
      timeout: STATUS_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return readObjectRecord(JSON.parse(stdout));
  } catch {
    return null;
  }
}

/**
 * Provider registry auth adapter for the OpenClaw CLI.
 *
 * Consumed by `providerAuthService` and the frontend auth/onboarding surfaces.
 */
export class OpenclawProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    if (authStatus && Date.now() - authStatus.checkedAt < AUTH_STATUS_TTL_MS) {
      return authStatus.value;
    }

    const { command, baseArgs } = resolveOpenclawCommand();
    const installed = command !== null && this.versionRuns(command, baseArgs);
    let status: ProviderAuthStatus;

    if (!command || !installed) {
      status = {
        installed: false,
        provider: 'openclaw',
        authenticated: false,
        authVerified: false,
        email: null,
        method: null,
        error: `OpenClaw CLI not found (set OPENCLAW_COMMAND or install OpenClaw; tried PATH and ${OPENCLAW_STABLE_BIN})`,
      };
    } else {
      const statusPayload = readModelsStatus(command, baseArgs);
      const authenticated = statusPayload
        ? modelsStatusAuthenticated(statusPayload)
        : configHasInlineKey(readOpenclawConfig() ?? {});
      status = {
        installed: true,
        provider: 'openclaw',
        authenticated,
        authVerified: authenticated,
        email: null,
        method: authenticated ? 'openclaw_config' : null,
        error: authenticated
          ? undefined
          : 'OpenClaw has no usable model credentials (run `openclaw models auth` or add an apiKey provider to openclaw.json)',
      };
    }

    authStatus = { value: status, checkedAt: Date.now() };
    return status;
  }

  /** True when `openclaw --version` succeeds within the timeout. */
  private versionRuns(command: string, baseArgs: string[]): boolean {
    try {
      execFileSync(command, [...baseArgs, '--version'], {
        encoding: 'utf8',
        timeout: VERSION_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
