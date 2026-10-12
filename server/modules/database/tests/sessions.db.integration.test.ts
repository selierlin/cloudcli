import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionReadStateDb } from '@/modules/database/repositories/session-read-state.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session');
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session');
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('createSession does not resurrect archived rows; restore stays explicit', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    // A re-indexed transcript (e.g. a synchronizer full re-scan) must not
    // resurrect the archived row: the row keeps its archived flag, existing
    // name, and stays out of the active lists.
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    assert.equal(sessionsDb.getAllSessions().length, 0);
    assert.deepEqual(sessionsDb.getArchivedSessions().map((session) => session.session_id), ['session-reused']);
    const stillArchived = sessionsDb.getSessionById('session-reused');
    assert.equal(stillArchived?.isArchived, 1);
    assert.equal(stillArchived?.custom_name, 'First Name');

    // Restoring is the only path back into the active lists.
    sessionsDb.updateSessionIsArchived('session-reused', false);
    const activeSessions = sessionsDb.getAllSessions();
    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0]?.session_id, 'session-reused');
    assert.equal(activeSessions[0]?.isArchived, 0);
  });
});

test("createSession leaves an archived row archived when the transcript has not changed", async () => {
  await withIsolatedDatabase(() => {
    const createdAt = "2026-07-18T09:00:00.000Z";
    const updatedAt = "2026-07-18T10:00:00.000Z";
    const jsonlPath = "/transcripts/session-untouched.jsonl";

    sessionsDb.createSession("session-untouched", "claude", "/workspace/demo-project", "A Name", createdAt, updatedAt, jsonlPath);
    sessionsDb.updateSessionIsArchived("session-untouched", true);

    // A full rescan re-indexes every transcript created since the last scan,
    // changed or not, and hands over the timestamps the file still carries.
    sessionsDb.createSession("session-untouched", "claude", "/workspace/demo-project", "A Name", createdAt, updatedAt, jsonlPath);

    assert.equal(sessionsDb.getSessionById("session-untouched")?.isArchived, 1);
    assert.equal(sessionsDb.getArchivedSessions().length, 1);
    assert.equal(sessionsDb.getAllSessions().length, 0);

    // Actually writing to the session again still brings it back.
    sessionsDb.createSession("session-untouched", "claude", "/workspace/demo-project", "A Name", createdAt, "2026-07-18T11:00:00.000Z", jsonlPath);

    assert.equal(sessionsDb.getSessionById("session-untouched")?.isArchived, 0);
  });
});

test("the upsert path counts an omitted timestamp as activity", async () => {
  await withIsolatedDatabase(() => {
    // An app-created row carries no provider id, so indexing it takes the
    // INSERT ... ON CONFLICT branch rather than the UPDATE above. Its
    // updated_at is CURRENT_TIMESTAMP, which resolves to whole seconds, so a
    // call in the same second is not *newer* -- the omitted timestamp itself
    // has to be what reactivates the row.
    sessionsDb.createAppSession("session-legacy", "claude", "/workspace/demo-project");
    sessionsDb.updateSessionIsArchived("session-legacy", true);

    sessionsDb.createSession("session-legacy", "claude", "/workspace/demo-project", "Indexed Name");

    assert.equal(sessionsDb.getSessionById("session-legacy")?.isArchived, 0);
  });
});

test("the upsert path leaves an archived row alone for a transcript older than it", async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession("session-stale", "claude", "/workspace/demo-project");
    sessionsDb.updateSessionIsArchived("session-stale", true);

    sessionsDb.createSession("session-stale", "claude", "/workspace/demo-project", "Indexed Name", "2026-07-18T09:00:00.000Z", "2026-07-18T10:00:00.000Z", "/transcripts/session-stale.jsonl");

    assert.equal(sessionsDb.getSessionById("session-stale")?.isArchived, 1);
  });
});


