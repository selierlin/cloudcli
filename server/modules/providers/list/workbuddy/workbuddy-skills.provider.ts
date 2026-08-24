import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * Provider registry skills adapter for WorkBuddy.
 *
 * The engine loads its own skills and slash commands, so the app does not
 * discover skills on its own behalf.
 */
export class WorkbuddySkillsProvider extends SkillsProvider {
  constructor() {
    super('workbuddy');
  }

  protected async getSkillSources(_workspacePath: string): Promise<ProviderSkillSource[]> {
    return [];
  }
}
