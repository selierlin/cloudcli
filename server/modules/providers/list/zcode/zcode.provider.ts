import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { ZcodeProviderAuth } from '@/modules/providers/list/zcode/zcode-auth.provider.js';
import { ZcodeForkProvider } from '@/modules/providers/list/zcode/zcode-fork.provider.js';
import { ZcodeMcpProvider } from '@/modules/providers/list/zcode/zcode-mcp.provider.js';
import { ZcodeProviderModels } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { zcodeRuntime } from '@/modules/providers/list/zcode/zcode-runtime.provider.js';
import { ZcodeSessionSynchronizer } from '@/modules/providers/list/zcode/zcode-session-synchronizer.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import { ZcodeSkillsProvider } from '@/modules/providers/list/zcode/zcode-skills.provider.js';
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
 * Provider facade for the ZCode CLI.
 *
 * The one-shot `--prompt` path has no branching, but the CLI's bundled
 * `app-server` protocol does: its `session/fork` copies a conversation up to a
 * chosen message. {@link ZcodeForkProvider} drives that over a throwaway
 * app-server process and guards the one side effect the copy carries — ZCode's
 * workspace checkpoint restore.
 */
export class ZcodeProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = zcodeRuntime;
  readonly models: IProviderModels = new ZcodeProviderModels();
  readonly mcp = new ZcodeMcpProvider();
  readonly auth: IProviderAuth = new ZcodeProviderAuth();
  readonly skills: IProviderSkills = new ZcodeSkillsProvider();
  readonly sessions: IProviderSessions = new ZcodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new ZcodeSessionSynchronizer();
  readonly fork: IProviderFork = new ZcodeForkProvider();

  constructor() {
    super('zcode');
  }
}
