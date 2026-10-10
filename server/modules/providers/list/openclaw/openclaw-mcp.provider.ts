import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Provider registry MCP adapter for OpenClaw.
 *
 * OpenClaw keeps its MCP servers in the user config (`openclaw.json` →
 * `mcp.servers`) with a single user scope. CloudCLI does not manage that file
 * yet, so the app reports every scope as empty and writes throw instead of
 * silently succeeding. Global MCP operations iterate every provider with
 * per-provider error capture, so this error only marks the `openclaw` entry as
 * failed rather than aborting the whole operation.
 *
 * Consumed by `providerMcpService` and `mcpCatalogService`.
 */
export class OpenclawMcpProvider extends McpProvider {
  constructor() {
    super('openclaw', [], []);
  }

  protected async readScopedServers(_scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    return {};
  }

  protected async writeScopedServers(
    _scope: McpScope,
    _workspacePath: string,
    _servers: Record<string, unknown>,
  ): Promise<void> {
    throw new AppError('OpenClaw MCP server configuration is not managed by CloudCLI yet.', {
      code: 'OPENCLAW_MCP_NOT_MANAGED',
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

  protected normalizeServerConfig(_scope: McpScope, _name: string, _rawConfig: unknown): ProviderMcpServer | null {
    return null;
  }
}
