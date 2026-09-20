import { readDshComposedMcpServerConfigs } from '@/modules/providers/list/dsh/dsh-cordis.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, McpTransport, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

/**
 * Provider registry MCP adapter for DSH.
 *
 * The DeepSeek Harness owns its MCP servers inside its Cordis composition, so
 * this adapter is read-only: it reports what the harness composes for the
 * profile the runtime boots (see `readDshComposedMcpServerConfigs`), and every
 * write throws instead of silently succeeding, so the UI never claims a server
 * was saved when nothing was persisted. Global MCP operations iterate every
 * provider with per-provider error capture, so this error only marks the `dsh`
 * entry as failed rather than aborting the whole operation.
 *
 * The declared transports mirror what the harness's ACP layer accepts when a
 * client hands it a server list: a bare stdio declaration or `type: "http"`
 * (streamable HTTP). It rejects SSE, and its handshake advertises only
 * `mcpCapabilities: { http: true }`, so `sse` must not be declared here even
 * though DSH itself can host MCP servers. The same rule governs the read path:
 * the harness's `streamable-http` reads as `http`, and any other declaration is
 * skipped rather than shown as a transport the harness does not use.
 */

/** Harness transport declarations, mapped to the transport the settings list can display. */
const DSH_TRANSPORT_BY_DECLARATION: Record<string, McpTransport> = {
  stdio: 'stdio',
  'streamable-http': 'http',
};

export class DshMcpProvider extends McpProvider {
  constructor() {
    super('dsh', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    // DSH has no per-project MCP scope: its servers come from the harness home
    // and the booted profile, so they are reported under `user` only. Returning
    // them for `project` as well would list the same server once per project.
    return scope === 'user' ? readDshComposedMcpServerConfigs() : {};
  }

  protected async writeScopedServers(
    _scope: McpScope,
    _workspacePath: string,
    _servers: Record<string, unknown>,
  ): Promise<void> {
    throw new AppError('DSH manages its MCP servers inside its harness composition.', {
      code: 'DSH_MCP_NOT_MANAGED',
      statusCode: 400,
    });
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    return {
      name: input.name,
      transport: input.transport,
      ...(input.command ? { command: input.command } : {}),
      ...(input.url ? { url: input.url } : {}),
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    const declaredTransport = readOptionalString(config.transport);
    const transport = declaredTransport ? DSH_TRANSPORT_BY_DECLARATION[declaredTransport] : undefined;
    if (!transport) {
      return null;
    }

    return {
      provider: 'dsh',
      name,
      scope,
      transport,
      command: readOptionalString(config.command),
      args: readStringArray(config.args),
      env: readStringRecord(config.env),
      cwd: readOptionalString(config.cwd),
      url: readOptionalString(config.url),
      headers: readStringRecord(config.headers),
    };
  }
}
