import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { collectAbandonedAssets } from '@/modules/assets/services/asset-gc.service.js';
import { closeConnection, getConnection, initializeDatabase } from '@/modules/database/index.js';

/** Upload timestamp old enough that the grace period is long over. */
const STORED_AT = 1_700_000_000_000;

/**
 * Runs one collector pass against a throwaway home directory.
 *
 * The collector resolves the asset folder from `os.homedir()` and the session
 * index from the database, so both have to be redirected or the pass would
 * delete the developer's real uploads.
 */
async function withTempHome(run: (root: string) => Promise<void>): Promise<void> {
  const previousHome = process.env.HOME;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = await mkdtemp(path.join(os.tmpdir(), 'asset-gc-'));
  const databasePath = path.join(root, 'auth.db');

  closeConnection();
  process.env.HOME = root;
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  await initializeDatabase();

  try {
    await run(root);
  } finally {
    closeConnection();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(root, { recursive: true, force: true });
  }
}

/** Writes one stored asset with an mtime that has already aged out. */
async function writeAgedAsset(assetsDirectory: string, fileName: string): Promise<string> {
  const filePath = path.join(assetsDirectory, fileName);
  await writeFile(filePath, 'x');
  const aged = new Date(STORED_AT);
  await utimes(filePath, aged, aged);
  return filePath;
}

test('a compressed DSH transcript keeps the assets it references', async () => {
  await withTempHome(async (root) => {
    const assetsDirectory = path.join(root, '.cloudcli', 'assets');
    await mkdir(assetsDirectory, { recursive: true });

    const referenced = `${STORED_AT}-1-shot.png`;
    const orphan = `${STORED_AT}-2-orphan.png`;
    const referencedPath = await writeAgedAsset(assetsDirectory, referenced);
    const orphanPath = await writeAgedAsset(assetsDirectory, orphan);

    // DSH stores one JSONL line per Zstandard frame; the collector has to
    // decode them before the path reference is visible at all.
    const transcript = path.join(root, 'session.v4.jsonl.zstd');
    const line = JSON.stringify({ text: `${assetsDirectory}/${referenced}` });
    await writeFile(transcript, zlib.zstdCompressSync(Buffer.from(`${line}\n`)));

    getConnection()
      .prepare('INSERT INTO sessions (session_id, provider, jsonl_path) VALUES (?, ?, ?)')
      .run('dsh-session', 'dsh', transcript);

    const removed = await collectAbandonedAssets(new Date(), 0);

    assert.equal(removed, 1);
    await assert.doesNotReject(access(referencedPath));
    await assert.rejects(access(orphanPath));
  });
});
