import { mcpServersDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { restoreRedactedMcpValues } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type {
  LLMProvider,
  McpScope,
  McpTestConnectionInput,
  McpTestConnectionResult,
  McpTestConnectionSource,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';

/** How long the connection probe waits before giving up on an endpoint. */
const MCP_TEST_TIMEOUT_MS = 8000;

/** Caps how much of a failed response body the probe echoes back, so an HTML error page cannot flood the form. */
const MAX_ERROR_DETAIL_CHARS = 300;

/**
 * Collapses one response body into a short single-line detail for the inline
 * result message. `null` means the body carried nothing worth showing.
 */
const summarizeBodyForDisplay = (body: string): string | null => {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return null;
  }

  return collapsed.length > MAX_ERROR_DETAIL_CHARS
    ? `${collapsed.slice(0, MAX_ERROR_DETAIL_CHARS)}…`
    : collapsed;
};

/**
 * Reads the persisted headers of one saved server so a probe can restore the
 * `<redacted>` markers the edit form echoed back. A missing entry or an
 * unreadable harness yields `undefined`, leaving the request untouched — the
 * probe then behaves exactly as it did before.
 */
const resolvePersistedTestHeaders = async (
  source: McpTestConnectionSource,
): Promise<Record<string, string> | undefined> => {
  if (source.kind === 'catalog') {
    return mcpServersDb.getCatalogEntry(source.id)?.config.headers;
  }

  try {
    const provider = providerRegistry.resolveProvider(source.provider);
    const servers = await provider.mcp.listRawServersForScope(source.scope, {
      workspacePath: source.workspacePath,
    });
    return servers.find((server) => server.name === source.name)?.headers;
  } catch {
    return undefined;
  }
};

/**
 * Extracts the JSON-RPC message from a reply that may be plain JSON or a
 * streamable-HTTP/SSE body whose payload rides on `data:` lines.
 */
const parseMcpJsonRpcReply = (body: string): unknown => {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  const dataLines = trimmed.split('\n').filter((line) => line.startsWith('data:'));
  const candidate = dataLines.length > 0 ? dataLines[dataLines.length - 1].slice(5).trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};


export const providerMcpService = {
  /**
   * Lists MCP servers for one provider grouped by supported scopes.
   */
  async listProviderMcpServers(
    providerName: string,
    options?: { workspacePath?: string },
  ): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.listServers(options);
  },

  /**
   * Lists MCP servers for one provider scope.
   */
  async listProviderMcpServersForScope(
    providerName: string,
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.listServersForScope(scope, options);
  },

  /**
   * Adds or updates one provider MCP server.
   */
  async upsertProviderMcpServer(
    providerName: string,
    input: UpsertProviderMcpServerInput,
  ): Promise<ProviderMcpServer> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.upsertServer(input);
  },

  /**
   * Probes an http/sse MCP endpoint with a JSON-RPC `initialize` and reports
   * whether it answered. This is the server-side half of the form's "test
   * connection" action: the browser cannot make the request itself (CORS), and
   * nothing here is persisted — the reply only tells the form whether the URL
   * and headers (token) are valid before it saves.
   *
   * When the form is editing a saved server it sends only redacted values, so
   * `source` lets the probe swap each `<redacted>` marker back for the stored
   * secret before the request goes out; the response is still redacted.
   */
  async testMcpConnectivity(input: McpTestConnectionInput): Promise<McpTestConnectionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MCP_TEST_TIMEOUT_MS);

    try {
      const headers = input.source
        ? restoreRedactedMcpValues(input.headers, await resolvePersistedTestHeaders(input.source))
        : input.headers;

      const response = await fetch(input.url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'cloudcli-mcp-test', version: '1' },
          },
        }),
        signal: controller.signal,
      });

      const body = await response.text();
      if (!response.ok) {
        const detail = summarizeBodyForDisplay(body);
        const status = `${response.status} ${response.statusText}`.trim();
        return {
          ok: false,
          status: response.status,
          error: detail ? `${status}: ${detail}` : status,
        };
      }

      const parsed = parseMcpJsonRpcReply(body) as
        | { result?: { serverInfo?: { name?: string }; protocolVersion?: string }; error?: { message?: string } }
        | null;
      if (!parsed || typeof parsed !== 'object') {
        const detail = summarizeBodyForDisplay(body);
        return {
          ok: false,
          status: response.status,
          error: detail ? `Invalid JSON-RPC response: ${detail}` : 'Invalid JSON-RPC response.',
        };
      }

      if (parsed.error) {
        return {
          ok: false,
          status: response.status,
          error: parsed.error.message || 'MCP server returned an error.',
        };
      }

      if (!parsed.result) {
        return { ok: false, status: response.status, error: 'No initialize result from MCP server.' };
      }

      return {
        ok: true,
        status: response.status,
        serverName: parsed.result.serverInfo?.name,
        protocolVersion: parsed.result.protocolVersion,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, error: 'Request timed out.' };
      }

      return { ok: false, error: error instanceof Error ? error.message : 'Request failed.' };
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Removes one provider MCP server.
   */
  async removeProviderMcpServer(
    providerName: string,
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.mcp.removeServer(input);
  },

  /**
   * Adds one MCP server to every provider on a best-effort basis.
   *
   * The scope and transport are validated by each provider, not here, so a
   * combination that only some providers accept (a `local` scope, or an `sse`
   * transport) still reaches the providers that support it. Every provider
   * that rejects the request is reported as `created: false` with its own
   * error rather than aborting the whole operation, which lets the caller
   * report exactly which providers were skipped.
   */
  async addMcpServerToAllProviders(
    input: Omit<UpsertProviderMcpServerInput, 'scope'> & { scope?: McpScope },
  ): Promise<Array<{ provider: LLMProvider; created: boolean; error?: string }>> {
    const scope = input.scope ?? 'project';
    const results: Array<{ provider: LLMProvider; created: boolean; error?: string }> = [];
    const providers = providerRegistry.listProviders();
    for (const provider of providers) {
      try {
        await provider.mcp.upsertServer({ ...input, scope });
        results.push({ provider: provider.id, created: true });
      } catch (error) {
        results.push({
          provider: provider.id,
          created: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  },

  /**
   * Removes one MCP server from every provider. Mirrors `addMcpServerToAllProviders`
   * by iterating the live provider registry, so callers stay in sync with which
   * providers exist instead of maintaining their own provider list.
   */
  async removeMcpServerFromAllProviders(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<Array<{ provider: LLMProvider; removed: boolean; error?: string }>> {
    const results: Array<{ provider: LLMProvider; removed: boolean; error?: string }> = [];
    const providers = providerRegistry.listProviders();
    for (const provider of providers) {
      try {
        const result = await provider.mcp.removeServer(input);
        results.push({ provider: provider.id, removed: result.removed });
      } catch (error) {
        results.push({
          provider: provider.id,
          removed: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  },
};
