import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

import { getWorkbuddyUserSkillsRoot } from './workbuddy-storage.provider.js';

/**
 * Provider registry skills adapter for WorkBuddy.
 *
 * The engine loads skills from its config dir's `skills` folder (user level,
 * `<config-dir>/skills`) and from `<workdir>/.codebuddy/skills` in the project
 * it runs in (project level). The app reads both through the same config-root
 * resolver used by brand-new runtime sessions.
 */
export class WorkbuddySkillsProvider extends SkillsProvider {
  constructor() {
    super('workbuddy');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    return [
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.codebuddy', 'skills'),
        recursive: true,
        commandPrefix: '/',
      },
      {
        scope: 'user',
        rootDir: getWorkbuddyUserSkillsRoot(),
        commandPrefix: '/',
      },
    ];
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: getWorkbuddyUserSkillsRoot(),
      commandPrefix: '/',
    };
  }
}
