import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ZcodeSessionSynchronizer } from '@/modules/providers/list/zcode/zcode-session-synchronizer.provider.js';

import { seedZcodeSession } from './fixtures/zcode-session-db.js';

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
