import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  mcpServersDb,
} from '@/modules/database/index.js';

const EXPECTED_COLUMNS = [
  'id',
  'name',
  'transport',
  'server_config',
  'enabled_claude',
  'enabled_cursor',
  'enabled_codex',
  'enabled_opencode',
  'enabled_dsh',
  'enabled_workbuddy',
  'enabled_pi',
  'enabled_zcode',
  'enabled_omp',
  'created_at',
  'updated_at',
];

const allDisabled = {
  claude: false,
  cursor: false,
  codex: false,
  opencode: false,
  dsh: false,
  workbuddy: false,
  pi: false,
  zcode: false,
  omp: false,
};

const withDatabase = async (
  run: () => Promise<void>,
): Promise<void> => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-servers-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
};

test('migrations create the mcp_servers catalog table with its enable columns', async () => {
  await withDatabase(async () => {
    const columns = getConnection().prepare('PRAGMA table_info(mcp_servers)').all() as Array<{
      name: string;
    }>;
    assert.deepEqual(columns.map((column) => column.name), EXPECTED_COLUMNS);

    assert.deepEqual(mcpServersDb.listCatalogEntries(), []);
  });
});

test('mcp catalog repository round-trips entries with raw secrets and toggles one harness at a time', async () => {
  await withDatabase(async () => {
    const created = mcpServersDb.createCatalogEntry({
      name: 'filesystem',
      transport: 'stdio',
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { API_KEY: 'super-secret' },
      },
    });

    assert.ok(created.id.length > 0);
    assert.equal(created.name, 'filesystem');
    assert.equal(created.transport, 'stdio');
    assert.deepEqual(created.enabled, allDisabled);
    // The catalog stores the raw value; redaction is a response-boundary concern.
    assert.equal(created.config.env?.API_KEY, 'super-secret');

    assert.equal(mcpServersDb.getCatalogEntry(created.id)?.name, 'filesystem');
    assert.equal(mcpServersDb.findCatalogEntryByName('filesystem')?.id, created.id);
    assert.equal(mcpServersDb.findCatalogEntryByName('missing'), null);

    const toggled = mcpServersDb.setCatalogAppEnabled(created.id, 'codex', true);
    assert.equal(toggled?.enabled.codex, true);
    // Only the requested harness flipped.
    assert.deepEqual(
      Object.entries(toggled?.enabled ?? {}).filter(([, value]) => value).map(([key]) => key),
      ['codex'],
    );
    assert.equal(mcpServersDb.setCatalogAppEnabled(created.id, 'codex', false)?.enabled.codex, false);

    // Update replaces the definition and transport while keeping switches.
    mcpServersDb.setCatalogAppEnabled(created.id, 'claude', true);
    const updated = mcpServersDb.updateCatalogEntry(created.id, {
      name: 'filesystem',
      transport: 'http',
      config: { url: 'https://example.test/mcp', headers: { Authorization: 'Bearer t' } },
    });
    assert.equal(updated?.transport, 'http');
    assert.equal(updated?.config.url, 'https://example.test/mcp');
    assert.equal(updated?.enabled.claude, true);
    assert.equal(updated?.config.command, undefined);

    assert.equal(mcpServersDb.updateCatalogEntry('does-not-exist', {
      name: 'x',
      transport: 'stdio',
      config: {},
    }), null);

    const removed = mcpServersDb.deleteCatalogEntry(created.id);
    assert.equal(removed?.name, 'filesystem');
    assert.equal(mcpServersDb.getCatalogEntry(created.id), null);
    assert.equal(mcpServersDb.deleteCatalogEntry(created.id), null);
    assert.deepEqual(mcpServersDb.listCatalogEntries(), []);
  });
});

test('mcp catalog repository enforces the unique name and transport check constraints', async () => {
  await withDatabase(async () => {
    mcpServersDb.createCatalogEntry({ name: 'dup', transport: 'stdio', config: {} });

    assert.throws(
      () => mcpServersDb.createCatalogEntry({ name: 'dup', transport: 'http', config: {} }),
      (error: unknown) =>
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && String((error as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT'),
    );

    assert.throws(
      () => mcpServersDb.createCatalogEntry({
        name: 'bad-transport',
        // Bypasses the compile-time union to exercise the SQL CHECK.
        transport: 'websocket' as never,
        config: {},
      }),
      (error: unknown) =>
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && String((error as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT'),
    );
  });
});

test('mcp catalog repository lists entries ordered by name', async () => {
  await withDatabase(async () => {
    mcpServersDb.createCatalogEntry({ name: 'zeta', transport: 'stdio', config: {} });
    mcpServersDb.createCatalogEntry({ name: 'Alpha', transport: 'stdio', config: {} });

    assert.deepEqual(
      mcpServersDb.listCatalogEntries().map((entry) => entry.name),
      ['Alpha', 'zeta'],
    );
  });
});
