import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { DshSessionSynchronizer } from '@/modules/providers/list/dsh/dsh-session-synchronizer.provider.js';
import {
  DshSessionsProvider,
  encodeSessionSegment,
  projectKey,
} from '@/modules/providers/list/dsh/dsh-sessions.provider.js';

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

async function withIsolatedEnvironment(
  runTest: (env: { sessionsRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionsRoot = process.env.DSH_SESSIONS_ROOT;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-sessions-test-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const sessionsRoot = path.join(tempDirectory, 'sessions');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.DSH_SESSIONS_ROOT = sessionsRoot;
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
      delete process.env.DSH_SESSIONS_ROOT;
    } else {
      process.env.DSH_SESSIONS_ROOT = previousSessionsRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Writes one concatenated-zstd session log (header frame + event frames). */
async function writeSessionLog(
  sessionsRoot: string,
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

  const logDir = path.join(sessionsRoot, projectKey(cwd), encodeSessionSegment(acpSessionId));
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
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'abcd-1234-session';
    const appSessionId = 'app-session-1';
    const time = Date.now();
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
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
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'legacy-session-id';
    const appSessionId = 'app-session-legacy';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
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

test('fetchHistory pages the tail when limit/offset are supplied', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-paged';
    const appSessionId = 'app-session-paged';
    const time = Date.now();
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      userMessage('first prompt', 1, time),
      assistantMessage('first reply', 2, time + 100),
      userMessage('second prompt', 3, time + 200),
      assistantMessage('second reply', 4, time + 300),
    ]);

    sessionsDb.createAppSession(appSessionId, 'dsh', cwd, 'Paged');
    sessionsDb.assignProviderSessionId(appSessionId, acpSessionId);

    const provider = new DshSessionsProvider();

    // offset 0 returns the newest page and reports older messages remain.
    const firstPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 0 });
    assert.equal(firstPage.total, 4);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.limit, 2);
    assert.equal(firstPage.offset, 0);
    assert.deepEqual(
      firstPage.messages.map((m) => m.content),
      ['second prompt', 'second reply'],
    );

    // Walking the offset back reaches the remaining older messages.
    const secondPage = await provider.fetchHistory(appSessionId, { limit: 2, offset: 2 });
    assert.equal(secondPage.total, 4);
    assert.equal(secondPage.hasMore, false);
    assert.deepEqual(
      secondPage.messages.map((m) => m.content),
      ['first prompt', 'first reply'],
    );

    // A null limit returns everything regardless of the requested offset.
    const fullHistory = await provider.fetchHistory(appSessionId);
    assert.equal(fullHistory.hasMore, false);
    assert.equal(fullHistory.messages.length, 4);
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

test('synchronizer isolates a failing session directory from the rest of the scan', async (t) => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeSessionLog(sessionsRoot, cwd, 'good-session-1', [
      userMessage('Good prompt', 1, Date.now()),
    ]);
    await writeSessionLog(sessionsRoot, cwd, 'bad-session-1', [
      userMessage('Bad prompt', 1, Date.now()),
    ]);
    projectsDb.createProjectPath(cwd);

    // Simulate a broken session whose upsert blows up mid-scan. Without the
    // per-session try/catch this rejection would abort the whole DSH sync and
    // stall the scan_state cursor.
    const originalLookup = sessionsDb.getSessionByProviderSessionId;
    t.mock.method(sessionsDb, 'getSessionByProviderSessionId', (sessionId: string) => {
      if (sessionId === 'bad-session-1') {
        throw new Error('boom');
      }
      return originalLookup(sessionId);
    });

    const synchronizer = new DshSessionSynchronizer();
    const processed = await synchronizer.synchronize();

    // The scan must survive the bad session and still index the good one.
    assert.equal(processed, 1);
    assert.ok(sessionsDb.getSessionById('good-session-1'));
    assert.equal(sessionsDb.getSessionById('bad-session-1'), null);
  });
});

test('synchronizer indexes session logs for registered projects', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-index-1';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      userMessage('Build a CLI tool', 1, Date.now()),
      assistantMessage('Done', 2, Date.now() + 100),
    ]);
    projectsDb.createProjectPath(cwd);

    const synchronizer = new DshSessionSynchronizer();
    const processed = await synchronizer.synchronize();
    assert.equal(processed, 1);

    const indexed = sessionsDb.getSessionById(acpSessionId);
    assert.equal(indexed?.provider, 'dsh');
    assert.equal(indexed?.project_path, cwd);
    assert.equal(indexed?.custom_name, 'Build a CLI tool');
    assert.ok(indexed?.jsonl_path?.endsWith('session.jsonl.zstd'));
  });
});

test('synchronizer keeps the app-assigned name and does not duplicate app sessions', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-app-1';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      userMessage('Another prompt', 1, Date.now()),
      assistantMessage('Reply', 2, Date.now() + 100),
    ]);
    sessionsDb.createAppSession('app-dsh-1', 'dsh', cwd, 'CloudCLI title');
    sessionsDb.assignProviderSessionId('app-dsh-1', acpSessionId);

    const synchronizer = new DshSessionSynchronizer();
    const processed = await synchronizer.synchronize();
    assert.equal(processed, 1);
    assert.equal(sessionsDb.getAllSessions().length, 1);
    assert.equal(sessionsDb.getSessionById('app-dsh-1')?.custom_name, 'CloudCLI title');
    assert.equal(sessionsDb.getSessionById('app-dsh-1')?.provider_session_id, acpSessionId);
  });
});

