import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { WorkbuddyProviderAuth } from '@/modules/providers/list/workbuddy/workbuddy-auth.provider.js';
import { WorkbuddyProviderModels } from '@/modules/providers/list/workbuddy/workbuddy-models.provider.js';
import { WorkbuddyMcpProvider } from '@/modules/providers/list/workbuddy/workbuddy-mcp.provider.js';
import { workbuddyRuntime } from '@/modules/providers/list/workbuddy/workbuddy-runtime.provider.js';
import { WorkbuddySessionSynchronizer } from '@/modules/providers/list/workbuddy/workbuddy-session-synchronizer.provider.js';
import { WorkbuddySessionsProvider } from '@/modules/providers/list/workbuddy/workbuddy-sessions.provider.js';
import { WorkbuddySkillsProvider } from '@/modules/providers/list/workbuddy/workbuddy-skills.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class WorkbuddyProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = workbuddyRuntime;
  readonly models: IProviderModels = new WorkbuddyProviderModels();
  readonly mcp = new WorkbuddyMcpProvider();
  readonly auth: IProviderAuth = new WorkbuddyProviderAuth();
  readonly skills: IProviderSkills = new WorkbuddySkillsProvider();
  readonly sessions: IProviderSessions = new WorkbuddySessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new WorkbuddySessionSynchronizer();

  constructor() {
    super('workbuddy');
  }
}
