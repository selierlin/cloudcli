import os from 'node:os';
import path from 'node:path';

import { getZcodeHomeDir } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import {
  addUniqueProviderSkillSource,
  findTopmostGitRoot,
} from '@/shared/utils.js';

/** ZCode resolves skill roots under both `.zcode` and `.agents` at every level. */
const SKILL_DIR_NAME = 'skills';

/**
 * ZCode invokes a skill as `/skill <name>` (space-separated), so the shared
 * one-character `commandPrefix` cannot express it and a full command builder is
 * supplied instead.
 */
const zcodeSkillCommand = (skillName: string): string => `/skill ${skillName}`;

/** The two skill roots ZCode resolves under one base directory. */
const skillRootsForBase = (baseDir: string): string[] => [
  path.join(baseDir, '.zcode', SKILL_DIR_NAME),
  path.join(baseDir, '.agents', SKILL_DIR_NAME),
];

/** User-level skill roots, with the `.zcode` root following the storage root. */
const userSkillRoots = (): string[] => [
  path.join(getZcodeHomeDir(), SKILL_DIR_NAME),
  path.join(os.homedir(), '.agents', SKILL_DIR_NAME),
];

const resolveWorkspacePath = (workspacePath?: string): string =>
  path.resolve(workspacePath ?? process.cwd());

/** Provider registry skills adapter for ZCode's `.zcode`/`.agents` skill roots. */
export class ZcodeSkillsProvider extends SkillsProvider {
  constructor() {
    super('zcode');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    // User roots always load. The `.zcode` root follows the storage root so
    // `addSkills` and discovery agree (both default to `~/.zcode/skills`).
    for (const rootDir of userSkillRoots()) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir,
        recursive: true,
        commandForSkill: zcodeSkillCommand,
      });
    }

    // ZCode walks every directory from the workspace up to its git worktree
    // root, loading `.zcode/skills` and `.agents/skills` at each level. Outside
    // a repository only the workspace directory itself is searched.
    const repoRoot = await findTopmostGitRoot(workspacePath);
    const projectDirs = [workspacePath];
    if (repoRoot && repoRoot !== workspacePath) {
      let currentDir = path.dirname(workspacePath);
      for (;;) {
        projectDirs.push(currentDir);
        if (currentDir === repoRoot) {
          break;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          break;
        }
        currentDir = parentDir;
      }
    }

    for (const projectDir of projectDirs) {
      for (const rootDir of skillRootsForBase(projectDir)) {
        addUniqueProviderSkillSource(sources, seenRootDirs, {
          scope: 'repo',
          rootDir,
          recursive: true,
          commandForSkill: zcodeSkillCommand,
        });
      }
    }

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getZcodeHomeDir(), SKILL_DIR_NAME),
      commandForSkill: zcodeSkillCommand,
    };
  }
}
