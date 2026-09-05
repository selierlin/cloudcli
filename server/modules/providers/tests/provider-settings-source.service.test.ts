import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { providerSettingsSourceService } from '@/modules/providers/services/provider-settings-source.service.js';
import { AppError } from '@/shared/utils.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'settings-source-'));
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

async function makeSettingsDirectory(tag: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `settings-files-${tag}-`));
  await writeFile(path.join(dir, 'settings-glm.json'), '{}', 'utf8');
  await writeFile(path.join(dir, 'setting-ollama.json'), '{}', 'utf8');
  // Ignored: not a settings-*.json match.
  await writeFile(path.join(dir, 'readme.json'), '{}', 'utf8');
  await writeFile(path.join(dir, 'settings-b.ts'), '{}', 'utf8');
  return dir;
}

test('providerSettingsSourceService lists discovered settings-*.json profiles', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await makeSettingsDirectory('list');
    try {
      const source = await providerSettingsSourceService.updateSource('claude', { directory: dir });

      assert.equal(source.directory, dir);
      assert.equal(source.activeFile, null);
      assert.equal(source.directoryError, null);
      assert.deepEqual(
        source.profiles.map((profile) => profile.name),
        ['glm', 'ollama'],
      );
      assert.deepEqual(
        source.profiles.map((profile) => profile.path),
        [path.join(dir, 'settings-glm.json'), path.join(dir, 'setting-ollama.json')],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('providerSettingsSourceService persists and resolves the active file', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await makeSettingsDirectory('active');
    try {
      const target = path.join(dir, 'settings-glm.json');
      await providerSettingsSourceService.updateSource('claude', { directory: dir });
      await providerSettingsSourceService.updateSource('claude', { activeFile: target });

      assert.equal(providerSettingsSourceService.resolveActiveSettingsFile('claude'), target);

      const source = await providerSettingsSourceService.getSource('claude');
      assert.equal(source.activeFile, target);

      // Clearing an empty string removes the selection.
      await providerSettingsSourceService.updateSource('claude', { activeFile: '' });
      assert.equal(providerSettingsSourceService.resolveActiveSettingsFile('claude'), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('providerSettingsSourceService partial updates preserve the other field', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await makeSettingsDirectory('partial');
    try {
      const target = path.join(dir, 'settings-glm.json');
      await providerSettingsSourceService.updateSource('claude', { directory: dir, activeFile: target });

      // Update only the directory (keep active file untouched).
      const dir2 = await makeSettingsDirectory('partial-2');
      try {
        const source = await providerSettingsSourceService.updateSource('claude', { directory: dir2 });
        assert.equal(source.directory, dir2);
        assert.equal(source.activeFile, target);
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('providerSettingsSourceService rejects a missing or file-based directory', async () => {
  await withIsolatedDatabase(async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'settings-invalid-'));
    try {
      const missing = path.join(root, 'does-not-exist');
      await assert.rejects(
        providerSettingsSourceService.updateSource('claude', { directory: missing }),
        (error: unknown) => error instanceof AppError && error.code === 'SETTINGS_DIRECTORY_INVALID',
      );

      const file = path.join(root, 'plain-file.json');
      await writeFile(file, '{}', 'utf8');
      await assert.rejects(
        providerSettingsSourceService.updateSource('claude', { directory: file }),
        (error: unknown) => error instanceof AppError && error.code === 'SETTINGS_DIRECTORY_INVALID',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('providerSettingsSourceService reports unreadable directories without throwing', async () => {
  await withIsolatedDatabase(async () => {
    const dir = await makeSettingsDirectory('gone');
    await providerSettingsSourceService.updateSource('claude', { directory: dir });
    await rm(dir, { recursive: true, force: true });

    const source = await providerSettingsSourceService.getSource('claude');
    assert.equal(source.directory, dir);
    assert.deepEqual(source.profiles, []);
    assert.ok(source.directoryError);
  });
});

test('providerSettingsSourceService isolates values per provider', async () => {
  await withIsolatedDatabase(async () => {
    await providerSettingsSourceService.updateSource('claude', { activeFile: '/tmp/settings-glm.json' });
    assert.equal(providerSettingsSourceService.resolveActiveSettingsFile('claude'), '/tmp/settings-glm.json');
    assert.equal(providerSettingsSourceService.resolveActiveSettingsFile('codex'), null);
  });
});
