import { constants as fsConstants } from 'node:fs';
import { access, lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

import { resolveWorkbuddyConfigDir } from './workbuddy-storage.provider.js';

const REDACTED_MCP_VALUE = '<redacted>';
const MCP_CONFIG_SYMLINK_ERROR = 'WorkBuddy MCP config must not be a symbolic link.';
const MCP_CONFIG_DIRECTORY_SYMLINK_ERROR = 'WorkBuddy MCP config directory must not be a symbolic link.';

function isTrustedSystemPathAlias(originalPath: string, canonicalPath: string): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }

  for (const alias of ['/var', '/tmp', '/etc']) {
    if (!originalPath.startsWith(`${alias}/`)) {
      continue;
    }
    const expectedCanonicalPath = `/private${originalPath}`;
    if (canonicalPath === expectedCanonicalPath) {
      return true;
    }
  }

  return false;
}

async function readWorkbuddyJsonConfig(filePath: string): Promise<Record<string, unknown>> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const content = await handle.readFile('utf8');
    const parsed = JSON.parse(content) as unknown;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {};
    }
    if (code === 'ELOOP') {
      throw new AppError(MCP_CONFIG_SYMLINK_ERROR, {
        code: 'MCP_CONFIG_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function writeWorkbuddyJsonConfig(filePath: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
      0o600,
    );
    // `mode` above applies only to newly-created files. Existing provider
    // configs can contain credentials, so tighten their permissions too.
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new AppError(MCP_CONFIG_SYMLINK_ERROR, {
        code: 'MCP_CONFIG_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function validateWorkbuddyConfigDirectory(configDirectory: string): Promise<string> {
  const normalizedPath = path.resolve(configDirectory);
  try {
    await mkdir(normalizedPath, { recursive: true });
    const stats = await lstat(normalizedPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new AppError(MCP_CONFIG_DIRECTORY_SYMLINK_ERROR, {
        code: 'MCP_CONFIG_DIRECTORY_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }

    const canonicalPath = await realpath(normalizedPath);
    if (canonicalPath !== normalizedPath && !isTrustedSystemPathAlias(normalizedPath, canonicalPath)) {
      throw new AppError(MCP_CONFIG_DIRECTORY_SYMLINK_ERROR, {
        code: 'MCP_CONFIG_DIRECTORY_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('WorkBuddy MCP config directory is unavailable.', {
      code: 'MCP_CONFIG_DIRECTORY_INVALID',
      statusCode: 400,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  return normalizedPath;
}

const redactStringRecord = (record?: Record<string, string>): Record<string, string> | undefined => {
  if (!record || Object.keys(record).length === 0) {
    return undefined;
  }

  return Object.fromEntries(Object.keys(record).map((key) => [key, REDACTED_MCP_VALUE]));
};

const restoreRedactedValues = (
  nextConfig: Record<string, unknown>,
  previousConfig: unknown,
): Record<string, unknown> => {
  const previous = readObjectRecord(previousConfig);
  if (!previous) {
    return nextConfig;
  }

  const merged = { ...nextConfig };
  for (const field of ['env', 'headers'] as const) {
    const nextValues = readStringRecord(nextConfig[field]);
    const previousValues = readStringRecord(previous[field]);
    if (!previousValues) {
      continue;
    }

    if (!nextValues || Object.keys(nextValues).length === 0) {
      merged[field] = previousValues;
      continue;
    }

    const restoredValues = { ...nextValues };
    for (const [key, value] of Object.entries(restoredValues)) {
      if (value === REDACTED_MCP_VALUE && Object.prototype.hasOwnProperty.call(previousValues, key)) {
        restoredValues[key] = previousValues[key];
      }
    }
    merged[field] = restoredValues;
  }

  return merged;
};

/** Ensures a WorkBuddy project MCP operation targets an active registered project. */
async function validateWorkbuddyWorkspacePath(workspacePath: string): Promise<string> {
  const normalizedPath = path.resolve(workspacePath);
  const project = projectsDb.getProjectPath(normalizedPath);
  if (!project || project.isArchived || path.resolve(project.project_path) !== normalizedPath) {
    throw new AppError('WorkBuddy MCP workspace is not a registered active project.', {
      code: 'MCP_WORKSPACE_NOT_REGISTERED',
      statusCode: 403,
    });
  }

  try {
    const workspaceStats = await lstat(normalizedPath);
    if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink()) {
      throw new AppError('WorkBuddy MCP workspace must be a real project directory.', {
        code: 'MCP_WORKSPACE_INVALID',
        statusCode: 400,
      });
    }
    const canonicalWorkspacePath = await realpath(normalizedPath);
    if (canonicalWorkspacePath !== normalizedPath && !isTrustedSystemPathAlias(normalizedPath, canonicalWorkspacePath)) {
      throw new AppError('WorkBuddy MCP workspace must use its real filesystem path.', {
        code: 'MCP_WORKSPACE_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('WorkBuddy MCP workspace is unavailable.', {
      code: 'MCP_WORKSPACE_INVALID',
      statusCode: 400,
      details: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const configStats = await lstat(path.join(normalizedPath, '.mcp.json'));
    if (configStats.isSymbolicLink()) {
      throw new AppError(MCP_CONFIG_SYMLINK_ERROR, {
        code: 'MCP_CONFIG_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return normalizedPath;
}

/**
 * Resolves the native config file holding one WorkBuddy MCP scope.
 *
 * WorkBuddy stores user MCP servers across two files in its config root (see
 * {@link getWorkbuddyUserMcpConfigPaths}), project MCP servers in the workspace
 * `.mcp.json`, and local MCP servers under the matching project entry in
 * `~/.codebuddy.json`.
 */
function getWorkbuddyMcpConfigPath(scope: McpScope, workspacePath: string): string {
  if (scope === 'user') {
    return path.join(resolveWorkbuddyConfigDir(), '.mcp.json');
  }
  if (scope === 'project') {
    return path.join(workspacePath, '.mcp.json');
  }
  return path.join(os.homedir(), '.codebuddy.json');
}

/**
 * Returns both user-scope config files WorkBuddy recognizes for MCP servers.
 *
 * The desktop app manages custom servers in `mcp.json` while the bundled
 * codebuddy CLI resolves `.mcp.json` first at runtime, so user-scope reads and
 * writes must cover both files to stay compatible with each surface.
 */
function getWorkbuddyUserMcpConfigPaths(configDir = resolveWorkbuddyConfigDir()): [dotPath: string, plainPath: string] {
  return [path.join(configDir, '.mcp.json'), path.join(configDir, 'mcp.json')];
}

const fileExists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false,
  );

function readScopedMcpServers(config: Record<string, unknown>, scope: McpScope, workspacePath: string): Record<string, unknown> {
  if (scope !== 'local') {
    return readObjectRecord(config.mcpServers) ?? {};
  }

  const projects = readObjectRecord(config.projects) ?? {};
  const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
  return readObjectRecord(projectConfig.mcpServers) ?? {};
}

/** Provider registry MCP adapter for WorkBuddy native configuration files. */
export class WorkbuddyMcpProvider extends McpProvider {
  private readonly operationLocks = new Map<string, Promise<void>>();

  constructor() {
    super('workbuddy', ['user', 'local', 'project'], ['stdio', 'http', 'sse']);
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const scope = input.scope ?? 'project';
    return this.withOperationLock(this.getOperationLockKey(scope, input.workspacePath), () => (
      super.upsertServer(input)
    ));
  }

  async removeServer(input: { name: string; scope?: McpScope; workspacePath?: string }) {
    const scope = input.scope ?? 'project';
    return this.withOperationLock(this.getOperationLockKey(scope, input.workspacePath), () => (
      super.removeServer(input)
    ));
  }

  private getOperationLockKey(scope: McpScope, workspacePath?: string): string {
    const target = scope === 'user'
      ? resolveWorkbuddyConfigDir()
      : path.resolve(workspacePath ?? process.cwd());
    return `${scope}:${target}`;
  }

  private async withOperationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationLocks.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.operationLocks.set(key, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.operationLocks.get(key) === current) {
        this.operationLocks.delete(key);
      }
    }
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    if (scope === 'user') {
      const configDir = await validateWorkbuddyConfigDirectory(resolveWorkbuddyConfigDir());
      const [dotPath, plainPath] = getWorkbuddyUserMcpConfigPaths(configDir);
      const [dotConfig, plainConfig] = await Promise.all([
        readWorkbuddyJsonConfig(dotPath),
        readWorkbuddyJsonConfig(plainPath),
      ]);
      return {
        ...readScopedMcpServers(plainConfig, scope, workspacePath),
        ...readScopedMcpServers(dotConfig, scope, workspacePath),
      };
    }

    const validatedWorkspacePath = await validateWorkbuddyWorkspacePath(workspacePath);
    const config = await readWorkbuddyJsonConfig(getWorkbuddyMcpConfigPath(scope, validatedWorkspacePath));
    return readScopedMcpServers(config, scope, validatedWorkspacePath);
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope === 'user') {
      await this.writeUserScopedServers(servers);
      return;
    }

    const validatedWorkspacePath = await validateWorkbuddyWorkspacePath(workspacePath);
    const configPath = getWorkbuddyMcpConfigPath(scope, validatedWorkspacePath);
    const config = await readWorkbuddyJsonConfig(configPath);
    if (scope !== 'local') {
      const previousServers = readObjectRecord(config.mcpServers) ?? {};
      config.mcpServers = Object.fromEntries(
        Object.entries(servers).map(([name, serverConfig]) => [
          name,
          restoreRedactedValues(serverConfig as Record<string, unknown>, previousServers[name]),
        ]),
      );
      await writeWorkbuddyJsonConfig(configPath, config);
      return;
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[validatedWorkspacePath]) ?? {};
    const previousServers = readObjectRecord(projectConfig.mcpServers) ?? {};
    projectConfig.mcpServers = Object.fromEntries(
      Object.entries(servers).map(([name, serverConfig]) => [
        name,
        restoreRedactedValues(serverConfig as Record<string, unknown>, previousServers[name]),
      ]),
    );
    projects[validatedWorkspacePath] = projectConfig;
    config.projects = projects;
    await writeWorkbuddyJsonConfig(configPath, config);
  }

  /**
   * Persists user-scope servers across both WorkBuddy config files.
   *
   * Each server is written back to the file it was originally read from, so
   * desktop-managed entries stay visible in `mcp.json` while CLI-managed entries
   * keep living in `.mcp.json`. Brand-new servers land in `.mcp.json` because
   * the CLI resolves it first, and removing a server deletes it from whichever
   * file contained it.
   */
  private async writeUserScopedServers(servers: Record<string, unknown>): Promise<void> {
    const configDir = await validateWorkbuddyConfigDirectory(resolveWorkbuddyConfigDir());
    const [dotPath, plainPath] = getWorkbuddyUserMcpConfigPaths(configDir);
    const [dotConfig, plainConfig, dotExists, plainExists] = await Promise.all([
      readWorkbuddyJsonConfig(dotPath),
      readWorkbuddyJsonConfig(plainPath),
      fileExists(dotPath),
      fileExists(plainPath),
    ]);

    const dotServers = readObjectRecord(dotConfig.mcpServers) ?? {};
    const plainServers = readObjectRecord(plainConfig.mcpServers) ?? {};

    const nextDotServers: Record<string, unknown> = {};
    const nextPlainServers: Record<string, unknown> = {};
    for (const [name, serverConfig] of Object.entries(servers)) {
      const inDot = Object.prototype.hasOwnProperty.call(dotServers, name);
      const inPlain = Object.prototype.hasOwnProperty.call(plainServers, name);
      if (inDot || !inPlain) {
        nextDotServers[name] = restoreRedactedValues(serverConfig as Record<string, unknown>, dotServers[name]);
      }
      if (inPlain) {
        nextPlainServers[name] = restoreRedactedValues(serverConfig as Record<string, unknown>, plainServers[name]);
      }
    }

    if (dotExists || Object.keys(nextDotServers).length > 0) {
      dotConfig.mcpServers = nextDotServers;
      await writeWorkbuddyJsonConfig(dotPath, dotConfig);
    }
    if (plainExists || Object.keys(nextPlainServers).length > 0) {
      plainConfig.mcpServers = nextPlainServers;
      await writeWorkbuddyJsonConfig(plainPath, plainConfig);
    }
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        type: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for HTTP and SSE MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: input.transport,
      url: input.url,
      headers: input.headers ?? {},
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

    const configuredType = readOptionalString(config.type);
    if (typeof config.command === 'string') {
      return {
        provider: 'workbuddy',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        args: readStringArray(config.args),
        env: redactStringRecord(readStringRecord(config.env)),
      };
    }

    const url = readOptionalString(config.url);
    if (!url) {
      return null;
    }

    return {
      provider: 'workbuddy',
      name,
      scope,
      transport: configuredType === 'sse' ? 'sse' : 'http',
      url,
      headers: redactStringRecord(readStringRecord(config.headers)),
    };
  }

  protected sanitizeServerForResponse(server: ProviderMcpServer): ProviderMcpServer {
    return {
      ...server,
      env: redactStringRecord(server.env),
      headers: redactStringRecord(server.headers),
    };
  }
}
