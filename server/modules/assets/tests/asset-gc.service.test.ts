import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isUploadStoredFileName,
  removeStoredAsset,
} from '@/modules/assets/services/image-assets.service.js';

const ASSETS_DIR = path.join(os.homedir(), '.cloudcli', 'assets');

/** Creates one stored asset file directly, as an upload would have. */
async function writeAsset(name: string): Promise<string> {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const filePath = path.join(ASSETS_DIR, name);
  await fs.writeFile(filePath, 'x');
  return filePath;
}

test('isUploadStoredFileName accepts only names the upload route mints', () => {
  assert.equal(isUploadStoredFileName('1793781131063-583071152-shot.png'), true);
  assert.equal(isUploadStoredFileName('1793-terms.pdf'), false, 'no random segment');
  assert.equal(isUploadStoredFileName('notes.pdf'), false);
  assert.equal(isUploadStoredFileName('../escape.png'), false);
});

test('removeStoredAsset deletes an uploaded file and reports absence as success', async () => {
  const name = `1793781131063-583071152-remove-${Date.now()}.txt`;
  const filePath = await writeAsset(name);

  assert.equal(await removeStoredAsset(name), true);
  await assert.rejects(fs.access(filePath));

  // Releasing an already-collected upload stays idempotent.
  assert.equal(await removeStoredAsset(name), true);
});

test('removeStoredAsset refuses names it did not mint', async () => {
  assert.equal(await removeStoredAsset('user-file.txt'), false);
  assert.equal(await removeStoredAsset('../user-file.txt'), false);
});