test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('recent sessions are globally ordered, paginated, and limited to visible conversations', async () => {
  await withIsolatedDatabase(() => {
    const fixtures: Array<Parameters<typeof sessionsDb.createSession>> = [
      ['session-oldest', 'claude', '/workspace/project-a', 'Oldest', '2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z'],
      ['session-newest', 'codex', '/workspace/project-b', 'Newest', '2026-07-18T11:00:00.000Z', '2026-07-18T12:00:00.900Z'],
      ['session-same-second', 'claude', '/workspace/project-a', 'Same second, slightly older', '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.100Z'],
      ['session-middle', 'claude', '/workspace/project-a', 'Middle', '2026-07-18T10:00:00.000Z', '2026-07-18T11:00:00.000Z'],
      ['session-archived', 'claude', '/workspace/project-a', 'Archived session', '2026-07-18T13:00:00.000Z', '2026-07-18T13:00:00.000Z'],
      ['session-hidden-project', 'claude', '/workspace/project-hidden', 'Archived project session', '2026-07-18T14:00:00.000Z', '2026-07-18T14:00:00.000Z'],
    ];
    fixtures.forEach((fixture) => sessionsDb.createSession(...fixture));

    sessionsDb.updateSessionIsArchived('session-archived', true);
    projectsDb.updateProjectIsArchived('/workspace/project-hidden', true);

    const firstPage = sessionsDb.getRecentSessionsPage(2, 0);
    const secondPage = sessionsDb.getRecentSessionsPage(2, 2);

    assert.equal(firstPage.total, 4);
    assert.deepEqual(
      firstPage.sessions.map((session) => session.session_id),
      ['session-newest', 'session-same-second'],
    );
    assert.equal(secondPage.total, 4);
    assert.deepEqual(
      secondPage.sessions.map((session) => session.session_id),
      ['session-middle', 'session-oldest'],
    );
  });
});

test('pinned sessions persist and precede newer unpinned conversations', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'pinned-session',
      'claude',
      '/workspace/project-a',
      'Pinned',
      '2026-07-18T09:00:00.000Z',
      '2026-07-18T10:00:00.000Z',
    );
    sessionsDb.createSession(
      'newer-session',
      'codex',
      '/workspace/project-a',
      'Newer',
      '2026-07-18T11:00:00.000Z',
      '2026-07-18T12:00:00.000Z',
    );

    sessionsDb.updateSessionIsPinned('pinned-session', true);

    assert.equal(sessionsDb.getSessionById('pinned-session')?.isPinned, 1);
    assert.deepEqual(
      sessionsDb.getRecentSessionsPage(10, 0).sessions.map((session) => session.session_id),
      ['pinned-session', 'newer-session'],
    );

    sessionsDb.updateSessionIsPinned('pinned-session', false);
    assert.equal(sessionsDb.getSessionById('pinned-session')?.isPinned, 0);
  });
});

test('createSession stores the content fingerprint and it reads back normalized', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'session-fingerprint',
      'claude',
      '/workspace/demo-project',
      'Fingerprinted',
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-01-01T10:00:05.000Z',
    );

    assert.equal(
      sessionsDb.getSessionContentUpdatedAt('session-fingerprint', 'claude'),
      '2026-01-01T10:00:05.000Z',
    );
  });
});

test('a later index without a fingerprint keeps the stored one', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'session-keep',
      'claude',
      '/workspace/demo-project',
      'Keep',
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-01-01T10:00:05.000Z',
    );
    // A rescan that cannot read a timestamp (null) must not erase the value a
    // previous index recorded.
    sessionsDb.createSession('session-keep', 'claude', '/workspace/demo-project', 'Keep');

    assert.equal(
      sessionsDb.getSessionContentUpdatedAt('session-keep', 'claude'),
      '2026-01-01T10:00:05.000Z',
    );
  });
});

test('content timestamp lookup prefers the newest row when a provider session id is duplicated', async () => {
  await withIsolatedDatabase(() => {
    const db = getConnection();
    projectsDb.createProjectPath('/workspace/demo-project');
    // Two rows can briefly share `(provider_session_id, provider)` while a
    // watcher-indexed row is merged into an app row. Without a tie-break,
    // `LIMIT 1` may return the stale NULL row, which the synchronizer reads as
    // "no new content" and silently drops the unread warning.
    const insert = db.prepare(
      `INSERT INTO sessions (session_id, provider, provider_session_id, custom_name, name_source, project_path, isArchived, created_at, updated_at, content_updated_at)
       VALUES (?, 'claude', ?, ?, 'provider_title', '/workspace/demo-project', 0, ?, ?, ?)`,
    );
    insert.run('stale-dup', 'session-dup', 'Stale', '2026-01-01T09:00:00.000Z', '2026-01-01T09:00:00.000Z', null);
    insert.run('fresh-dup', 'session-dup', 'Fresh', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:05.000Z');

    assert.equal(
      sessionsDb.getSessionContentUpdatedAt('session-dup', 'claude'),
      '2026-01-01T10:00:05.000Z',
    );
  });
});

test('deleting a session also drops its read-state rows', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-doomed', 'claude', '/workspace/demo-project', 'Doomed');
    // `session_read_state` cascades from users(id), so the owner must exist.
    getConnection()
      .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(7, 'reader', 'x');
    sessionReadStateDb.saveReadState(7, 'session-doomed', '2026-01-01T10:00:05.000Z');
    assert.equal(sessionReadStateDb.getReadState(7).length, 1);

    sessionsDb.deleteSessionById('session-doomed');

    // `session_read_state` has no FK into `sessions`, so the delete is what
    // reclaims it; otherwise a reused id could inherit a stale watermark.
    assert.deepEqual(sessionReadStateDb.getReadState(7), []);
  });
});

