import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import { resetPiCommandForTests } from '@/modules/providers/list/pi/pi-auth.provider.js';
import { PiForkProvider } from '@/modules/providers/list/pi/pi-fork.provider.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pi-mock-cli.mjs'),
);

beforeEach(() => {
  resetPiCommandForTests();
});

afterEach(() => {
  resetPiCommandForTests();
  delete process.env.PI_COMMAND;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_MOCK_ARGS_FILE;
});

test('Pi forks a whole session through the native CLI and discovers its child transcript', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-fork-test-'));
  const projectPath = path.join(root, 'project');
  const sourcePath = path.join(root, 'source.jsonl');
  const argsPath = path.join(root, 'fork-args.json');
  await mkdir(projectPath, { recursive: true });
  await writeFile(sourcePath, '{"type":"session","id":"source"}\n');
  process.env.PI_COMMAND = MOCK_CLI;
  process.env.PI_CODING_AGENT_SESSION_DIR = path.join(root, 'sessions');
  process.env.PI_MOCK_ARGS_FILE = argsPath;
  resetPiCommandForTests();

  try {
    const result = await new PiForkProvider().forkSession({
      providerSessionId: 'source',
      jsonlPath: sourcePath,
      projectPath,
    });
    assert.equal(result.providerSessionId, 'mock-fork-session-uuid');
    assert.match(result.jsonlPath, /mock-fork-session-uuid\.jsonl$/);
    const args = JSON.parse(await readFile(argsPath, 'utf8')) as string[];
    assert.deepEqual(args, ['--fork', sourcePath, '--mode', 'json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
