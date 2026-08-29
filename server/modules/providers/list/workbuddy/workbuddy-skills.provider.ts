import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

import { getWorkbuddyUserSkillsRoot } from './workbuddy-storage.provider.js';

/**
 * Provider registry skills adapter for WorkBuddy.
 *
 * The engine loads its own skills from its config dir's `skills` folder, so the
 * app reads and writes that user-level folder through the same config-root
 * resolver used by brand-new runtime sessions.
 * The engine does not read project-level skill folders, so none are registered
 * here.
 */
export class WorkbuddySkillsProvider extends SkillsProvider {
  constructor() {
    super('workbuddy');
  }

  protected async getSkillSources(_workspacePath: string): Promise<ProviderSkillSource[]> {
    return [{
      scope: 'user',
      rootDir: getWorkbuddyUserSkillsRoot(),
      commandPrefix: '/',
    }];
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: getWorkbuddyUserSkillsRoot(),
      commandPrefix: '/',
    };
  }
}
