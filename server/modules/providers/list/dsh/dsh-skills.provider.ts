import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';

import { getDshHome } from './dsh-models.provider.js';

/**
 * Skill roots the DSH skill plugin reads for an ACP session.
 *
 * `dsh-skill-filesystem` ships a default root list; these entries mirror it in
 * rank order so the settings panel shows the same skills the chat session can
 * load. The harness still owns loading, so this adapter stays read-only.
 */

const hasGitMarker = async (directoryPath: string): Promise<boolean> => {
  const markerStats = await stat(path.join(directoryPath, '.git')).catch(() => null);
  return markerStats !== null && (markerStats.isDirectory() || markerStats.isFile());
};

/**
 * Resolves the nearest enclosing git worktree root for a workspace.
 *
 * Mirrors `findProjectRoot` in `dsh-skill-filesystem`: DSH walks up to the
 * closest `.git` marker and falls back to the workspace itself when no
 * repository encloses it.
 */
const findNearestGitRoot = async (workspacePath: string): Promise<string> => {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  let currentPath = resolvedWorkspacePath;

  while (true) {
    if (await hasGitMarker(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return resolvedWorkspacePath;
    }

    currentPath = parentPath;
  }
};

/** Agent skill home DSH falls back to when `DSH_AGENTS_HOME` is unset. */
const getAgentsHome = (): string =>
  process.env.DSH_AGENTS_HOME?.trim()
  || path.join(os.homedir(), '.agents');

export class DshSkillsProvider extends SkillsProvider {
  constructor() {
    super('dsh');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();
    const projectRoot = await findNearestGitRoot(workspacePath);

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'project',
      rootDir: path.join(projectRoot, '.dsh', 'skills'),
      commandPrefix: '/',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'project',
      rootDir: path.join(projectRoot, '.agents', 'skills'),
      commandPrefix: '/',
    });

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(getDshHome(), 'skills'),
      commandPrefix: '/',
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(getAgentsHome(), 'skills'),
      commandPrefix: '/',
    });

    return sources;
  }
}
