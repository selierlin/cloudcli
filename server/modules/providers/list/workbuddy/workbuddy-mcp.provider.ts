import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Provider registry MCP adapter for WorkBuddy.
 *
 * The engine manages MCP servers through its own `codebuddy mcp` command and
 * the WorkBuddy desktop app's connector proxy, so the app treats the scope as
 * empty. Writes throw instead of silently succeeding, so the UI never claims a
 * server was saved when nothing was persisted.
 */
export class WorkbuddyMcpProvider extends McpProvider {
  constructor() {
    super('workbuddy', ['user', 'project'], ['stdio', 'http', 'sse']);
  }

  protected async readScopedServers(_scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    return {};
  }

  protected async writeScopedServers(
    _scope: McpScope,
    _workspacePath: string,
    _servers: Record<string, unknown>,
  ): Promise<void> {
    throw new AppError('WorkBuddy manages its MCP servers inside the WorkBuddy desktop app.', {
      code: 'WORKBUDDY_MCP_NOT_MANAGED',
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
