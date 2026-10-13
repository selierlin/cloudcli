import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionReadStateDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { getProjectSessionsPage } from '@/modules/projects/services/projects-with-sessions-fetch.service.js';

/**
 * The session page projection is the refresh path the sidebar's read-state
 * comparison runs on: it must carry the session's *content* timestamp, which is
 * a different value from `lastActivity` (the file's `updated_at`). If it ever
 * silently dropped that field, every persisted unread flag would disappear on
 * the next reload with no error anywhere.
 */

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'projects-sessions-fetch-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

test('the session page carries the content timestamp alongside lastActivity', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/projected';
    projectsDb.createProjectPath(projectPath);
    const projectId = projectsDb.getProjectPath(projectPath)?.project_id;
    assert.ok(projectId);

    sessionsDb.createSession(
      'session-projected',
      'claude',
      projectPath,
      'Projected',
      undefined,
      '2026-01-01T12:00:00.000Z',
      undefined,
      undefined,
      '2026-01-01T10:00:05.000Z',
    );

    const page = await getProjectSessionsPage(String(projectId));
    const summary = page.sessions.find((session) => session.id === 'session-projected');
    assert.ok(summary);
    assert.equal(summary.contentUpdatedAt, '2026-01-01T10:00:05.000Z');
    // The two are deliberately different values: `lastActivity` tracks the
    // file, `contentUpdatedAt` the conversation.
    assert.notEqual(summary.contentUpdatedAt, summary.lastActivity);
  });
});

test('a session with no content timestamp projects it as null, never undefined', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/projected-null';
    projectsDb.createProjectPath(projectPath);
    const projectId = projectsDb.getProjectPath(projectPath)?.project_id;
    assert.ok(projectId);

    sessionsDb.createSession('session-null', 'claude', projectPath, 'No Fingerprint');

    const page = await getProjectSessionsPage(String(projectId));
    const summary = page.sessions.find((session) => session.id === 'session-null');
    assert.ok(summary);
    assert.equal(summary.contentUpdatedAt, null);
  });
});

/**
 * `isUnread` is the server's answer now. These pin the two boundaries the whole
 * decision rests on: it needs a watermark (a never-opened session is not
 * flagged), and it is per user (one user's watermark must not read another's
 * session).
 */

/** `createUser` hands back a `number | bigint` rowid; the query layer takes a number. */
const createTestUser = (name: string): number => Number(userDb.createUser(name, 'hash').id);

const seedSession = (sessionId: string, contentUpdatedAt: string): string => {
  const projectPath = `/workspace/${sessionId}`;
  projectsDb.createProjectPath(projectPath);
  const projectId = projectsDb.getProjectPath(projectPath)?.project_id;
  assert.ok(projectId);
  sessionsDb.createSession(
    sessionId,
    'claude',
    projectPath,
    sessionId,
    undefined,
    undefined,
    undefined,
    undefined,
    contentUpdatedAt,
  );
  return projectId;
};

test('a session is unread when its content moved past the requesting user watermark', async () => {
  await withIsolatedDatabase(async () => {
    const projectId = seedSession('unread-session', '2026-01-02T00:00:00.000Z');
    const userId = createTestUser('reader');
    sessionReadStateDb.saveReadState(userId, 'unread-session', '2026-01-01T00:00:00.000Z');

    const page = await getProjectSessionsPage(projectId, {}, userId);
    assert.equal(page.sessions.find((session) => session.id === 'unread-session')?.isUnread, true);
  });
});

test('a session whose content the user has seen is not unread', async () => {
  await withIsolatedDatabase(async () => {
    const projectId = seedSession('read-session', '2026-01-02T00:00:00.000Z');
    const userId = createTestUser('reader');
    sessionReadStateDb.saveReadState(userId, 'read-session', '2026-01-02T00:00:00.000Z');

    const page = await getProjectSessionsPage(projectId, {}, userId);
    assert.equal(page.sessions.find((session) => session.id === 'read-session')?.isUnread, false);
  });
});

test('a session with no watermark is never unread, even with content', async () => {
  await withIsolatedDatabase(async () => {
    const projectId = seedSession('never-opened', '2026-01-02T00:00:00.000Z');
    const userId = createTestUser('reader');

    const page = await getProjectSessionsPage(projectId, {}, userId);
    assert.equal(page.sessions.find((session) => session.id === 'never-opened')?.isUnread, false);
  });
});

test('a session with no content timestamp is never unread', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/no-content';
    projectsDb.createProjectPath(projectPath);
    const projectId = projectsDb.getProjectPath(projectPath)?.project_id;
    assert.ok(projectId);
    sessionsDb.createSession('no-content', 'codex', projectPath, 'No content');

    const userId = createTestUser('reader');
    sessionReadStateDb.saveReadState(userId, 'no-content', '2026-01-01T00:00:00.000Z');

    const page = await getProjectSessionsPage(projectId, {}, userId);
    assert.equal(page.sessions.find((session) => session.id === 'no-content')?.isUnread, false);
  });
});

test('isUnread is per user: one user watermark does not read another user session', async () => {
  await withIsolatedDatabase(async () => {
    const projectId = seedSession('shared-session', '2026-01-02T00:00:00.000Z');
    const readerId = createTestUser('reader');
    const otherId = createTestUser('other');
    sessionReadStateDb.saveReadState(readerId, 'shared-session', '2026-01-01T00:00:00.000Z');

    const readerPage = await getProjectSessionsPage(projectId, {}, readerId);
    const otherPage = await getProjectSessionsPage(projectId, {}, otherId);

    assert.equal(readerPage.sessions.find((s) => s.id === 'shared-session')?.isUnread, true);
    assert.equal(otherPage.sessions.find((s) => s.id === 'shared-session')?.isUnread, false);
  });
});

test('without a requesting user every session reads as not-unread', async () => {
  await withIsolatedDatabase(async () => {
    const projectId = seedSession('anonymous-session', '2026-01-02T00:00:00.000Z');
    const userId = createTestUser('reader');
    sessionReadStateDb.saveReadState(userId, 'anonymous-session', '2026-01-01T00:00:00.000Z');

    const page = await getProjectSessionsPage(projectId);
    assert.equal(page.sessions.find((s) => s.id === 'anonymous-session')?.isUnread, false);
  });
});

test('the session page projects the ownership link for the sidebar tree', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/parented';
    projectsDb.createProjectPath(projectPath);
    const projectId = projectsDb.getProjectPath(projectPath)?.project_id;
    assert.ok(projectId);

    sessionsDb.createSession('tree-parent', 'claude', projectPath, 'Parent');
    sessionsDb.createSession('tree-child', 'claude', projectPath, 'Child');
    sessionsDb.updateSessionParent('tree-child', 'tree-parent');

    const page = await getProjectSessionsPage(String(projectId));

    // The sidebar derives the tree from these ids alone, so a page that dropped
    // the field would silently render every session flat.
    assert.equal(page.sessions.find((session) => session.id === 'tree-child')?.parentSessionId, 'tree-parent');
    assert.equal(page.sessions.find((session) => session.id === 'tree-parent')?.parentSessionId, null);
  });
});
