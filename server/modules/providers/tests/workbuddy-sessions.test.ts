import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { WorkbuddySessionsProvider } from '@/modules/providers/list/workbuddy/workbuddy-sessions.provider.js';

async function withIsolatedEnvironment(
  runTest: (env: { sessionsRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionsRoot = process.env.WORKBUDDY_PROJECTS_ROOT;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'wb-sessions-test-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const sessionsRoot = path.join(tempDirectory, 'projects');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.WORKBUDDY_PROJECTS_ROOT = sessionsRoot;
  await initializeDatabase();
  await mkdir(cwd, { recursive: true });

  try {
    await runTest({ sessionsRoot, cwd });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSessionsRoot === undefined) {
      delete process.env.WORKBUDDY_PROJECTS_ROOT;
    } else {
      process.env.WORKBUDDY_PROJECTS_ROOT = previousSessionsRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Mirrors the engine's directory encoding: strip the leading slash, `/` → `-`. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/^\//, '').replace(/\//g, '-');
}

/** Writes one WorkBuddy JSONL transcript file with the given message events. */
async function writeTranscript(
  sessionsRoot: string,
  cwd: string,
  engineSessionId: string,
  events: unknown[],
): Promise<void> {
  const dir = path.join(sessionsRoot, encodeCwd(cwd));
  await mkdir(dir, { recursive: true });
  const lines = events.map((event) => JSON.stringify(event));
  await writeFile(path.join(dir, `${engineSessionId}.jsonl`), `${lines.join('\n')}\n`);
}

const userMessage = (text: string, timestamp: number) => ({
  type: 'message',
  role: 'user',
  timestamp,
  cwd: '/Users/test/project',
  content: [{ type: 'input_text', text: `<user_query>${text}</user_query>` }],
});

const assistantMessage = (text: string, timestamp: number) => ({
  type: 'message',
  role: 'assistant',
  timestamp,
  cwd: '/Users/test/project',
  content: [
    { type: 'reasoning_text', text: `thinking about ${text}` },
    { type: 'output_text', text },
  ],
});

test('fetchHistory decodes the WorkBuddy transcript via the provider session id', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-transcript-1';
    const appSessionId = 'app-wb-1';
    const time = Date.now();
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      userMessage('hello there', time),
      assistantMessage('Hi!', time + 100),
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'WB session');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const provider = new WorkbuddySessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 3);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, 'hello there');
    assert.equal(result.messages[1]?.role, 'assistant');
    assert.equal(result.messages[1]?.kind, 'thinking');
    assert.equal(result.messages[2]?.role, 'assistant');
    assert.equal(result.messages[2]?.content, 'Hi!');
    assert.equal(result.messages[2]?.provider, 'workbuddy');
  });
});

test('fetchHistory pages the tail when limit/offset are supplied', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const engineSessionId = 'wb-transcript-paged';
    const appSessionId = 'app-wb-paged';
    const time = Date.now();
    // Each assistant turn normalizes to a thinking + text pair, so the four
    // events become six messages: user, thinking, text, user, thinking, text.
    await writeTranscript(sessionsRoot, cwd, engineSessionId, [
      userMessage('first prompt', time),
      assistantMessage('first reply', time + 100),
      userMessage('second prompt', time + 200),
      assistantMessage('second reply', time + 300),
    ]);

    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Paged');
    sessionsDb.assignProviderSessionId(appSessionId, engineSessionId);

    const provider = new WorkbuddySessionsProvider();

    // offset 0 returns the newest page and reports older messages remain.
    const firstPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 0 });
    assert.equal(firstPage.total, 6);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.limit, 2);
    assert.equal(firstPage.offset, 0);
    assert.deepEqual(
      firstPage.messages.map((m) => m.content),
      ['thinking about second reply', 'second reply'],
    );

    // Walking the offset back reaches the middle of the conversation; older
    // messages (the first user turn) still remain.
    const secondPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 2 });
    assert.equal(secondPage.total, 6);
    assert.equal(secondPage.hasMore, true);
    assert.deepEqual(
      secondPage.messages.map((m) => m.content),
      ['first reply', 'second prompt'],
    );

    // The final walk reaches the oldest page and reports nothing remains.
    const oldestPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 4 });
    assert.equal(oldestPage.total, 6);
    assert.equal(oldestPage.hasMore, false);
    assert.deepEqual(
      oldestPage.messages.map((m) => m.content),
      ['first prompt', 'thinking about first reply'],
    );

    // A null limit returns everything.
    const fullHistory = await provider.fetchHistory(appSessionId);
    assert.equal(fullHistory.hasMore, false);
    assert.equal(fullHistory.messages.length, 6);
  });
});

test('fetchHistory returns empty history when no transcript exists', async () => {
  await withIsolatedEnvironment(async ({ cwd }) => {
    const appSessionId = 'app-wb-empty';
    sessionsDb.createAppSession(appSessionId, 'workbuddy', cwd, 'Empty');

    const provider = new WorkbuddySessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  });
});
