import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

/** Embedded CodeBuddy engine shipped inside the WorkBuddy desktop app. */
const WORKBUDDY_EMBEDDED_CLI = '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';

// Status polling must not shell out (or block the event loop) on every call:
// the command resolution and the version probe are each cached briefly.
const RESOLUTION_TTL_MS = 30_000;
const VERSION_PROBE_TTL_MS = 30_000;
const VERSION_PROBE_TIMEOUT_MS = 2_000;

type CommandSource = 'override' | 'path' | 'embedded' | 'missing';
type CommandResolution = { command: string | null; source: CommandSource };

let resolution: { value: CommandResolution; resolvedAt: number } | null = null;
let versionProbe: { ok: boolean; checkedAt: number } | null = null;

/**
 * Resolves the `codebuddy` executable: an explicit `CODEBUDDY_COMMAND` env
 * override, then PATH, then the CLI embedded in WorkBuddy.app. Returns
 * `command: null` when none of those yield an executable — callers must treat
 * that as "not installed" instead of guessing at a bare command name.
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
  const override = process.env.CODEBUDDY_COMMAND?.trim();
  if (override) {
    return { command: override, source: 'override' };
  }

  try {
    execFileSync('which', ['codebuddy'], { stdio: 'ignore' });
    return { command: 'codebuddy', source: 'path' };
  } catch {
    // Fall through to the embedded engine.
  }

  const embeddedPath = embeddedCliPath();
  if (existsSync(embeddedPath)) {
    return { command: embeddedPath, source: 'embedded' };
  }

  return { command: null, source: 'missing' };
}

/**
 * WorkBuddy's engine usually lives at a fixed location inside the app bundle.
 * The override covers non-standard installs and lets tests simulate machines
 * without WorkBuddy without touching the real /Applications directory.
 */
function embeddedCliPath(): string {
  return process.env.WORKBUDDY_EMBEDDED_CLI?.trim() || WORKBUDDY_EMBEDDED_CLI;
}

/**
 * Returns the command the WorkBuddy runtime should spawn. When nothing is
 * installed the bare `codebuddy` name is returned so the spawn surfaces a
 * normal ENOENT failure that the runtime already reports; auth status reads
 * `resolveCommand()` directly and never sees this fallback.
 */
export const getWorkbuddyCommand = (): string => {
  return resolveCommand().command ?? 'codebuddy';
};

/** Drops the cached resolution and version probe (used by tests to force re-resolution). */
export function resetWorkbuddyCommandForTests(): void {
  resolution = null;
  versionProbe = null;
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

/** Provider registry auth adapter for the WorkBuddy (embedded CodeBuddy) CLI. */
export class WorkbuddyProviderAuth implements IProviderAuth {
  /**
   * The CLI resolves its own login state (the WorkBuddy desktop app signs in),
   * so `authenticated` mirrors whether the executable actually runs.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const { command } = resolveCommand();
    const installed = command !== null;

    const versionOk = installed ? await checkVersion(command) : false;

    return {
      installed,
      provider: 'workbuddy',
      authenticated: versionOk,
      email: null,
      method: versionOk ? 'workbuddy_login' : null,
      error: installed
        ? (versionOk ? undefined : 'codebuddy CLI is present but failed to run')
        : 'codebuddy CLI not found (install WorkBuddy.app or add codebuddy to PATH)',
    };
  }
}
