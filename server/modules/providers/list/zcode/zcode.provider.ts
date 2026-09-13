import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { ZcodeProviderAuth } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { ZcodeMcpProvider } from '@/modules/providers/list/zcode/zcode-mcp.provider.js';
import { ZcodeProviderModels } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { zcodeRuntime } from '@/modules/providers/list/zcode/zcode-runtime.provider.js';
import { ZcodeSessionSynchronizer } from '@/modules/providers/list/zcode/zcode-session-synchronizer.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import { ZcodeSkillsProvider } from '@/modules/providers/list/zcode/zcode-skills.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

/**
 * Provider facade for the ZCode CLI.
 *
 * There is no `fork` facet: transcript branching has no entry point in the
 * one-shot `--prompt` path this adapter uses (the CLI's unused `app-server`
 * protocol has `session/fork`).
 */
export class ZcodeProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = zcodeRuntime;
  readonly models: IProviderModels = new ZcodeProviderModels();
  readonly mcp = new ZcodeMcpProvider();
  readonly auth: IProviderAuth = new ZcodeProviderAuth();
  readonly skills: IProviderSkills = new ZcodeSkillsProvider();
  readonly sessions: IProviderSessions = new ZcodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new ZcodeSessionSynchronizer();

  constructor() {
    super('zcode');
  }
}
