import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * Provider registry skills adapter for WorkBuddy.
 *
 * The engine loads its own skills from its config dir's `skills` folder, so the
 * app only mirrors that user-level folder for the UI: `~/.workbuddy/skills`.
 * The engine does not read project-level skill folders, so none are registered
 * here.
 */
export class WorkbuddySkillsProvider extends SkillsProvider {
  constructor() {
    super('workbuddy');
  }

  protected async getSkillSources(_workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.workbuddy', 'skills'),
      commandPrefix: '/',
    });

    return sources;
  }
}
