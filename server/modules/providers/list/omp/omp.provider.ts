import { OmpProviderAuth } from '@/modules/providers/list/omp/omp-auth.provider.js';
import { OmpForkProvider } from '@/modules/providers/list/omp/omp-fork.provider.js';
import { OmpMcpProvider } from '@/modules/providers/list/omp/omp-mcp.provider.js';
import { OmpProviderModels } from '@/modules/providers/list/omp/omp-models.provider.js';
import { ompRuntime } from '@/modules/providers/list/omp/omp-runtime.provider.js';
import { OmpSessionSynchronizer } from '@/modules/providers/list/omp/omp-session-synchronizer.provider.js';
import { OmpSessionsProvider } from '@/modules/providers/list/omp/omp-sessions.provider.js';
import { OmpSkillsProvider } from '@/modules/providers/list/omp/omp-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderFork,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

/**
 * Provider registry entry for OMP (oh-my-pi), a fork of Pi driven through the
 * same one-shot JSON CLI contract but with its own flag names, model catalog,
 * auth surface, and agent directory.
 *
 * OMP ships no `--fork`, so branching is materialised by copying the
 * transcript prefix into a new session file — see {@link OmpForkProvider}.
 */
export class OmpProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = ompRuntime;
  readonly models: IProviderModels = new OmpProviderModels();
  readonly mcp = new OmpMcpProvider();
  readonly auth: IProviderAuth = new OmpProviderAuth();
  readonly skills: IProviderSkills = new OmpSkillsProvider();
  readonly sessions: IProviderSessions = new OmpSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new OmpSessionSynchronizer();
  readonly fork: IProviderFork = new OmpForkProvider();

  constructor() {
    super('omp');
  }
}
