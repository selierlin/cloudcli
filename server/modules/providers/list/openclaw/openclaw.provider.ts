import { OpenclawProviderAuth } from '@/modules/providers/list/openclaw/openclaw-auth.provider.js';
import { OpenclawMcpProvider } from '@/modules/providers/list/openclaw/openclaw-mcp.provider.js';
import { OpenclawProviderModels } from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import { openclawRuntime } from '@/modules/providers/list/openclaw/openclaw-runtime.provider.js';
import { OpenclawSessionSynchronizer } from '@/modules/providers/list/openclaw/openclaw-session-synchronizer.provider.js';
import { OpenclawSessionsProvider } from '@/modules/providers/list/openclaw/openclaw-sessions.provider.js';
import { OpenclawSkillsProvider } from '@/modules/providers/list/openclaw/openclaw-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

/**
 * Provider facade for the OpenClaw multi-channel gateway.
 *
 * Read side (history, models, auth, skills, session indexing) makes existing
 * OpenClaw sessions appear in the sidebar. Live chat is served by
 * {@link openclawRuntime} over the ACP bridge. MCP is harness-managed (OpenClaw
 * owns its own MCP config) and `fork` stays absent — the ACP bridge exposes no
 * `session/fork`, which is what disables "fork session" in the UI.
 */
export class OpenclawProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = openclawRuntime;
  readonly models: IProviderModels = new OpenclawProviderModels();
  readonly mcp = new OpenclawMcpProvider();
  readonly auth: IProviderAuth = new OpenclawProviderAuth();
  readonly skills: IProviderSkills = new OpenclawSkillsProvider();
  readonly sessions: IProviderSessions = new OpenclawSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new OpenclawSessionSynchronizer();

  constructor() {
    super('openclaw');
  }
}
