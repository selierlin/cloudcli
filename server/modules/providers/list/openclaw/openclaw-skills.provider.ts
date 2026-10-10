import path from 'node:path';

import { getOpenclawHomeDir } from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';

const SKILL_DIR_NAME = 'skills';

/**
 * OpenClaw invokes a skill in a session as `/<name>` (slash command), matching
 * its control UI. Kept as a full command builder so the syntax lives in one
 * place if it turns out to differ.
 */
const openclawSkillCommand = (skillName: string): string => `/${skillName}`;

/**
 * Provider registry skills adapter for OpenClaw's managed and plugin skill
 * directories.
 *
 * Consumed by `providerSkillsService` (the settings Skills surface). OpenClaw
 * loads skills from its managed `<state root>/skills` folder, from
 * `<state root>/plugin-skills` (symlinks installed by plugins), and from a
 * project-local `.openclaw/skills`. Bundled skills that ship inside the npm
 * install are deliberately not listed: they are not user-managed and cannot be
 * removed through the app.
 */
export class OpenclawSkillsProvider extends SkillsProvider {
  constructor() {
    super('openclaw');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    for (const rootDir of [path.join(getOpenclawHomeDir(), SKILL_DIR_NAME), path.join(getOpenclawHomeDir(), 'plugin-skills')]) {
      addUniqueProviderSkillSource(sources, seenRootDirs, {
        scope: 'user',
        rootDir,
        recursive: true,
        commandForSkill: openclawSkillCommand,
      });
    }

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'project',
      rootDir: path.join(workspacePath, '.openclaw', SKILL_DIR_NAME),
      recursive: true,
      commandForSkill: openclawSkillCommand,
    });

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getOpenclawHomeDir(), SKILL_DIR_NAME),
      commandForSkill: openclawSkillCommand,
    };
  }
}
