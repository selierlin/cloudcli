import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WorkbuddyForkProvider } from '@/modules/providers/list/workbuddy/workbuddy-fork.provider.js';
import { AppError } from '@/shared/utils.js';

const SOURCE_SESSION_ID = 'src-session';

const userRow = (id: string, text: string) => ({
  id,
  type: 'message',
  role: 'user',
  timestamp: 1_000,
  sessionId: SOURCE_SESSION_ID,
  cwd: '/tmp/workspace',
  content: [{ type: 'input_text', text }],
});

const assistantRow = (id: string, parentId: string, text: string) => ({
  id,
  parentId,
  type: 'message',
  role: 'assistant',
  timestamp: 2_000,
  sessionId: SOURCE_SESSION_ID,
  cwd: '/tmp/workspace',
  content: [{ type: 'output_text', text }],
});

const TRANSCRIPT = [
  userRow('u1', 'first prompt'),
  assistantRow('a1', 'u1', 'first reply'),
  userRow('u2', 'second prompt'),
  assistantRow('a2', 'u2', 'second reply'),
];

async function withTranscript(
  runTest: (env: { srcPath: string; tempDir: string }) => void | Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wb-fork-test-'));
  const srcPath = path.join(tempDir, `${SOURCE_SESSION_ID}.jsonl`);
  await writeFile(srcPath, `${TRANSCRIPT.map((row) => JSON.stringify(row)).join('\n')}\n`);
  try {
    await runTest({ srcPath, tempDir });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readRows(jsonlPath: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(jsonlPath, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test('forking without an anchor copies the whole transcript into a new session', async () => {
  await withTranscript(async ({ srcPath }) => {
    const forked = await new WorkbuddyForkProvider().forkSession({
      providerSessionId: SOURCE_SESSION_ID,
      jsonlPath: srcPath,
      projectPath: '/tmp/workspace',
    });

    assert.notEqual(forked.providerSessionId, SOURCE_SESSION_ID);
    assert.equal(path.dirname(forked.jsonlPath), path.dirname(srcPath));
    const rows = await readRows(forked.jsonlPath);
    assert.deepEqual(rows.map((row) => row.id), ['u1', 'a1', 'u2', 'a2']);
    assert.deepEqual(
      rows.map((row) => row.sessionId),
      Array(4).fill(forked.providerSessionId),
    );
  });
});

test('forking from an AI reply keeps the turn up to and including that reply', async () => {
  await withTranscript(async ({ srcPath }) => {
    const forked = await new WorkbuddyForkProvider().forkSession({
      providerSessionId: SOURCE_SESSION_ID,
      jsonlPath: srcPath,
      projectPath: '/tmp/workspace',
      upToAnchorId: 'a2',
    });

    const rows = await readRows(forked.jsonlPath);
    assert.deepEqual(rows.map((row) => row.id), ['u1', 'a1', 'u2', 'a2']);
    // The cut is inclusive and at a turn boundary, so the last kept row's
    // parentId still points at a kept row — the chain survives a resume.
    assert.equal(rows[rows.length - 1].parentId, 'u2');
    assert.deepEqual(
      rows.map((row) => row.sessionId),
      Array(4).fill(forked.providerSessionId),
    );
  });
});

test('forking from a user prompt keeps the transcript up to that prompt', async () => {
  await withTranscript(async ({ srcPath }) => {
    const forked = await new WorkbuddyForkProvider().forkSession({
      providerSessionId: SOURCE_SESSION_ID,
      jsonlPath: srcPath,
      projectPath: '/tmp/workspace',
      upToAnchorId: 'u2',
    });

    const rows = await readRows(forked.jsonlPath);
    assert.deepEqual(rows.map((row) => row.id), ['u1', 'a1', 'u2']);
    assert.equal(rows[rows.length - 1].role, 'user');
  });
});

test('forking from a message that is no longer in the transcript rejects the fork', async () => {
  await withTranscript(async ({ srcPath }) => {
    await assert.rejects(
      new WorkbuddyForkProvider().forkSession({
        providerSessionId: SOURCE_SESSION_ID,
        jsonlPath: srcPath,
        projectPath: '/tmp/workspace',
        upToAnchorId: 'a-missing',
      }),
      (error: unknown) => error instanceof AppError && error.code === 'FORK_ANCHOR_NOT_FOUND',
    );
  });
});
