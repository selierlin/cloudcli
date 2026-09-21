import { execFile, execFileSync } from 'node:child_process';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

// Status polling must not shell out (or block the event loop) on every call:
// the command resolution and both probes are each cached briefly.
const RESOLUTION_TTL_MS = 30_000;
const VERSION_PROBE_TTL_MS = 30_000;
const VERSION_PROBE_TIMEOUT_MS = 2_000;
const CONFIG_PROBE_TTL_MS = 30_000;
const CONFIG_PROBE_TIMEOUT_MS = 5_000;

type CommandResolution = { command: string | null; source: 'override' | 'path' | 'missing' };

let resolution: { value: CommandResolution; resolvedAt: number } | null = null;
let versionProbe: { ok: boolean; checkedAt: number } | null = null;
let configProbe: { status: 'ready' | 'unconfigured' | 'unknown'; checkedAt: number } | null = null;

/**
 * Resolves the `omp` executable: an explicit `OMP_COMMAND` env override, then
 * PATH. Returns `command: null` when neither yields an executable — callers
 * must treat that as "not installed" instead of guessing at a bare command
 * name.
 */
function resolveCommand(): CommandResolution {
  if (resolution && Date.now() - resolution.resolvedAt < RESOLUTION_TTL_MS) {
    return resolution.value;
  }

  const next = resolveCommandUncached();
  resolution = { value: next, resolvedAt: Date.now() };
  return next;
}

function resolveCommandUncached(): CommandResolution {
  const override = process.env.OMP_COMMAND?.trim();
  if (override) {
    return { command: override, source: 'override' };
  }

  try {
    // Use the absolute path from `which` so callers (PTY spawn, runtime spawn)
    // don't need `omp` to be on their own PATH — the backend process's PATH is
    // sufficient for resolution.
    const resolved = execFileSync('which', ['omp'], { encoding: 'utf8' }).trim();
    if (resolved) {
      return { command: resolved, source: 'path' };
    }
  } catch {
    // Fall through to missing.
  }

  return { command: null, source: 'missing' };
}

/**
 * Returns the command the OMP runtime should spawn. When nothing is installed
 * the bare `omp` name is returned so the spawn surfaces a normal ENOENT
 * failure that the runtime already reports; auth status reads
 * `resolveCommand()` directly and never sees this fallback.
 */
export const getOmpCommand = (): string => {
  return resolveCommand().command ?? 'omp';
};

/** Drops the cached resolution and probes (used by tests to force re-resolution). */
export function resetOmpCommandForTests(): void {
  resolution = null;
  versionProbe = null;
  configProbe = null;
}

/**
 * Asynchronously verifies the resolved CLI actually runs. Non-blocking (a
 * synchronous probe would freeze the Node event loop for the timeout window on
 * every status query) and cached so the settings UI can poll freely.
 */
async function checkVersion(command: string): Promise<boolean> {
  if (versionProbe && Date.now() - versionProbe.checkedAt < VERSION_PROBE_TTL_MS) {
    return versionProbe.ok;
  }
  const ok = await new Promise<boolean>((resolve) => {
    execFile(command, ['--version'], { timeout: VERSION_PROBE_TIMEOUT_MS }, (error) => {
      resolve(!error);
    });
  });
  versionProbe = { ok, checkedAt: Date.now() };
  return ok;
}

/**
 * Reads whether the user has a default model route configured.
 *
 * OMP exposes no login-state query: there is no `omp auth` subcommand and
 * `omp config list` reports no credential status, so a configured default
 * model is the closest observable proxy for "this machine can actually run a
 * turn". The status therefore reports `authVerified: false` — the credentials
 * themselves are never positively verified.
 */
async function checkConfigured(command: string): Promise<'ready' | 'unconfigured' | 'unknown'> {
  if (configProbe && Date.now() - configProbe.checkedAt < CONFIG_PROBE_TTL_MS) {
    return configProbe.status;
  }

  const status = await new Promise<'ready' | 'unconfigured' | 'unknown'>((resolve) => {
    execFile(command, ['config', 'list', '--json'], { timeout: CONFIG_PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error && !stdout) {
        // A failed probe (CLI error, timeout) says nothing about the
        // credentials — keep the state unknown rather than claiming the user
        // has no configuration.
        resolve('unknown');
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { modelRoles?: { value?: { default?: unknown } } };
        const configured = parsed.modelRoles?.value?.default;
        resolve(typeof configured === 'string' && configured.trim() ? 'ready' : 'unconfigured');
      } catch {
        resolve('unknown');
      }
    });
  });

  configProbe = { status, checkedAt: Date.now() };
  return status;
}

/** Provider registry auth adapter for the OMP CLI. */
export class OmpProviderAuth implements IProviderAuth {
  /**
   * OMP keeps every credential in its own agent state (`~/.omp/agent`), which
   * it manages through its interactive `/models` flow. A working CLI proves the
   * engine is available; a configured default model role proves this machine
   * has a model route to run.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const { command } = resolveCommand();
    const installed = command !== null;

    if (!installed) {
      return {
        installed: false,
        provider: 'omp',
        authenticated: false,
        authVerified: false,
        email: null,
        method: null,
        error: 'omp CLI not found (install oh-my-pi or add omp to PATH)',
      };
    }

    const versionOk = await checkVersion(command);
    if (!versionOk) {
      return {
        installed: true,
        provider: 'omp',
        authenticated: false,
        authVerified: false,
        email: null,
        method: null,
        error: 'omp CLI is present but failed to run',
      };
    }

    const configured = await checkConfigured(command);
    return {
      installed: true,
      provider: 'omp',
      authenticated: configured === 'ready',
      // OMP has no credential-status query, so credentials stay unverified.
      authVerified: false,
      email: null,
      method: configured === 'ready' ? 'omp_config' : null,
      error: configured === 'ready'
        ? undefined
        : configured === 'unknown'
          ? 'Could not read omp configuration (omp config list failed)'
          : 'omp has no default model configured (run `omp` in a terminal to sign in and pick a model)',
    };
  }
}
