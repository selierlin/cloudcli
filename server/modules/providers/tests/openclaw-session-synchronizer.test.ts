import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  getOpenclawAgentDbPath,
  getOpenclawConfigPath,
  setOpenclawHomeDirForTests,
} from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import { OpenclawSessionSynchronizer } from '@/modules/providers/list/openclaw/openclaw-session-synchronizer.provider.js';

import {
  openclawHeaderEntry,
  openclawMessageEntry,
  seedOpenclawSession,
} from './fixtures/openclaw-agent-db.js';

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    const run = cleanup;
    cleanup = null;
    await run();
  }
});

async function withIsolatedEnvironment(
  runTest: (env: { homeDir: string; cwd: string }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'openclaw-sync-'));
  const databasePath = path.join(tempRoot, 'auth.db');
  const cwd = path.join(tempRoot, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  setOpenclawHomeDirForTests(tempRoot);
  await initializeDatabase();
  await mkdir(cwd, { recursive: true });

  cleanup = async () => {
    closeConnection();
    setOpenclawHomeDirForTests(null);
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempRoot, { recursive: true, force: true });
  };

  await runTest({ homeDir: tempRoot, cwd });
}

const user = (id: string, content: unknown) => openclawMessageEntry(id, { role: 'user', content });

test('synchronize indexes an agent session from its transcript header', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      displayName: 'Nightly triage',
      createdAt: 1_776_000_000_000,
      updatedAt: 1_776_000_010_000,
      lastInteractionAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'Please triage the alerts.') },
      ],
    });

    const processed = await new OpenclawSessionSynchronizer().synchronize();
    assert.equal(processed, 1);

    const session = sessionsDb.getSessionById(sessionKey);
    assert.ok(session);
    assert.equal(session.provider, 'openclaw');
    // The header cwd is realpath'd, so compare against the resolved path.
    assert.equal(session.project_path, realpathSync(cwd));
    assert.equal(session.jsonl_path, null);
    // The node's display name wins over the first prompt.
    assert.equal(session.custom_name, 'Nightly triage');
  });
});

test('synchronize backfills a store older than the cursor on the first scan only', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const oldAt = 1_776_000_000_000;
    await seedOpenclawSession(homeDir, {
      sessionKey: 'agent:main:pre-existing',
      windowId: 'window-1',
      updatedAt: oldAt,
      lastInteractionAt: oldAt,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'predates the integration') },
      ],
    });

    const synchronizer = new OpenclawSessionSynchronizer();
    const cursor = new Date(oldAt + 86_400_000);

    // The first scan ignores the cursor, so a store whose sessions predate the
    // persisted global cursor still surfaces them instead of hiding them forever.
    assert.equal(await synchronizer.synchronize(cursor), 1);
    assert.ok(sessionsDb.getSessionById('agent:main:pre-existing'));

    // Once the backfill has run, the cursor is honored and the stale row is skipped.
    assert.equal(await synchronizer.synchronize(cursor), 0);
  });
});

test('synchronize falls back to the first non-injected user prompt for the name', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      displayName: null,
      label: null,
      updatedAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        // The startup prompt carries no context marker; it must be recognised by
        // its prefix so the session is not named after bootstrap scaffolding.
        { json: user('u0', 'A new session was started via /new or /reset. Execute your Session Startup sequence now.') },
        { json: user('u1', 'Summarize the incident timeline.') },
      ],
    });

    await new OpenclawSessionSynchronizer().synchronize();
    assert.equal(sessionsDb.getSessionById(sessionKey)?.custom_name, 'Summarize the incident timeline.');
  });
});

test('synchronize falls back to the default workspace when the header has no usable cwd', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const workspace = path.join(homeDir, 'default-workspace');
    await mkdir(workspace, { recursive: true });
    await writeFile(
      getOpenclawConfigPath(),
      JSON.stringify({ agents: { defaults: { workspace } } }),
    );

    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: 1_776_000_010_000,
      events: [
        { json: { type: 'session', version: 3 } },
        { json: user('u1', `hello from ${cwd}`) },
      ],
    });

    await new OpenclawSessionSynchronizer().synchronize();
    assert.equal(sessionsDb.getSessionById(sessionKey)?.project_path, realpathSync(workspace));
  });
});

