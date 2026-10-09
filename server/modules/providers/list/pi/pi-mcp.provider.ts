import path from 'node:path';

import { getPiAgentDir } from '@/modules/providers/list/pi/pi-models.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

/**
 * Provider registry MCP adapter for Pi.
 *
 * Pi 1.0+ has native MCP support, driven by the CLI's own `pi mcp` commands:
 * they read and write `<agentDir>/mcp.json` for the user scope (a trusted
 * project's `.pi/mcp.json` also exists, but CloudCLI does not manage it).
 * Entries live under a top-level `mcpServers` object keyed by server name, and
 * Pi infers the transport from the entry itself — a `command` makes it stdio, a
 * `url` makes it streamable HTTP. There is no `type` field and no SSE support,
 * which is why this adapter advertises only those two transports.
 *
 * Fields Pi owns on an entry (`timeout`, `exposure`, `oauth`, …) are preserved
 * across an edit; only the connection fields are replaced.
 */

/** Name of Pi's user-level MCP file inside the agent directory. */
const PI_MCP_FILE_NAME = 'mcp.json';

/** Entry fields Pi owns; an edit here replaces only the connection fields and leaves these alone. */
const PI_NATIVE_FIELDS = ['timeout', 'description', 'exposure', 'toolExposure', 'oauth', 'auth'] as const;

/**
 * Pi server names may contain letters, digits, `_` and `-` only, and Pi treats
 * two names that differ only in `-` versus `_` as the same server.
 */
const normalizePiServerName = (name: string): string => name.replace(/-/g, '_');

/** Rejects a name Pi would not accept, before the file is touched. */
const assertPiServerName = (name: string): void => {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new AppError(`Pi MCP server names may only contain letters, digits, "_" and "-": ${name}`, {
      code: 'MCP_SERVER_NAME_INVALID',
      statusCode: 400,
    });
  }
};

/**
 * Rebuilds one entry for writing: Pi's own fields survive, the connection
 * fields come from `next`, and an entry that is not being changed is returned
 * untouched so a projection never rewrites unrelated entries.
 */
const mergePiEntry = (persisted: unknown, next: unknown): unknown => {
  const nextRecord = readObjectRecord(next);
  if (!nextRecord) {
    return next;
  }

  const previous = readObjectRecord(persisted);
  if (!previous || JSON.stringify(previous) === JSON.stringify(nextRecord)) {
    return next;
  }

  const preserved: Record<string, unknown> = {};
  for (const field of PI_NATIVE_FIELDS) {
    if (previous[field] !== undefined) {
      preserved[field] = previous[field];
    }
  }

  return { ...preserved, ...nextRecord };
};

export class PiMcpProvider extends McpProvider {
  constructor() {
    super('pi', ['user'], ['stdio', 'http']);
  }

  /** Absolute path to Pi's user-level MCP file. */
  private filePath(): string {
    return path.join(getPiAgentDir(), PI_MCP_FILE_NAME);
  }

  protected async readScopedServers(scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    if (scope !== 'user') {
      return {};
    }

    const config = await readJsonConfig(this.filePath());
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    _workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope !== 'user') {
      return;
    }

    const names = Object.keys(servers);
    for (const name of names) {
      assertPiServerName(name);

      const normalized = normalizePiServerName(name);
      const clash = names.find((other) => other !== name && normalizePiServerName(other) === normalized);
      if (clash) {
        throw new AppError(
          `Pi treats "${name}" and "${clash}" as the same MCP server because it ignores the difference between "-" and "_".`,
          { code: 'MCP_SERVER_NAME_CONFLICT', statusCode: 409 },
        );
      }
    }

    // Re-read the whole document: only `mcpServers` is replaced, so any other
    // top-level field Pi persists survives, and each entry is merged so the
    // fields Pi owns are not dropped by an edit here.
    const filePath = this.filePath();
    const document = await readJsonConfig(filePath);
    const persisted = readObjectRecord(document.mcpServers) ?? {};
    document.mcpServers = Object.fromEntries(
      Object.entries(servers).map(([name, config]) => [name, mergePiEntry(persisted[name], config)]),
    );
    await writeJsonConfig(filePath, document);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    // Pi derives the transport from the entry's fields, so no `type` is written
    // (the `pi mcp add` command omits it too). SSE never reaches this point: the
    // base class's scope/transport gate rejects it first.
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
        ...(input.cwd ? { cwd: input.cwd } : {}),
        enabled: true,
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      url: input.url,
      headers: input.headers ?? {},
      enabled: true,
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

    if (typeof config.command === 'string') {
      return {
        provider: 'pi',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
        cwd: readOptionalString(config.cwd),
      };
    }

    if (typeof config.url === 'string') {
      return {
        provider: 'pi',
        name,
        scope,
        transport: 'http',
        url: config.url,
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
