import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getZcodeConfigPath, getZcodeHomeDir, readZcodeConfig } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import type { IProviderAuth } from '@/shared/interfaces.js';
import type { AnyRecord, ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

/**
 * Candidate locations of the ZCode CLI bundle shipped inside the desktop app.
 *
 * ZCode does not install a `zcode` executable on PATH; the app's Electron
 * bundle runs the CLI with Node. macOS installs live under `/Applications`, and
 * a per-user install is the other common arrangement.
 */
const ZCODE_BUNDLED_CLI_PATHS = [
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  path.join(os.homedir(), 'Applications', 'ZCode.app', 'Contents', 'Resources', 'glm', 'zcode.cjs'),
];

const RESOLUTION_TTL_MS = 30_000;
const AUTH_STATUS_TTL_MS = 30_000;

type ZcodeCommandSource = 'override' | 'path' | 'bundled' | 'missing';

/** A resolved ZCode launcher: the executable plus any leading arguments it needs. */
export type ZcodeCommandResolution = {
  command: string | null;
  baseArgs: string[];
  source: ZcodeCommandSource;
};

let resolution: { value: ZcodeCommandResolution; resolvedAt: number } | null = null;
let authStatus: { value: ProviderAuthStatus; checkedAt: number } | null = null;
// Mutable so tests can exercise resolution without the desktop app installed.
let bundledCliPaths = ZCODE_BUNDLED_CLI_PATHS;

/** Splits `ZCODE_COMMAND` on whitespace, honoring single/double quotes around one token. */
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
 * Resolves how to launch ZCode: an explicit `ZCODE_COMMAND` override, then a
 * `zcode` executable on PATH, then the desktop app's bundled bundle (run with
 * the PATH `node`, since the app does not ship its own runtime).
 */
function resolveCommandUncached(): ZcodeCommandResolution {
  const override = process.env.ZCODE_COMMAND?.trim();
  if (override) {
    const [command, ...baseArgs] = splitCommandOverride(override);
    if (command) {
      return { command, baseArgs, source: 'override' };
    }
  }

  try {
    // The absolute path keeps PTY and runtime spawns independent of whether
    // `zcode` is on their own PATH.
    const resolved = execFileSync('which', ['zcode'], { encoding: 'utf8' }).trim();
    if (resolved) {
      return { command: resolved, baseArgs: [], source: 'path' };
    }
  } catch {
    // Fall through to the bundled CLI.
  }

  for (const candidate of bundledCliPaths) {
    if (fs.existsSync(candidate)) {
      return { command: 'node', baseArgs: [candidate], source: 'bundled' };
    }
  }

  return { command: null, baseArgs: [], source: 'missing' };
}

/** Returns the cached command resolution, refreshing it after the TTL. */
export function resolveZcodeCommand(): ZcodeCommandResolution {
  if (resolution && Date.now() - resolution.resolvedAt < RESOLUTION_TTL_MS) {
    return resolution.value;
  }

  const value = resolveCommandUncached();
  resolution = { value, resolvedAt: Date.now() };
  return value;
}

/**
 * Returns a shell-ready ZCode command.
 *
 * Used by the websocket shell service to spawn the ZCode TUI in a PTY without
 * relying on the PTY's own PATH. Falls back to the bare name so a missing
 * install surfaces as a normal ENOENT instead of a silently wrong command.
 */
export function getZcodeCommand(): string {
  const { command, baseArgs } = resolveZcodeCommand();
  if (!command) {
    return 'zcode';
  }
  return [command, ...baseArgs].map(quoteShellArg).join(' ');
}

/** Drops cached resolution and auth status (used by tests to force re-resolution). */
export function resetZcodeCommandForTests(): void {
  resolution = null;
  authStatus = null;
  bundledCliPaths = ZCODE_BUNDLED_CLI_PATHS;
}

/**
 * Replaces the bundled CLI candidates so command resolution can be exercised
 * on machines without the desktop app. Pass `null` to restore the real list.
 */
export function setZcodeBundledCliPathsForTests(paths: string[] | null): void {
  bundledCliPaths = paths ?? ZCODE_BUNDLED_CLI_PATHS;
  resolution = null;
}

/**
 * True when the config declares at least one provider with an API key and a
 * model, which is what the CLI requires to start a run.
 *
 * Desktop OAuth credentials under `~/.zcode/v2/credentials.json` are
 * deliberately NOT accepted on their own: with no `cli/config.json` provider
 * the CLI exits with "Model config is missing", so counting them would report
 * a session as authenticated that cannot actually run.
 */
function isConfigAuthenticated(config: AnyRecord): boolean {
  const providers = readObjectRecord(config.provider);
  if (!providers) {
    return false;
  }

  const hasModel = Boolean(readOptionalString(readObjectRecord(config.model)?.main))
    || Object.values(providers).some((rawProvider) => {
      const models = readObjectRecord(readObjectRecord(rawProvider)?.models);
      return Boolean(models && Object.keys(models).length > 0);
    });
  if (!hasModel) {
    return false;
  }

  return Object.values(providers).some((rawProvider) => {
    const options = readObjectRecord(readObjectRecord(rawProvider)?.options);
    return Boolean(readOptionalString(options?.apiKey));
  });
}

/** Provider registry auth adapter for the ZCode CLI. */
export class ZcodeProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    if (authStatus && Date.now() - authStatus.checkedAt < AUTH_STATUS_TTL_MS) {
      return authStatus.value;
    }

    const { command } = resolveZcodeCommand();
    let status: ProviderAuthStatus;

    if (!command) {
      status = {
        installed: false,
        provider: 'zcode',
        authenticated: false,
        authVerified: false,
        email: null,
        method: null,
        error: `ZCode CLI not found (set ZCODE_COMMAND or install ZCode; expected ${getZcodeConfigPath()} under ${getZcodeHomeDir()})`,
      };
    } else {
      const config = readZcodeConfig();
      const authenticated = config !== null && isConfigAuthenticated(config);
      status = {
        installed: true,
        provider: 'zcode',
        authenticated,
        authVerified: authenticated,
        email: null,
        method: authenticated ? 'zcode_config' : null,
        error: authenticated
          ? undefined
          : `ZCode is not configured (add a provider with an apiKey to ${getZcodeConfigPath()})`,
      };
    }

    authStatus = { value: status, checkedAt: Date.now() };
    return status;
  }
}
