import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Provider registry MCP adapter for OMP.
 *
 * OMP can consume MCP servers from several of its own config files, but
 * CloudCLI does not manage them yet, so the app reports every scope as empty.
 * Writes throw instead of silently succeeding, so the UI never claims a server
 * was saved when nothing was persisted. Global MCP operations iterate every
 * provider with per-provider error capture, so this error only marks the `omp`
 * entry as failed rather than aborting the whole operation.
 */
export class OmpMcpProvider extends McpProvider {
  constructor() {
    super('omp', [], []);
  }

  protected async readScopedServers(_scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    return {};
  }

  protected async writeScopedServers(
    _scope: McpScope,
    _workspacePath: string,
    _servers: Record<string, unknown>,
  ): Promise<void> {
    throw new AppError('OMP MCP server configuration is not managed by CloudCLI yet.', {
      code: 'OMP_MCP_NOT_MANAGED',
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