test('deleting every session in a project also drops their read-state rows', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('project-a-1', 'claude', '/workspace/a', 'A1');
    sessionsDb.createSession('project-a-2', 'claude', '/workspace/a', 'A2');
    sessionsDb.createSession('project-b-1', 'claude', '/workspace/b', 'B1');
    getConnection()
      .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(7, 'reader', 'x');
    sessionReadStateDb.saveReadState(7, 'project-a-1', '2026-01-01T10:00:05.000Z');
    sessionReadStateDb.saveReadState(7, 'project-a-2', '2026-01-01T10:00:05.000Z');
    sessionReadStateDb.saveReadState(7, 'project-b-1', '2026-01-01T10:00:05.000Z');

    sessionsDb.deleteSessionsByProjectPath('/workspace/a');

    // Only the surviving project keeps its watermark; the deleted project's
    // rows would otherwise linger with no session to belong to.
    assert.deepEqual(
      sessionReadStateDb.getReadState(7).map((row) => row.sessionId),
      ['project-b-1'],
    );
  });
});

test('merging a duplicate on provider-id assignment drops the duplicate watermark', async () => {
  await withIsolatedDatabase(() => {
    // The app row exists without a provider id; the watcher indexed the same
    // transcript first, so a duplicate row keyed by the provider id is merged
    // into the app row.
    sessionsDb.createAppSession('app-session', 'claude', '/workspace/demo-project');
    sessionsDb.createSession('provider-session', 'claude', '/workspace/demo-project', 'From disk');
    getConnection()
      .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(7, 'reader', 'x');
    sessionReadStateDb.saveReadState(7, 'provider-session', '2026-01-01T10:00:05.000Z');

    sessionsDb.assignProviderSessionId('app-session', 'provider-session');

    assert.equal(sessionsDb.getSessionById('app-session')?.provider_session_id, 'provider-session');
    assert.deepEqual(sessionReadStateDb.getReadState(7), []);
  });
});

test('repointing a session drops the discarded rows watermarks', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session', 'codex', '/workspace/demo-project');
    sessionsDb.createSession('new-provider-session', 'codex', '/workspace/demo-project', 'New');
    sessionsDb.createSession('old-provider-session', 'codex', '/workspace/demo-project', 'Old');
    getConnection()
      .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(7, 'reader', 'x');
    sessionReadStateDb.saveReadState(7, 'new-provider-session', '2026-01-01T10:00:05.000Z');
    sessionReadStateDb.saveReadState(7, 'old-provider-session', '2026-01-01T10:00:05.000Z');

    sessionsDb.repointSessionToProviderSession('app-session', {
      providerSessionId: 'new-provider-session',
      jsonlPath: '/workspace/demo-project/new.jsonl',
      supersededProviderSessionId: 'old-provider-session',
    });

    assert.deepEqual(sessionReadStateDb.getReadState(7), []);
  });
});

test('creating a forked session drops the watcher rows watermark', async () => {
  await withIsolatedDatabase(() => {
    // The watcher indexed the fork's transcript under its own (provider) id
    // before the app session claimed it.
    sessionsDb.createSession('fork-provider-session', 'claude', '/workspace/demo-project', 'Fork');
    getConnection()
      .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(7, 'reader', 'x');
    sessionReadStateDb.saveReadState(7, 'fork-provider-session', '2026-01-01T10:00:05.000Z');

    sessionsDb.createForkedSession({
      sessionId: 'app-fork',
      provider: 'claude',
      projectPath: '/workspace/demo-project',
      customName: 'Fork',
      providerSessionId: 'fork-provider-session',
      jsonlPath: '/workspace/demo-project/fork.jsonl',
      forkedFromSessionId: 'app-source',
      nameSource: 'fork',
      model: null,
      effort: null,
    });

    assert.deepEqual(sessionReadStateDb.getReadState(7), []);
  });
});
