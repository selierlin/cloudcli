import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import type { ProviderSkillSource } from '@/shared/types.js';
import { addUniqueProviderSkillSource } from '@/shared/utils.js';
import { getOmpAgentDir } from '@/modules/providers/list/omp/omp-models.provider.js';

/**
 * OMP invokes a skill as `/skill:name` (its `skills.enableSkillCommands`
 * option registers exactly that form), which `commandForSkill` spells out
 * because `commandPrefix` only supports the `/` and `$` one-character forms.
 */
const ompSkillCommand = (skillName: string): string => `/skill:${skillName}`;

/**
 * Provider registry skills adapter for OMP.
 *
 * OMP reads its own skill roots plus the Agents and Claude compatibility roots
 * it is configured to honour (`skills.enableAgentsProject` /
 * `skills.enableClaudeProject`). Only roots observed to be discovered by the
 * CLI are listed:
 *   user:    `<agentDir>/skills`, `~/.agents/skills`
 *   project: `<workspace>/.omp/skills`, `<workspace>/.agents/skills`,
 *            `<workspace>/.claude/skills`
 * `${workspace}/.pi/skills` is deliberately absent: OMP's `skills.enablePiProject`
 * claims Pi project compatibility, but a probe skill placed there was not
 * discovered while its siblings in the other three roots were.
 */
export class OmpSkillsProvider extends SkillsProvider {
  constructor() {
    super('omp');
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const sources: ProviderSkillSource[] = [];
    const seenRootDirs = new Set<string>();

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(getOmpAgentDir(), 'skills'),
      recursive: true,
      commandForSkill: ompSkillCommand,
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.agents', 'skills'),
      recursive: true,
      commandForSkill: ompSkillCommand,
    });

    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'repo',
      rootDir: path.join(workspacePath, '.omp', 'skills'),
      recursive: true,
      commandForSkill: ompSkillCommand,
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'repo',
      rootDir: path.join(workspacePath, '.agents', 'skills'),
      recursive: true,
      commandForSkill: ompSkillCommand,
    });
    addUniqueProviderSkillSource(sources, seenRootDirs, {
      scope: 'repo',
      rootDir: path.join(workspacePath, '.claude', 'skills'),
      recursive: true,
      commandForSkill: ompSkillCommand,
    });

    return sources;
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getOmpAgentDir(), 'skills'),
      commandForSkill: ompSkillCommand,
    };
  }
}
