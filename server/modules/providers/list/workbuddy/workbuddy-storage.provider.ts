import os from 'node:os';
import path from 'node:path';

/**
 * Resolves the WorkBuddy configuration directory used by all WorkBuddy adapters.
 *
 * Runtime callers pass the persisted transcript root for resumed sessions. An
 * explicit process override always wins so managed deployments can relocate
 * WorkBuddy state without CloudCLI silently splitting it across home folders.
 */
export function resolveWorkbuddyConfigDir(sessionConfigDir?: string | null): string {
  const explicitConfigDir = process.env.CODEBUDDY_CONFIG_DIR?.trim()
    || process.env.WORKBUDDY_CONFIG_DIR?.trim();
  return explicitConfigDir || sessionConfigDir?.trim() || path.join(os.homedir(), '.workbuddy');
}

/**
 * Returns every WorkBuddy transcript root visible to session readers and the
 * filesystem watcher. `WORKBUDDY_PROJECTS_ROOT` is retained for tests and
 * non-standard installations; explicit config-root overrides otherwise map to
 * their own `projects` folder. Default desktop and legacy CLI roots coexist.
 */
export function getWorkbuddySessionRoots(): string[] {
  const explicitProjectsRoot = process.env.WORKBUDDY_PROJECTS_ROOT?.trim();
  if (explicitProjectsRoot) {
    return [explicitProjectsRoot];
  }

  const explicitConfigDir = process.env.CODEBUDDY_CONFIG_DIR?.trim()
    || process.env.WORKBUDDY_CONFIG_DIR?.trim();
  if (explicitConfigDir) {
    return [path.join(explicitConfigDir, 'projects')];
  }

  return [
    path.join(os.homedir(), '.codebuddy', 'projects'),
    path.join(os.homedir(), '.workbuddy', 'projects'),
  ];
}

/**
 * Returns the user-level skill folder the default WorkBuddy runtime loads for
 * new sessions. Skill writes intentionally follow the same root as new runs.
 */
export function getWorkbuddyUserSkillsRoot(): string {
  return path.join(resolveWorkbuddyConfigDir(), 'skills');
}
