import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ZcodeSessionSynchronizer } from '@/modules/providers/list/zcode/zcode-session-synchronizer.provider.js';

import { seedZcodeRichSession, seedZcodeSession } from './fixtures/zcode-session-db.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'zcode-provider-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Counts rows referencing one session, addressing `session` by id and the rest by session_id. */
const countRows = (db: Database.Database, table: string, sessionId: string): number => {
  const column = table === 'session' ? 'id' : 'session_id';
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(sessionId) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
};

test('ZCode synchronizer indexes sqlite sessions without deletable transcript paths', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-sync-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeSession(tempRoot, workspacePath, {
      sessionId: 'zcode-indexed-1',
      title: 'ZCode generated title',
      firstUserText: 'This prompt should be ignored',
    });
    await withIsolatedDatabase(async () => {
      const processed = await new ZcodeSessionSynchronizer().synchronize();

      assert.equal(processed, 1);
      const indexed = sessionsDb.getSessionById('zcode-indexed-1');
      assert.equal(indexed?.provider, 'zcode');
      // Project paths are stored as realpaths; on macOS the temp dir realpath
      // differs from the `/var/...` path returned by mkdtemp.
      assert.equal(indexed?.project_path, await realpath(workspacePath));
      assert.equal(indexed?.custom_name, 'ZCode generated title');
      assert.equal(indexed?.jsonl_path, null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode synchronizer stamps the content timestamp from the newest message', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-content-ts-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeRichSession(tempRoot, workspacePath);
    await withIsolatedDatabase(async () => {
      await new ZcodeSessionSynchronizer().synchronize();

      // The store's newest message was created at 1_700_000_002_000, but the
      // session's own `time_updated` is later (1_700_000_004_000) because a
      // rename/title write moved it. The content timestamp must follow the
      // message, so a rename cannot raise a false unread flag.
      assert.equal(
        sessionsDb.getSessionById('zcode-session-1')?.content_updated_at,
        new Date(1_700_000_002_000).toISOString(),
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode synchronizer preserves the title assigned when CloudCLI creates a session', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-sync-app-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeSession(tempRoot, workspacePath, {
      sessionId: 'zcode-app-1',
      title: 'ZCode generated title',
      firstUserText: 'ZCode first user prompt',
    });
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-1', 'zcode', workspacePath, 'Fix the checkout crash');
      sessionsDb.assignProviderSessionId('app-1', 'zcode-app-1');

      await new ZcodeSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the checkout crash');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode synchronizer falls back to the first user prompt when the session has no title', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-sync-untitled-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeSession(tempRoot, workspacePath, {
      sessionId: 'zcode-untitled-1',
      title: null,
      firstUserText: 'Explain the ZCode session store',
    });
    await withIsolatedDatabase(async () => {
      await new ZcodeSessionSynchronizer().synchronize();

      // The stored prompt is a JSON string literal; the reader must unwrap it.
      assert.equal(sessionsDb.getSessionById('zcode-untitled-1')?.custom_name, 'Explain the ZCode session store');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode synchronizer ignores archived sessions and non-database watcher paths', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-sync-archived-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeSession(tempRoot, workspacePath, {
      sessionId: 'zcode-archived-1',
      title: 'Archived',
      firstUserText: 'Archived prompt',
      archived: true,
    });
    await withIsolatedDatabase(async () => {
      const synchronizer = new ZcodeSessionSynchronizer();
      assert.equal(await synchronizer.synchronize(), 0);
      // Only the main database is a watcher target; the WAL sidecar is not.
      assert.equal(await synchronizer.synchronizeFile(path.join(tempRoot, '.zcode', 'cli', 'db', 'db.sqlite-wal')), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode permanent delete removes the session from the provider store so no scan re-indexes it', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-delete-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeSession(tempRoot, workspacePath, {
      sessionId: 'zcode-delete-1',
      title: 'Delete me',
      firstUserText: 'Delete this session',
    });
    const dbPath = path.join(tempRoot, '.zcode', 'cli', 'db', 'db.sqlite');
    await withIsolatedDatabase(async () => {
      const synchronizer = new ZcodeSessionSynchronizer();
      assert.equal(await synchronizer.synchronize(), 1);
      assert.ok(sessionsDb.getSessionById('zcode-delete-1'));

      await synchronizer.deleteProviderSession('zcode-delete-1');

      const db = new Database(dbPath, { readonly: true });
      try {
        assert.equal(countRows(db, 'session', 'zcode-delete-1'), 0);
        // `part` has no FK to `session` in ZCode's schema, so it must be
        // deleted by session_id explicitly or the transcript survives.
        assert.equal(countRows(db, 'part', 'zcode-delete-1'), 0);
        assert.equal(countRows(db, 'message', 'zcode-delete-1'), 0);
        // The fixture declares these without foreign keys, so they only go if
        // the delete names them explicitly rather than trusting a cascade.
        for (const table of ['session_entry', 'model_usage', 'turn_usage', 'tool_usage', 'input_history']) {
          assert.equal(countRows(db, table, 'zcode-delete-1'), 0, `${table} should be emptied`);
        }
      } finally {
        db.close();
      }

      // The app row is the service layer's job; what this asserts is that a
      // rescan finds nothing left to re-index.
      sessionsDb.deleteSessionById('zcode-delete-1');
      assert.equal(await synchronizer.synchronize(), 0);
      assert.equal(sessionsDb.getSessionById('zcode-delete-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode permanent delete tolerates a provider store that no longer holds the session', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-delete-absent-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeSession(tempRoot, workspacePath, {
      sessionId: 'zcode-delete-1',
      title: 'Delete me',
      firstUserText: 'Delete this session',
    });
    await withIsolatedDatabase(async () => {
      // Deleting twice must not throw: the sidebar can retry a delete whose
      // first attempt already pruned the store.
      const synchronizer = new ZcodeSessionSynchronizer();
      await synchronizer.deleteProviderSession('zcode-delete-1');
      await assert.doesNotReject(() => synchronizer.deleteProviderSession('zcode-delete-1'));
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