test('synchronize skips a session OpenClaw itself archived', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: 1_776_000_010_000,
      archivedAt: 1_776_000_020_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'archived in openclaw') },
      ],
    });

    assert.equal(await new OpenclawSessionSynchronizer().synchronize(), 0);
    assert.equal(sessionsDb.getSessionById(sessionKey), null);
  });
});

test('synchronize does not un-archive an app-archived session', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'old') },
      ],
    });

    const synchronizer = new OpenclawSessionSynchronizer();
    await synchronizer.synchronize();
    sessionsDb.updateSessionIsArchived(sessionKey, true);

    // A re-scan with an unchanged `updated_at` must keep the archived flag.
    await synchronizer.synchronize();
    assert.equal(sessionsDb.getSessionById(sessionKey)?.isArchived, 1);
  });
});

test('synchronizeFile derives the agent id and ignores other files', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'watch me') },
      ],
    });

    const synchronizer = new OpenclawSessionSynchronizer();
    assert.equal(await synchronizer.synchronizeFile(path.join(homeDir, 'agents', 'main', 'agent', 'openclaw-agent.sqlite-wal')), null);
    const first = await synchronizer.synchronizeFile(getOpenclawAgentDbPath('main'));
    assert.equal(first, sessionKey);
  });
});

test('synchronizeFileDetailed reports no content change on the first index', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: 1_776_000_010_000,
      lastInteractionAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'first message') },
      ],
    });

    // No stored baseline yet, so a first index cannot claim the content moved.
    const result = await new OpenclawSessionSynchronizer()
      .synchronizeFileDetailed(getOpenclawAgentDbPath('main'));
    assert.deepEqual(result, { sessionId: sessionKey, contentChanged: false });
  });
});

test('synchronizeFileDetailed ignores a store write that does not advance the interaction stamp', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    const touchedAt = 1_776_000_010_000;
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: touchedAt,
      lastInteractionAt: touchedAt,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'first message') },
      ],
    });

    const synchronizer = new OpenclawSessionSynchronizer();
    await synchronizer.synchronize();

    // OpenClaw is a shared store, so the watcher fires on unrelated writes. With
    // `last_interaction_at` unchanged, the session must not be reported unread.
    const result = await synchronizer.synchronizeFileDetailed(getOpenclawAgentDbPath('main'));
    assert.deepEqual(result, { sessionId: sessionKey, contentChanged: false });
  });
});

test('synchronizeFileDetailed reports a content change when the interaction stamp advances', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      updatedAt: 1_776_000_010_000,
      lastInteractionAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'first message') },
      ],
    });

    const synchronizer = new OpenclawSessionSynchronizer();
    await synchronizer.synchronize();

    // A new user message bumps `last_interaction_at`; that is the content signal.
    const db = new Database(getOpenclawAgentDbPath('main'));
    try {
      db.prepare('UPDATE session_nodes SET last_interaction_at = ?, updated_at = ? WHERE session_key = ?')
        .run(1_776_000_020_000, 1_776_000_020_000, sessionKey);
    } finally {
      db.close();
    }

    const result = await synchronizer.synchronizeFileDetailed(getOpenclawAgentDbPath('main'));
    assert.deepEqual(result, { sessionId: sessionKey, contentChanged: true });
  });
});

test('deleteProviderSession removes the node, windows and every transcript row', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    const windowId = 'window-1';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId,
      updatedAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'delete me') },
      ],
    });

    await new OpenclawSessionSynchronizer().deleteProviderSession(sessionKey);

    const db = new Database(getOpenclawAgentDbPath('main'), { readonly: true });
    try {
      const readCount = (table: string): number =>
        (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
      assert.equal(readCount('session_nodes'), 0);
      assert.equal(readCount('session_windows'), 0);
      assert.equal(readCount('transcript_events'), 0);
      assert.equal(readCount('session_transcript_active_events'), 0);
      assert.equal(readCount('session_transcript_index_state'), 0);
    } finally {
      db.close();
    }
  });
});
