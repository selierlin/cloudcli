import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { ZcodeMcpProvider } from '@/modules/providers/list/zcode/zcode-mcp.provider.js';
import { setZcodeHomeDirForTests } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { AppError } from '@/shared/utils.js';

const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const readJson = async (filePath: string): Promise<Record<string, any>> =>
  JSON.parse(await readFile(filePath, 'utf8')) as Record<string, any>;

beforeEach(() => {
  setZcodeHomeDirForTests(null);
});

afterEach(async () => {
  setZcodeHomeDirForTests(null);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('ZCode MCP persists user-scope servers while preserving unknown top-level keys', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-user-');
  setZcodeHomeDirForTests(storageDir);
  const configPath = path.join(storageDir, 'cli', 'config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    provider: { ark: { options: { apiKey: 'secret' } } },
    model: { main: 'ark/deepseek-v4-flash' },
    plugins: { enabled: true, dirs: ['/tmp/p'] },
  }), 'utf8');

  const provider = new ZcodeMcpProvider();
  const created = await provider.upsertServer({
    name: 'local-stdio',
    scope: 'user',
    transport: 'stdio',
    command: 'node',
    args: ['server.mjs'],
    env: { API_KEY: 'super-secret' },
  });
  assert.equal(created.name, 'local-stdio');
  assert.equal(created.transport, 'stdio');
  // Secrets are redacted on the way out.
  assert.deepEqual(created.env, { API_KEY: '<redacted>' });

  const persisted = await readJson(configPath);
  assert.deepEqual(persisted.provider, { ark: { options: { apiKey: 'secret' } } });
  assert.deepEqual(persisted.model, { main: 'ark/deepseek-v4-flash' });
  assert.deepEqual(persisted.plugins, { enabled: true, dirs: ['/tmp/p'] });
  assert.equal(persisted.mcp.servers['local-stdio'].command, 'node');
  assert.deepEqual(persisted.mcp.servers['local-stdio'].env, { API_KEY: 'super-secret' });

  const listed = await provider.listServersForScope('user');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.name, 'local-stdio');

  const removed = await provider.removeServer({ name: 'local-stdio', scope: 'user' });
  assert.equal(removed.removed, true);
  assert.deepEqual((await readJson(configPath)).mcp.servers, {});
});

test('ZCode MCP writes project-scope servers to the workspace .zcode config', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-storage-');
  const workspacePath = await makeTempDir('zcode-mcp-project-');
  setZcodeHomeDirForTests(storageDir);

  const provider = new ZcodeMcpProvider();
  await provider.upsertServer({
    name: 'remote-http',
    scope: 'project',
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
    workspacePath,
  });

  const configPath = path.join(workspacePath, '.zcode', 'config.json');
  const persisted = await readJson(configPath);
  assert.equal(persisted.mcp.servers['remote-http'].type, 'http');
  assert.deepEqual(persisted.mcp.servers['remote-http'].headers, { Authorization: 'Bearer token' });

  const listed = await provider.listServersForScope('project', { workspacePath });
  assert.deepEqual(listed[0]?.headers, { Authorization: '<redacted>' });
});

test('ZCode MCP rejects unsupported scopes and validates transport payloads', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-validate-');
  const workspacePath = await makeTempDir('zcode-mcp-validate-project-');
  setZcodeHomeDirForTests(storageDir);
  const provider = new ZcodeMcpProvider();

  await assert.rejects(
    provider.upsertServer({ name: 'x', scope: 'local', transport: 'stdio', command: 'node', workspacePath }),
    (error: unknown) => error instanceof AppError && error.code === 'MCP_SCOPE_NOT_SUPPORTED',
  );
  await assert.rejects(
    provider.upsertServer({ name: 'x', scope: 'project', transport: 'stdio', workspacePath }),
    (error: unknown) => error instanceof AppError && error.code === 'MCP_COMMAND_REQUIRED',
  );
  await assert.rejects(
    provider.upsertServer({ name: 'x', scope: 'project', transport: 'http', workspacePath }),
    (error: unknown) => error instanceof AppError && error.code === 'MCP_URL_REQUIRED',
  );
});

