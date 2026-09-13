import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  getZcodeConfigPath,
  getZcodeHomeDir,
} from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

const REDACTED_MCP_VALUE = '<redacted>';
const CONFIG_SYMLINK_ERROR = 'ZCode config file must not be a symbolic link.';

/**
 * A cheap identity for one config file read, used to detect a concurrent writer
 * between the read and the atomic rename. `mtimeMs` + `size` is not a proof of
 * equality, but it is enough to catch the realistic cases (zcode-sync or the
 * desktop app rewriting the same file) and costs nothing extra.
 */
type FileSnapshot = {
  exists: boolean;
  mtimeMs: number | null;
  size: number | null;
};

const EMPTY_SNAPSHOT: FileSnapshot = { exists: false, mtimeMs: null, size: null };

async function readSnapshot(filePath: string): Promise<FileSnapshot> {
  try {
    const stats = await stat(filePath);
    return { exists: true, mtimeMs: stats.mtimeMs, size: stats.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_SNAPSHOT;
    }
    throw error;
  }
}

const snapshotsEqual = (left: FileSnapshot, right: FileSnapshot): boolean =>
  left.exists === right.exists
  && left.mtimeMs === right.mtimeMs
  && left.size === right.size;

/** Rejects a config path that is (or has become) a symlink. */
async function assertNotSymlink(filePath: string): Promise<void> {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new AppError(CONFIG_SYMLINK_ERROR, {
        code: 'ZCODE_CONFIG_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

/**
 * Reads one config file with its snapshot.
 *
 * A missing file reads as an empty document. Corrupt JSON is reported as a
 * readable error instead of being treated as empty: writing back an empty
 * document would silently destroy the user's providers, MCP servers, and
 * permission settings.
 */
async function readConfigFile(filePath: string): Promise<{ config: Record<string, unknown>; snapshot: FileSnapshot }> {
  await assertNotSymlink(filePath);
  const snapshot = await readSnapshot(filePath);
  if (!snapshot.exists) {
    return { config: {}, snapshot };
  }

  let content: string;
  try {
    const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      content = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new AppError(CONFIG_SYMLINK_ERROR, {
        code: 'ZCODE_CONFIG_SYMLINK_NOT_ALLOWED',
        statusCode: 400,
      });
    }
    throw error;
  }

  try {
    return { config: readObjectRecord(JSON.parse(content)) ?? {}, snapshot };
  } catch {
    throw new AppError(`ZCode config at ${filePath} is not valid JSON.`, {
      code: 'ZCODE_CONFIG_INVALID',
      statusCode: 400,
    });
  }
}

/**
 * Writes a config document atomically (temp file + rename), refusing to
 * overwrite the file when another writer changed it since `expected` was read.
 *
 * The rename is atomic, so readers never observe a half-written document; the
 * snapshot check narrows (but cannot fully close) the read-modify-write race
 * against zcode-sync and the desktop app.
 */
async function writeConfigFile(
  filePath: string,
  config: Record<string, unknown>,
  expected: FileSnapshot,
): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });

  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
      .then(async (handle) => {
        try {
          await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
        } finally {
          await handle.close();
        }
      });

    const current = await readSnapshot(filePath);
    if (!snapshotsEqual(current, expected)) {
      throw new AppError('ZCode config changed while it was being edited; re-read and try again.', {
        code: 'ZCODE_CONFIG_CONFLICT',
        statusCode: 409,
      });
    }

    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

const redactStringRecord = (record?: Record<string, string>): Record<string, string> | undefined => {
  if (!record || Object.keys(record).length === 0) {
    return undefined;
  }
  return Object.fromEntries(Object.keys(record).map((key) => [key, REDACTED_MCP_VALUE]));
};

/** Restores redacted env/headers values from the previous persisted entry. */
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
      // Clearing every value removes the field, matching the shared base
      // class's "omit a key to delete it" contract. Re-applying the previous
      // values here would make a persisted secret impossible to remove.
      delete merged[field];
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

/** Reads the `mcp.servers` map out of one parsed document. */
function readMcpServers(config: Record<string, unknown>): Record<string, unknown> {
  return readObjectRecord(readObjectRecord(config.mcp)?.servers) ?? {};
}

/** Returns a copy of `config` with `mcp.servers` replaced, preserving every other key. */
function withMcpServers(
  config: Record<string, unknown>,
  servers: Record<string, unknown>,
): Record<string, unknown> {
  const mcp = readObjectRecord(config.mcp) ?? {};
  return { ...config, mcp: { ...mcp, servers } };
}

/** True when an operation failed because the config changed under it. */
const isConfigConflict = (error: unknown): boolean =>
  error instanceof AppError && error.code === 'ZCODE_CONFIG_CONFLICT';

/**
 * How many times one read-modify-write cycle is retried after losing a race
 * with zcode-sync or the desktop app. Each retry re-reads the file, so the
 * second attempt merges on top of the other writer's change.
 */
