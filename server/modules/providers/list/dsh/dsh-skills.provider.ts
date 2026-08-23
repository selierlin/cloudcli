import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';

/**
 * Provider registry skills adapter for DSH.
 *
 * The harness loads its own skills through its skill plugins, so the app does
 * not discover skills on its own behalf.
 */
export class DshSkillsProvider extends SkillsProvider {
  constructor() {
    super('dsh');
  }

  protected async getSkillSources(_workspacePath: string): Promise<ProviderSkillSource[]> {
    return [];
  }
}