test('ZCode MCP refuses to overwrite a corrupt config and leaves it untouched', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-corrupt-');
  setZcodeHomeDirForTests(storageDir);
  const configPath = path.join(storageDir, 'cli', 'config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, '{ not json', 'utf8');

  const provider = new ZcodeMcpProvider();
  await assert.rejects(
    provider.upsertServer({ name: 'x', scope: 'user', transport: 'stdio', command: 'node' }),
    (error: unknown) => error instanceof AppError && error.code === 'ZCODE_CONFIG_INVALID',
  );
  assert.equal(await readFile(configPath, 'utf8'), '{ not json');
});

test('ZCode MCP rejects a symlinked config file', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-symlink-');
  setZcodeHomeDirForTests(storageDir);
  await mkdir(path.join(storageDir, 'cli'), { recursive: true });
  const realPath = path.join(storageDir, 'real-config.json');
  await writeFile(realPath, JSON.stringify({}), 'utf8');
  await symlink(realPath, path.join(storageDir, 'cli', 'config.json'));

  const provider = new ZcodeMcpProvider();
  await assert.rejects(
    provider.upsertServer({ name: 'x', scope: 'user', transport: 'stdio', command: 'node' }),
    (error: unknown) => error instanceof AppError && error.code === 'ZCODE_CONFIG_SYMLINK_NOT_ALLOWED',
  );
});

test('ZCode MCP aborts with a conflict when another writer changes the config every time', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-conflict-');
  setZcodeHomeDirForTests(storageDir);
  const configPath = path.join(storageDir, 'cli', 'config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ provider: { ark: { options: { apiKey: 'k' } } } }), 'utf8');

  const provider = new ZcodeMcpProvider();
  const originalRead = (provider as any).readScopedServers.bind(provider);
  let reads = 0;
  (provider as any).readScopedServers = async (scope: string, workspacePath: string) => {
    const servers = await originalRead(scope, workspacePath);
    reads += 1;
    // Simulate zcode-sync writing right after our read, every attempt.
    await writeFile(configPath, JSON.stringify({ provider: { ark: { options: { apiKey: `k${reads}` } } } }), 'utf8');
    return servers;
  };

  await assert.rejects(
    provider.upsertServer({ name: 'x', scope: 'user', transport: 'stdio', command: 'node' }),
    (error: unknown) => error instanceof AppError && error.code === 'ZCODE_CONFIG_CONFLICT',
  );
  assert.equal(reads, 3);
});

test('ZCode MCP retries after a transient conflict and preserves the other writer changes', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-retry-');
  setZcodeHomeDirForTests(storageDir);
  const configPath = path.join(storageDir, 'cli', 'config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ model: { main: 'ark/deepseek-v4-flash' } }), 'utf8');

  const provider = new ZcodeMcpProvider();
  const originalRead = (provider as any).readScopedServers.bind(provider);
  let modifiedOnce = false;
  (provider as any).readScopedServers = async (scope: string, workspacePath: string) => {
    const servers = await originalRead(scope, workspacePath);
    if (!modifiedOnce) {
      modifiedOnce = true;
      // A concurrent writer adds a provider; the retry must not drop it.
      await writeFile(configPath, JSON.stringify({
        model: { main: 'ark/deepseek-v4-flash' },
        provider: { ark: { options: { apiKey: 'from-sync' } } },
      }), 'utf8');
    }
    return servers;
  };

  const created = await provider.upsertServer({ name: 'retried', scope: 'user', transport: 'stdio', command: 'node' });
  assert.equal(created.name, 'retried');

  const persisted = await readJson(configPath);
  assert.deepEqual(persisted.provider, { ark: { options: { apiKey: 'from-sync' } } });
  assert.equal(persisted.mcp.servers.retried.command, 'node');
});

test('ZCode MCP writes atomically and leaves no temp files behind', { concurrency: false }, async () => {
  const storageDir = await makeTempDir('zcode-mcp-atomic-');
  setZcodeHomeDirForTests(storageDir);

  const provider = new ZcodeMcpProvider();
  await provider.upsertServer({ name: 'a', scope: 'user', transport: 'sse', url: 'https://example.com/sse' });

  const entries = await readdir(path.join(storageDir, 'cli'));
  assert.deepEqual(entries.filter((entry) => entry.includes('.tmp')), []);
  const persisted = await readJson(path.join(storageDir, 'cli', 'config.json'));
  assert.equal(persisted.mcp.servers.a.type, 'sse');
});
