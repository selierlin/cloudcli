import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, readdir, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeJsonConfig } from '@/shared/utils.js';

test('writeJsonConfig creates the parent directory and writes trailing-newline JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'write-json-config-'));
  const filePath = path.join(root, 'nested', 'config.json');

  await writeJsonConfig(filePath, { mcpServers: { demo: { command: 'echo' } } });

  const content = await readFile(filePath, 'utf8');
  assert.equal(content, `${JSON.stringify({ mcpServers: { demo: { command: 'echo' } } }, null, 2)}\n`);
});

test('writeJsonConfig keeps the permissions of the file it replaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'write-json-config-'));
  const filePath = path.join(root, 'config.json');
  await writeJsonConfig(filePath, { first: true });
  await chmod(filePath, 0o644);

  await writeJsonConfig(filePath, { second: true });

  assert.equal((await stat(filePath)).mode & 0o777, 0o644);
});

test('writeJsonConfig writes through a symlink instead of replacing it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'write-json-config-'));
  const realPath = path.join(root, 'dotfiles-config.json');
  const linkPath = path.join(root, 'linked-config.json');
  await writeJsonConfig(realPath, { first: true });
  await symlink(realPath, linkPath);

  await writeJsonConfig(linkPath, { second: true });

  assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(await readFile(realPath, 'utf8')), { second: true });
});

test('writeJsonConfig leaves no temp file behind', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'write-json-config-'));
  const filePath = path.join(root, 'config.json');

  await writeJsonConfig(filePath, { only: true });

  assert.deepEqual(await readdir(root), ['config.json']);
});