test('synchronizer does not resurrect archived sessions on a full re-scan', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-archived';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      userMessage('Keep this hidden', 1, Date.now()),
    ]);
    projectsDb.createProjectPath(cwd);

    const synchronizer = new DshSessionSynchronizer();
    await synchronizer.synchronize();
    sessionsDb.updateSessionIsArchived(acpSessionId, true);

    const processed = await synchronizer.synchronize();
    assert.equal(processed, 0);
    assert.equal(sessionsDb.getSessionById(acpSessionId)?.isArchived, 1);
    assert.deepEqual(sessionsDb.getAllSessions().map((s) => s.session_id), []);
  });
});

test('synchronizer keeps a real title when a later re-scan cannot derive a name', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-name';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      userMessage('Real session title', 1, Date.now()),
    ]);
    projectsDb.createProjectPath(cwd);

    const synchronizer = new DshSessionSynchronizer();
    await synchronizer.synchronize();
    assert.equal(sessionsDb.getSessionById(acpSessionId)?.custom_name, 'Real session title');

    // Rewrite the log so no real user prompt remains; a re-scan must not
    // downgrade the stored title to the placeholder.
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      assistantMessage('Only assistant content', 2, Date.now() + 100),
    ]);
    await synchronizer.synchronize();

    assert.equal(sessionsDb.getSessionById(acpSessionId)?.custom_name, 'Real session title');
  });
});

test('synchronizeFile indexes one session log by path', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-file-1';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      userMessage('File trigger', 1, Date.now()),
    ]);
    projectsDb.createProjectPath(cwd);

    const logPath = path.join(
      sessionsRoot,
      projectKey(cwd),
      encodeSessionSegment(acpSessionId),
      'session.jsonl.zstd',
    );
    const synchronizer = new DshSessionSynchronizer();
    const sessionId = await synchronizer.synchronizeFile(logPath);

    assert.equal(sessionId, acpSessionId);
    assert.equal(sessionsDb.getSessionById(acpSessionId)?.project_path, cwd);
  });
});

test('resolveTranscriptPath resolves an existing session log path', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-resolve-1';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [userMessage('Hi', 1, Date.now())]);
    projectsDb.createProjectPath(cwd);

    const synchronizer = new DshSessionSynchronizer();
    const resolved = await synchronizer.resolveTranscriptPath(acpSessionId, cwd);

    assert.equal(
      resolved,
      path.join(sessionsRoot, projectKey(cwd), encodeSessionSegment(acpSessionId), 'session.jsonl.zstd'),
    );
  });
});

test('synchronizer does not recreate a session from a leftover directory after the row and file are gone', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-ghost';
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [userMessage('Gone', 1, Date.now())]);
    projectsDb.createProjectPath(cwd);

    const synchronizer = new DshSessionSynchronizer();
    await synchronizer.synchronize();
    assert.ok(sessionsDb.getSessionById(acpSessionId));

    // Simulate a permanent delete: the DB row and the transcript file are both
    // removed, but the session directory itself is left behind on disk.
    sessionsDb.deleteSessionById(acpSessionId);
    await rm(path.join(
      sessionsRoot,
      projectKey(cwd),
      encodeSessionSegment(acpSessionId),
      'session.jsonl.zstd',
    ));

    await synchronizer.synchronize();
    assert.equal(sessionsDb.getSessionById(acpSessionId), null);
  });
});

test('resolveTranscriptPath returns null when no session log exists', async () => {
  await withIsolatedEnvironment(async ({ cwd }) => {
    projectsDb.createProjectPath(cwd);

    const synchronizer = new DshSessionSynchronizer();
    assert.equal(await synchronizer.resolveTranscriptPath('dsh-missing-1', cwd), null);
  });
});

test('fetchHistory skips injected-context user messages', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const acpSessionId = 'dsh-session-injected';
    const appSessionId = 'app-session-injected';
    const time = Date.now();
    await writeSessionLog(sessionsRoot, cwd, acpSessionId, [
      {
        type: 'user/message',
        seq: 1,
        time,
        data: {
          content: [{ type: 'text', text: '<system-reminder>\nThe following workspace instructions...' }],
          source: { kind: 'agent-instructions', form: 'instructions' },
          role: 'user',
          id: 'inject-1',
        },
      },
      userMessage('你好', 2, time + 10),
      {
        type: 'user/message',
        seq: 3,
        time: time + 20,
        data: {
          content: [{ type: 'text', text: 'Current runtime context snapshot...' }],
          source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
          role: 'user',
          id: 'inject-2',
        },
      },
      assistantMessage('你好！有什么可以帮你？', 4, time + 30),
    ]);

    sessionsDb.createAppSession(appSessionId, 'dsh', cwd, 'Injected');
    sessionsDb.assignProviderSessionId(appSessionId, acpSessionId);

    const provider = new DshSessionsProvider();
    const result = await provider.fetchHistory(appSessionId);

    assert.equal(result.total, 2);
    assert.equal(result.messages[0]?.role, 'user');
    assert.equal(result.messages[0]?.content, '你好');
    assert.equal(result.messages[1]?.role, 'assistant');
    assert.equal(result.messages[1]?.content, '你好！有什么可以帮你？');
  });
});
