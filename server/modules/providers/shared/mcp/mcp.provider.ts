import path from 'node:path';

import type { IProviderMcp } from '@/shared/interfaces.js';
import type { LLMProvider, McpScope, McpTransport, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const resolveWorkspacePath = (workspacePath?: string): string =>
  path.resolve(workspacePath ?? process.cwd());

const REDACTED_MCP_VALUE = '<redacted>';

const redactMcpValues = (values?: Record<string, string>): Record<string, string> | undefined => {
  if (!values || Object.keys(values).length === 0) {
    return undefined;
  }

  return Object.fromEntries(Object.keys(values).map((key) => [key, REDACTED_MCP_VALUE]));
};

/**
 * Preserves one persisted secret when the edit form submits its response-only
 * redaction marker. Omitting a key still removes it, while replacing a value
 * with any non-marker string intentionally updates it.
 */
const restoreRedactedMcpValues = (
  requested?: Record<string, string>,
  persisted?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!requested || !persisted) {
    return requested;
  }

  return Object.fromEntries(Object.entries(requested).map(([key, value]) => [
    key,
    value === REDACTED_MCP_VALUE && Object.prototype.hasOwnProperty.call(persisted, key)
      ? persisted[key]
      : value,
  ]));
};

const normalizeServerName = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) {
    throw new AppError('MCP server name is required.', {
      code: 'MCP_SERVER_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  return normalized;
};

/**
 * Shared MCP provider for provider-specific config readers/writers.
 */
export abstract class McpProvider implements IProviderMcp {
  protected readonly provider: LLMProvider;
  protected readonly supportedScopes: McpScope[];
  protected readonly supportedTransports: McpTransport[];

  protected constructor(
    provider: LLMProvider,
    supportedScopes: McpScope[],
    supportedTransports: McpTransport[],
  ) {
    this.provider = provider;
    this.supportedScopes = supportedScopes;
    this.supportedTransports = supportedTransports;
  }

  async listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const grouped: Record<McpScope, ProviderMcpServer[]> = {
      user: [],
      local: [],
      project: [],
    };

    for (const scope of this.supportedScopes) {
      grouped[scope] = await this.listServersForScope(scope, options);
    }

    return grouped;
  }

  async listServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    if (!this.supportedScopes.includes(scope)) {
      return [];
    }

    const workspacePath = resolveWorkspacePath(options?.workspacePath);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    return Object.entries(scopedServers)
      .map(([name, rawConfig]) => this.normalizeServerConfig(scope, name, rawConfig))
      .filter((entry): entry is ProviderMcpServer => entry !== null)
      .map((entry) => this.sanitizeServerForResponse(entry));
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const scope = input.scope ?? 'project';
    this.assertScopeAndTransport(scope, input.transport);

    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    const persistedServer = this.normalizeServerConfig(scope, normalizedName, scopedServers[normalizedName]);
    const restoredInput: UpsertProviderMcpServerInput = {
      ...input,
      env: restoreRedactedMcpValues(input.env, persistedServer?.env),
      headers: restoreRedactedMcpValues(input.headers, persistedServer?.headers),
      envHttpHeaders: restoreRedactedMcpValues(input.envHttpHeaders, persistedServer?.envHttpHeaders),
    };
    scopedServers[normalizedName] = this.buildServerConfig(restoredInput);
    await this.writeScopedServers(scope, workspacePath, scopedServers);

    return this.sanitizeServerForResponse({
      provider: this.provider,
      name: normalizedName,
      scope,
      transport: input.transport,
      command: restoredInput.command,
      args: restoredInput.args,
      env: restoredInput.env,
      cwd: restoredInput.cwd,
      url: restoredInput.url,
      headers: restoredInput.headers,
      envVars: restoredInput.envVars,
      bearerTokenEnvVar: restoredInput.bearerTokenEnvVar,
      envHttpHeaders: restoredInput.envHttpHeaders,
    });
  }

  /** Allows providers to remove sensitive values from mutation responses. */
  protected sanitizeServerForResponse(server: ProviderMcpServer): ProviderMcpServer {
    return {
      ...server,
      env: redactMcpValues(server.env),
      headers: redactMcpValues(server.headers),
      envHttpHeaders: redactMcpValues(server.envHttpHeaders),
    };
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    const scope = input.scope ?? 'project';
    this.assertScope(scope);

    const workspacePath = resolveWorkspacePath(input.workspacePath);
    const normalizedName = normalizeServerName(input.name);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    const removed = Object.prototype.hasOwnProperty.call(scopedServers, normalizedName);
    if (removed) {
      delete scopedServers[normalizedName];
      await this.writeScopedServers(scope, workspacePath, scopedServers);
    }

    return { removed, provider: this.provider, name: normalizedName, scope };
  }

  protected abstract readScopedServers(
    scope: McpScope,
    workspacePath: string,
  ): Promise<Record<string, unknown>>;

  protected abstract writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void>;

  protected abstract buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown>;

  protected abstract normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null;

  protected assertScope(scope: McpScope): void {
    if (!this.supportedScopes.includes(scope)) {
      throw new AppError(`Provider "${this.provider}" does not support "${scope}" MCP scope.`, {
        code: 'MCP_SCOPE_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
  }

  protected assertScopeAndTransport(scope: McpScope, transport: McpTransport): void {
    this.assertScope(scope);
    if (!this.supportedTransports.includes(transport)) {
      throw new AppError(`Provider "${this.provider}" does not support "${transport}" MCP transport.`, {
        code: 'MCP_TRANSPORT_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
  }
}
