import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import {
  registerEphemeralFork,
  resetEphemeralForkRegistryForTests,
  retireProviderSession,
  settleEphemeralFork,
  sweepExpiredEphemeralForks,
} from '@/modules/database/ephemeral-fork-registry.service.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

const PROJECT_PATH = '/workspace/demo-project';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-ephemeral-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  resetEphemeralForkRegistryForTests();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    resetEphemeralForkRegistryForTests();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('a btw placeholder row is hidden from every visible surface but readable by id', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('visible-session', 'claude', PROJECT_PATH, 'Visible');
    sessionsDb.createPendingEphemeralSession({
      sessionId: 'placeholder',
      provider: 'claude',
      projectPath: PROJECT_PATH,
      customName: 'Visible (btw)',
      nameSource: 'fork',
      forkedFromSessionId: 'visible-session',
      model: 'claude-sonnet-4-5',
      effort: 'high',
    });

    const placeholder = sessionsDb.getSessionById('placeholder');
    assert.equal(placeholder?.is_ephemeral, 1);
    assert.equal(placeholder?.provider_session_id, null);
    assert.equal(placeholder?.jsonl_path, null);

    assert.deepEqual(
      sessionsDb.getAllSessions().map((row) => row.session_id),
      ['visible-session'],
    );
    assert.deepEqual(
      sessionsDb.getRecentSessionsPage(10, 0).sessions.map((row) => row.session_id),
      ['visible-session'],
    );
    assert.equal(sessionsDb.getRecentSessionsPage(10, 0).total, 1);
    assert.deepEqual(
      sessionsDb.getSessionsByProjectPathPage(PROJECT_PATH, 10, 0).map((row) => row.session_id),
      ['visible-session'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath(PROJECT_PATH), 1);
    // The cleanup path is the one query that must still see it.
    assert.deepEqual(
      sessionsDb.getSessionsByProjectPathIncludingArchived(PROJECT_PATH).map((row) => row.session_id).sort(),
      ['placeholder', 'visible-session'],
    );
    assert.deepEqual(sessionsDb.listEphemeralSessions().map((row) => row.session_id), ['placeholder']);
  });
});

test('a watcher insert inside the fork window lands hidden and keeps being hidden after settling', async () => {
  await withIsolatedDatabase(() => {
    registerEphemeralFork(PROJECT_PATH, 'placeholder');

    const createdId = sessionsDb.createSession('provider-fork-id', 'claude', PROJECT_PATH, 'Fork');

    assert.equal(createdId, 'provider-fork-id');
    assert.equal(sessionsDb.getSessionById('provider-fork-id')?.is_ephemeral, 1);
    assert.equal(sessionsDb.getAllSessions().length, 0);

    settleEphemeralFork(PROJECT_PATH, 'placeholder', 'provider-fork-id');
    assert.equal(sessionsDb.getSessionById('provider-fork-id')?.is_ephemeral, 1);
  });
});

test('settling reverts an unrelated new session that the window accidentally hid', async () => {
  await withIsolatedDatabase(() => {
    registerEphemeralFork(PROJECT_PATH, 'placeholder');

    // Same project, same window, but not the fork's transcript.
    sessionsDb.createSession('unrelated-session', 'claude', PROJECT_PATH, 'Unrelated');
    assert.equal(sessionsDb.getSessionById('unrelated-session')?.is_ephemeral, 1);

    settleEphemeralFork(PROJECT_PATH, 'placeholder', 'provider-fork-id');

    assert.equal(sessionsDb.getSessionById('unrelated-session')?.is_ephemeral, 0);
    assert.deepEqual(
      sessionsDb.getAllSessions().map((row) => row.session_id),
      ['unrelated-session'],
    );
  });
});

test('an expired registration stops hiding new sessions and reverts what it already hid', async () => {
  await withIsolatedDatabase(() => {
    registerEphemeralFork(PROJECT_PATH, 'placeholder');
    sessionsDb.createSession('claimed-during-window', 'claude', PROJECT_PATH, 'Claimed');

    sweepExpiredEphemeralForks(Date.now() + 61_000);
    assert.equal(sessionsDb.getSessionById('claimed-during-window')?.is_ephemeral, 0);

    sessionsDb.createSession('created-after-expiry', 'claude', PROJECT_PATH, 'After');
    assert.equal(sessionsDb.getSessionById('created-after-expiry')?.is_ephemeral, 0);
  });
});

test('a retired provider session is not re-indexed by a late watcher pass', async () => {
  await withIsolatedDatabase(() => {
    retireProviderSession('deleted-provider-id');

    const createdId = sessionsDb.createSession('deleted-provider-id', 'claude', PROJECT_PATH, 'Deleted');

    assert.equal(createdId, 'deleted-provider-id');
    assert.equal(sessionsDb.getSessionById('deleted-provider-id'), null);
  });
});

test('completing a fork folds in the watcher duplicate and records the transcript path', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createPendingEphemeralSession({
      sessionId: 'placeholder',
      provider: 'claude',
      projectPath: PROJECT_PATH,
      customName: 'Fork',
      nameSource: 'fork',
      forkedFromSessionId: 'source',
      model: null,
      effort: null,
    });

    // The watcher indexed the transcript before the backfill.
    registerEphemeralFork(PROJECT_PATH, 'placeholder');
    sessionsDb.createSession('provider-fork-id', 'claude', PROJECT_PATH, 'Fork');

    sessionsDb.completeForkedSession({
      sessionId: 'placeholder',
      providerSessionId: 'provider-fork-id',
      jsonlPath: '/workspace/demo-project/.claude/provider-fork-id.jsonl',
    });

    assert.equal(sessionsDb.getSessionById('provider-fork-id'), null);
    const row = sessionsDb.getSessionById('placeholder');
    assert.equal(row?.provider_session_id, 'provider-fork-id');
    assert.equal(row?.jsonl_path, '/workspace/demo-project/.claude/provider-fork-id.jsonl');
    assert.equal(row?.is_ephemeral, 1);
  });
});

test('promoting an aside session makes it visible without moving it up the feed', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('older-visible', 'claude', PROJECT_PATH, 'Older');
    sessionsDb.createPendingEphemeralSession({
      sessionId: 'placeholder',
      provider: 'claude',
      projectPath: PROJECT_PATH,
      customName: 'Fork',
      nameSource: 'fork',
      forkedFromSessionId: 'older-visible',
      model: null,
      effort: null,
    });

    const before = sessionsDb.getSessionById('placeholder');
    sessionsDb.promoteEphemeralSession('placeholder', 'Promoted title');
    const after = sessionsDb.getSessionById('placeholder');

    assert.equal(after?.is_ephemeral, 0);
    assert.equal(after?.custom_name, 'Promoted title');
    assert.equal(after?.name_source, 'manual_rename');
    assert.equal(after?.updated_at, before?.updated_at);
    assert.ok(sessionsDb.getAllSessions().some((row) => row.session_id === 'placeholder'));
    assert.equal(sessionsDb.listEphemeralSessions().length, 0);
  });
});
