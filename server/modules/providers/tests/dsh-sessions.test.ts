import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  DshSessionsProvider,
  encodeSessionSegment,
  projectKey,
} from '@/modules/providers/list/dsh/dsh-sessions.provider.js';

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

async function withIsolatedEnvironment(
  runTest: (env: { harnessRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousHarnessRoot = process.env.DSH_HARNESS_ROOT;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-sessions-test-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const harnessRoot = path.join(tempDirectory, 'harness');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.DSH_HARNESS_ROOT = harnessRoot;
  await initializeDatabase();
  await mkdir(cwd, { recursive: true });

  try {
    await runTest({ harnessRoot, cwd });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousHarnessRoot === undefined) {
      delete process.env.DSH_HARNESS_ROOT;
    } else {
      process.env.DSH_HARNESS_ROOT = previousHarnessRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Writes one concatenated-zstd session log (header frame + event frames). */
async function writeSessionLog(
  harnessRoot: string,
  cwd: string,
  acpSessionId: string,
  events: unknown[],
): Promise<void> {
  const header = {
    type: 'session',
    version: 0,
    id: acpSessionId,
    createdAt: Date.now(),
    cwd,
    delegationDepth: 0,
  };
  const lines = [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))];
  const frames = lines.map((line) => zlib.zstdCompressSync(Buffer.from(`${line}\n`)));

  const logDir = path.join(harnessRoot, '.sessions', projectKey(cwd), encodeSessionSegment(acpSessionId));
  await mkdir(logDir, { recursive: true });
  await writeFile(path.join(logDir, 'session.jsonl.zstd'), Buffer.concat(frames));
}

const userMessage = (text: string, seq: number, time: number) => ({
  type: 'user/message',
  seq,
  time,
  data: {
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
    role: 'user',
    id: `user-${seq}`,
  },
});

const assistantMessage = (text: string, seq: number, time: number) => ({
  type: 'assistant/message',
  seq,
  time,
  data: {
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      id: `assistant-${seq}`,
    },
  },
});

test('projectKey mirrors the DSH JSONL directory encoding', () => {
  assert.equal(
    projectKey('/Users/selier/Projects/open_projects/claudecodeui'),
    '--Users-selier-Projects-open_projects-claudecodeui--',
  );
  assert.equal(projectKey('C:\\Users\\me\\proj'), '--C-Users-me-proj--');
  assert.equal(encodeSessionSegment('a-b_c.d'), 'a-b_c.d');
  assert.equal(encodeSessionSegment('~x'), '~007Ex');
});

test('fetchHistory decodes the DSH JSONL session log via the provider session id', async () => {
  await withIsolatedEnvironment(async ({ harnessRoot, cwd }) => {
    const acpSessionId = 'abcd-1234-session';
    const appSessionId = 'app-session-1';
    const time = Date.now();
    await writeSessionLog(harnessRoot, cwd, acpSessionId, [
      userMessage('hello there', 1, time),
      assistantMessage('Hi! How can I help?', 2, time + 100),
    ]);

    sessionsDb.createAppSession(appSessionId, 'dsh', cwd, 'Test session');
    sessionsDb.assignProviderSessionId(appSessionId, acpSessionId);

    const provider = new DshSessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 2);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'hello there');
    assert.equal(result.messages[1]?.role, 'assistant');
    assert.equal(result.messages[1]?.content, 'Hi! How can I help?');
    assert.equal(result.messages[1]?.provider, 'dsh');
  });
});

test('fetchHistory falls back to the newest log when the provider session id is unknown', async () => {
  await withIsolatedEnvironment(async ({ harnessRoot, cwd }) => {
    const acpSessionId = 'legacy-session-id';
    const appSessionId = 'app-session-legacy';
    await writeSessionLog(harnessRoot, cwd, acpSessionId, [
      userMessage('from legacy session', 1, Date.now()),
      assistantMessage('Legacy reply', 2, Date.now() + 100),
    ]);

    // provider_session_id stays null to simulate a session created before the
    // runtime announced its ACP id.
    sessionsDb.createAppSession(appSessionId, 'dsh', cwd, 'Legacy');

    const provider = new DshSessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 2);
    assert.equal(result.messages[0]?.content, 'from legacy session');
    assert.equal(result.messages[1]?.content, 'Legacy reply');
  });
});

test('fetchHistory returns empty history when no session log exists', async () => {
  await withIsolatedEnvironment(async ({ cwd }) => {
    const appSessionId = 'app-session-empty';
    sessionsDb.createAppSession(appSessionId, 'dsh', cwd, 'Empty');

    const provider = new DshSessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  });
});
