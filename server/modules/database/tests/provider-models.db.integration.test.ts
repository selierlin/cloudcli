import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  providerModelsDb,
  sessionsDb,
} from '@/modules/database/index.js';
import { runMigrations } from '@/modules/database/migrations.js';

const LEGACY_PROVIDER_MODELS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS provider_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL CHECK (provider IN ('claude', 'cursor', 'codex', 'opencode')),
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, model_id)
);
`;

test('provider model repository stores custom rows only and maintains session references', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const columns = getConnection().prepare('PRAGMA table_info(provider_models)').all() as Array<{
      name: string;
    }>;
    assert.deepEqual(columns.map((column) => column.name), [
      'id',
      'provider',
      'model_id',
      'model_name',
      'sort_order',
      'created_at',
      'updated_at',
    ]);
    assert.deepEqual(providerModelsDb.listCustomProviderModels('codex'), []);

    const custom = providerModelsDb.createCustomProviderModel('codex', {
      model: 'Private Gateway Model',
      id: 'gateway/model-v1',
    });
    assert.equal(custom.modelId, 'gateway/model-v1');
    assert.equal(
      providerModelsDb.findCustomProviderModelByModelId('codex', 'gateway/model-v1')?.recordId,
      custom.recordId,
    );

    const db = getConnection();
    db.prepare(`
      INSERT INTO projects (project_id, project_path)
      VALUES ('project-1', '/tmp/project-1')
    `).run();
    db.prepare(`
      INSERT INTO sessions (session_id, provider, project_path, model, effort)
      VALUES ('session-1', 'codex', '/tmp/project-1', 'gateway/model-v1', 'high')
    `).run();

    const updated = providerModelsDb.updateCustomProviderModel('codex', custom.recordId, {
      model: 'Private Gateway Model 2',
      id: 'gateway/model-v2',
    });
    assert.equal(updated?.modelId, 'gateway/model-v2');
    assert.equal(sessionsDb.getSessionById('session-1')?.model, 'gateway/model-v2');
    // A rename keeps the same underlying model, so its effort stays applicable.
    assert.equal(sessionsDb.getSessionById('session-1')?.effort, 'high');

    const removed = providerModelsDb.deleteCustomProviderModel(
      'codex',
      custom.recordId,
      'gpt-default',
    );
    assert.equal(removed?.modelId, 'gateway/model-v2');
    assert.equal(sessionsDb.getSessionById('session-1')?.model, 'gpt-default');
    // The effort belonged to the deleted model and must not survive onto the
    // fallback, which has its own default.
    assert.equal(sessionsDb.getSessionById('session-1')?.effort, null);
    assert.equal(providerModelsDb.getCustomProviderModel('codex', custom.recordId), null);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('migrations create the provider model index on an install that lacks it', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-index-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    const db = getConnection();
    // Upgraded installs reach runMigrations with provider_models present but no
    // index, so the CREATE INDEX statement is compiled against the real table
    // instead of short-circuiting on the existing index name.
    db.exec('DROP INDEX IF EXISTS idx_provider_models_provider_order');

    runMigrations(db);

    const indexedColumns = (db
      .prepare('PRAGMA index_info(idx_provider_models_provider_order)')
      .all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.deepEqual(indexedColumns, ['provider', 'sort_order', 'id']);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('migration widens the provider_models CHECK constraint and preserves existing rows', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-model-check-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  // Simulate an upgraded install: provider_models exists with the old CHECK
  // (missing dsh/workbuddy) and holds real user data.
  const legacy = new Database(databasePath);
  legacy.exec(LEGACY_PROVIDER_MODELS_SCHEMA_SQL);
  legacy
    .prepare(
      `INSERT INTO provider_models (provider, model_id, model_name)
       VALUES ('codex', 'gateway/model-v1', 'Legacy Custom Model')`
    )
    .run();
  legacy.close();

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    const db = getConnection();
    const definition = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_models'")
      .get() as { sql: string };

    // The CHECK constraint now accepts every provider from the target schema.
    for (const provider of ['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy']) {
      assert.match(definition.sql, new RegExp(`'${provider}'`));
    }

    // Rows survived the table rebuild.
    const row = db
      .prepare("SELECT provider, model_id FROM provider_models WHERE model_id = 'gateway/model-v1'")
      .get() as { provider: string; model_id: string };
    assert.deepEqual(row, { provider: 'codex', model_id: 'gateway/model-v1' });

    // The legacy table is gone and the widened table can accept dsh rows.
    const legacyTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_models_legacy'")
      .get();
    assert.equal(legacyTable, undefined);
    db.prepare(
      `INSERT INTO provider_models (provider, model_id, model_name)
       VALUES ('dsh', 'deepseek-v3', 'DeepSeek V3')`
    ).run();
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM provider_models WHERE provider = 'dsh'").get() as {
        count: number;
      }).count,
      1,
    );

    // The index is recreated after the rebuild that would have dropped it.
    const indexedColumns = (db
      .prepare('PRAGMA index_info(idx_provider_models_provider_order)')
      .all() as Array<{ name: string }>)
      .map((column) => column.name);
    assert.deepEqual(indexedColumns, ['provider', 'sort_order', 'id']);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