const CONFIG_WRITE_MAX_ATTEMPTS = 3;

/** Provider registry MCP adapter for ZCode's `mcp.servers` config key. */
export class ZcodeMcpProvider extends McpProvider {
  private readonly operationLocks = new Map<string, Promise<void>>();
  /** Snapshot of each config file as of the read that produced the caller's server map. */
  private readonly readSnapshots = new Map<string, FileSnapshot>();

  constructor() {
    super('zcode', ['user', 'project'], ['stdio', 'http', 'sse']);
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const scope = input.scope ?? 'project';
    return this.withOperationLock(
      this.getOperationLockKey(scope, input.workspacePath),
      () => this.withConfigRetry(() => super.upsertServer(input)),
    );
  }

  async removeServer(input: { name: string; scope?: McpScope; workspacePath?: string }) {
    const scope = input.scope ?? 'project';
    return this.withOperationLock(
      this.getOperationLockKey(scope, input.workspacePath),
      () => this.withConfigRetry(() => super.removeServer(input)),
    );
  }

  /**
   * Re-runs a read-modify-write cycle when another writer changed the config
   * between our read and our rename. Each attempt re-reads, so the retry
   * preserves the other writer's change instead of overwriting it.
   */
  private async withConfigRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < CONFIG_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isConfigConflict(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  /**
   * Serializes read-modify-write cycles within this process. Cross-process
   * writers are handled by the snapshot check in {@link writeConfigFile}.
   */
  private getOperationLockKey(scope: McpScope, workspacePath?: string): string {
    return `${scope}:${scope === 'user' ? getZcodeHomeDir() : path.resolve(workspacePath ?? process.cwd())}`;
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

  private resolveConfigPath(scope: McpScope, workspacePath: string): string {
    return scope === 'user'
      ? getZcodeConfigPath()
      : path.join(path.resolve(workspacePath), '.zcode', 'config.json');
  }

  /**
   * Lists servers without taking a write snapshot. A LIST racing an upsert
   * must not overwrite the snapshot the upsert's read captured, or the conflict
   * check in {@link writeScopedServers} could pass against the wrong baseline
   * and silently drop a concurrent writer's change.
   */
  async listServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    if (!this.supportedScopes.includes(scope)) {
      return [];
    }

    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    const scopedServers = await this.readScopedServersForList(scope, workspacePath);
    return Object.entries(scopedServers)
      .map(([name, rawConfig]) => this.normalizeServerConfig(scope, name, rawConfig))
      .filter((entry): entry is ProviderMcpServer => entry !== null)
      .map((entry) => this.sanitizeServerForResponse(entry));
  }

  /**
   * Read path used by write operations. Records the config snapshot so
   * {@link writeScopedServers} can detect a concurrent writer between this
   * read and the atomic rename.
   */
  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = this.resolveConfigPath(scope, workspacePath);
    const { config, snapshot } = await readConfigFile(filePath);
    this.readSnapshots.set(filePath, snapshot);
    return readMcpServers(config);
  }

  /** Pure read for LIST; never records a snapshot. */
  private async readScopedServersForList(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const filePath = this.resolveConfigPath(scope, workspacePath);
    const { config } = await readConfigFile(filePath);
    return readMcpServers(config);
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const filePath = this.resolveConfigPath(scope, workspacePath);
    const { config } = await readConfigFile(filePath);

    const previousServers = readMcpServers(config);
    const nextServers = Object.fromEntries(
      Object.entries(servers).map(([name, serverConfig]) => [
        name,
        restoreRedactedValues(serverConfig as Record<string, unknown>, previousServers[name]),
      ]),
    );

    // The snapshot from `readScopedServers` is authoritative: the file must
    // still be the one this server map was derived from, or the merge would
    // silently drop a concurrent writer's change.
    const expected = this.readSnapshots.get(filePath) ?? EMPTY_SNAPSHOT;
    await writeConfigFile(filePath, withMcpServers(config, nextServers), expected);
    // The snapshot has served its purpose; drop it so the map cannot grow with
    // one entry per touched config file. A retry re-reads and re-records it.
    this.readSnapshots.delete(filePath);
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
        ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
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
      ...(input.headers && Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
    };
  }

  protected normalizeServerConfig(
    _scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    const configuredType = readOptionalString(config.type);
    const command = readOptionalString(config.command);
    if (configuredType === 'stdio' || (!configuredType && command)) {
      if (!command) {
        return null;
      }
      return {
        provider: 'zcode',
        name,
        scope: _scope,
        transport: 'stdio',
        command,
        args: readStringArray(config.args),
        env: redactStringRecord(readStringRecord(config.env)),
        cwd: readOptionalString(config.cwd),
      };
    }

    const url = readOptionalString(config.url);
    if (!url) {
      return null;
    }

    return {
      provider: 'zcode',
      name,
      scope: _scope,
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
