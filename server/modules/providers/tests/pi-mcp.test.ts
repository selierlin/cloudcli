import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PiMcpProvider } from '@/modules/providers/list/pi/pi-mcp.provider.js';
import { AppError } from '@/shared/utils.js';

/**
 * Runs `runTest` against a throwaway agent directory exposed through
 * `PI_CODING_AGENT_DIR`, which is how Pi (and `getPiAgentDir`) resolves where
 * `mcp.json` lives.
 */
async function withPiAgentDir(
  files: Record<string, string>,
  runTest: (agentDir: string) => void | Promise<void>,
): Promise<void> {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const agentDir = await mkdtemp(path.join(os.tmpdir(), 'pi-mcp-test-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(agentDir, name), content, 'utf8');
  }

  try {
    await runTest(agentDir);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    await rm(agentDir, { recursive: true, force: true });
  }
}

const readJson = async (filePath: string): Promise<Record<string, any>> =>
  JSON.parse(await readFile(filePath, 'utf8')) as Record<string, any>;

const mcpFile = (agentDir: string): string => path.join(agentDir, 'mcp.json');

test('Pi MCP writes a stdio server without a type field and redacts secrets on the way out', { concurrency: false }, async () => {
  await withPiAgentDir({}, async (agentDir) => {
    const provider = new PiMcpProvider();
    const created = await provider.upsertServer({
      name: 'local-stdio',
      scope: 'user',
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { API_KEY: 'super-secret' },
      cwd: '/tmp/work',
    });

    assert.equal(created.name, 'local-stdio');
    assert.equal(created.transport, 'stdio');
    assert.deepEqual(created.env, { API_KEY: '<redacted>' });

    const persisted = await readJson(mcpFile(agentDir));
    // Pi infers stdio from `command`, so no `type` is written.
    assert.deepEqual(persisted.mcpServers['local-stdio'], {
      command: 'node',
      args: ['server.mjs'],
      env: { API_KEY: 'super-secret' },
      cwd: '/tmp/work',
      enabled: true,
    });
  });
});

test('Pi MCP writes an http server and leaves other top-level keys and untouched entries alone', { concurrency: false }, async () => {
  await withPiAgentDir({
    'mcp.json': JSON.stringify({
      version: 2,
      mcpServers: { existing: { command: 'old', timeout: 30 } },
    }),
  }, async (agentDir) => {
    const provider = new PiMcpProvider();
    await provider.upsertServer({
      name: 'remote-http',
      scope: 'user',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    });

    const persisted = await readJson(mcpFile(agentDir));
    assert.equal(persisted.version, 2);
    // An entry this projection did not touch keeps its Pi-owned fields and is
    // not given an `enabled` flag.
    assert.deepEqual(persisted.mcpServers.existing, { command: 'old', timeout: 30 });
    assert.deepEqual(persisted.mcpServers['remote-http'], {
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      enabled: true,
    });
  });
});

test('Pi MCP preserves the fields Pi owns when an entry is edited', { concurrency: false }, async () => {
  await withPiAgentDir({
    'mcp.json': JSON.stringify({
      mcpServers: {
        demo: {
          command: 'old-command',
          args: [],
          timeout: 30,
          exposure: 'all',
          oauth: { clientId: 'abc' },
        },
      },
    }),
  }, async (agentDir) => {
    const provider = new PiMcpProvider();
    await provider.upsertServer({
      name: 'demo',
      scope: 'user',
      transport: 'stdio',
      command: 'new-command',
      args: ['serve'],
    });

    const persisted = await readJson(mcpFile(agentDir));
    assert.deepEqual(persisted.mcpServers.demo, {
      timeout: 30,
      exposure: 'all',
      oauth: { clientId: 'abc' },
      command: 'new-command',
      args: ['serve'],
      env: {},
      enabled: true,
    });
  });
});

test('Pi MCP reads both transports back and keeps the working directory', { concurrency: false }, async () => {
  await withPiAgentDir({
    'mcp.json': JSON.stringify({
      mcpServers: {
        'local-stdio': { command: 'node', args: ['s.js'], env: { A: 'B' }, cwd: '/tmp/x' },
        'remote-http': { url: 'https://example.com/mcp', headers: { 'X-Test': '1' } },
      },
    }),
  }, async () => {
    const provider = new PiMcpProvider();
    const listed = await provider.listServersForScope('user');
    const byName = Object.fromEntries(listed.map((server) => [server.name, server]));

    assert.equal(byName['local-stdio']?.transport, 'stdio');
    assert.equal(byName['local-stdio']?.command, 'node');
    assert.equal(byName['local-stdio']?.cwd, '/tmp/x');
    assert.deepEqual(byName['local-stdio']?.env, { A: '<redacted>' });

    assert.equal(byName['remote-http']?.transport, 'http');
    assert.equal(byName['remote-http']?.url, 'https://example.com/mcp');
    assert.deepEqual(byName['remote-http']?.headers, { 'X-Test': '<redacted>' });
  });
});

test('Pi MCP removes one server and leaves the rest untouched', { concurrency: false }, async () => {
  await withPiAgentDir({
    'mcp.json': JSON.stringify({
      mcpServers: {
        keep: { command: 'keep', timeout: 5 },
        drop: { command: 'drop' },
      },
    }),
  }, async (agentDir) => {
    const provider = new PiMcpProvider();
    const removed = await provider.removeServer({ name: 'drop', scope: 'user' });
    assert.equal(removed.removed, true);

    const persisted = await readJson(mcpFile(agentDir));
    assert.deepEqual(persisted.mcpServers, { keep: { command: 'keep', timeout: 5 } });
  });
});

test('Pi MCP rejects names Pi cannot store and the names Pi treats as the same server', { concurrency: false }, async () => {
  await withPiAgentDir({
    'mcp.json': JSON.stringify({ mcpServers: { 'foo-bar': { command: 'existing' } } }),
  }, async () => {
    const provider = new PiMcpProvider();

    await assert.rejects(
      provider.upsertServer({ name: 'has space', scope: 'user', transport: 'stdio', command: 'node' }),
      (error: unknown) => error instanceof AppError && error.code === 'MCP_SERVER_NAME_INVALID',
    );

    // Pi ignores the difference between `-` and `_`, so this would silently
    // collide with the existing `foo-bar`.
    await assert.rejects(
      provider.upsertServer({ name: 'foo_bar', scope: 'user', transport: 'stdio', command: 'node' }),
      (error: unknown) => error instanceof AppError && error.code === 'MCP_SERVER_NAME_CONFLICT',
    );
  });
});

test('Pi MCP rejects SSE and every scope other than user', { concurrency: false }, async () => {
  await withPiAgentDir({}, async () => {
    const provider = new PiMcpProvider();

    await assert.rejects(
      provider.upsertServer({ name: 'x', scope: 'user', transport: 'sse', url: 'https://example.com/sse' }),
      (error: unknown) => error instanceof AppError && error.code === 'MCP_TRANSPORT_NOT_SUPPORTED',
    );
    for (const scope of ['local', 'project'] as const) {
      await assert.rejects(
        provider.upsertServer({ name: 'x', scope, transport: 'stdio', command: 'node' }),
        (error: unknown) => error instanceof AppError && error.code === 'MCP_SCOPE_NOT_SUPPORTED',
      );
    }
  });
});
