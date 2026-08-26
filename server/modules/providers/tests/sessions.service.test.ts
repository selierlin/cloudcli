import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'sessions-service-db-'));

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

test('provider session id returns the mapped native id', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-session-id', 'codex', '/tmp/session-id-copy-project');
    sessionsDb.assignProviderSessionId('app-session-id', 'codex-native-session-id');

    assert.equal(sessionsService.getProviderSessionId('app-session-id'), 'codex-native-session-id');
  });
});

test('app session names use at most four whole words from the initial message', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const result = sessionsService.createAppSession(
      'codex',
      '/tmp/session-name-project',
      '  supercalifragilisticexpialidocious\nsecond   third fourth fifth  ',
    );

    assert.equal(result.sessionName, 'supercalifragilisticexpialidocious second third fourth');
    assert.equal(
      sessionsDb.getSessionById(result.sessionId)?.custom_name,
      'supercalifragilisticexpialidocious second third fourth',
    );
  });
});

test('app sessions without message text receive a stable fallback name', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    const result = sessionsService.createAppSession('claude', '/tmp/attachment-only-project', '  \n ');

    assert.equal(result.sessionName, 'Untitled Session');
    assert.equal(sessionsDb.getSessionById(result.sessionId)?.custom_name, 'Untitled Session');
  });
});

test('provider session id is unavailable until the provider assigns one', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('pending-app-session', 'claude', '/tmp/session-id-copy-project');

    assert.throws(
      () => sessionsService.getProviderSessionId('pending-app-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'PROVIDER_SESSION_ID_NOT_AVAILABLE' && typedError.statusCode === 409;
      },
    );
  });
});

test('provider session id reports a missing app session', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => sessionsService.getProviderSessionId('missing-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'SESSION_NOT_FOUND' && typedError.statusCode === 404;
      },
    );
  });
});

test('recent sessions map project metadata and preserve database pagination', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession(
      'older-session',
      'claude',
      '/tmp/recent-project',
      'Older conversation',
      '2026-08-01T08:00:00.000Z',
      '2026-08-01T09:00:00.000Z',
    );
    sessionsDb.createSession(
      'newer-session',
      'codex',
      '/tmp/recent-project',
      'Newer conversation',
      '2026-08-01T10:00:00.000Z',
      '2026-08-01T11:00:00.000Z',
    );
    projectsDb.updateCustomProjectName('/tmp/recent-project', 'Recent Project');

    const project = projectsDb.getProjectPath('/tmp/recent-project');
    const page = sessionsService.listRecentSessions(1, 0);

    assert.deepEqual(page, {
      conversations: [{
        sessionId: 'newer-session',
        provider: 'codex',
        projectId: project?.project_id ?? null,
        projectDisplayName: 'Recent Project',
        sessionTitle: 'Newer conversation',
        lastActivity: '2026-08-01T11:00:00.000Z',
      }],
      total: 2,
      hasMore: true,
    });
  });
});

test('force delete removes the transcript via the provider path resolver when jsonl_path is null', { concurrency: false }, async (t) => {
  await withIsolatedDatabase(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-force-delete-'));
    const transcriptPath = path.join(tempRoot, 'session.jsonl.zstd');
    await writeFile(transcriptPath, 'placeholder');

    try {
      sessionsDb.createAppSession('app-dsh-force-delete', 'dsh', '/tmp/dsh-force-delete-project');
      sessionsDb.assignProviderSessionId('app-dsh-force-delete', 'dsh-native-force-delete');

      mock.method(providerRegistry, 'resolveProvider', (() => ({
        sessionSynchronizer: {
          resolveTranscriptPath: async () => transcriptPath,
        },
      })) as unknown as typeof providerRegistry.resolveProvider);
      t.after(() => mock.reset());

      const result = await sessionsService.deleteOrArchiveSessionById('app-dsh-force-delete', {
        force: true,
        deletedFromDisk: true,
      });

      assert.equal(result.action, 'deleted');
      assert.equal(result.deletedFromDisk, true);
      assert.equal(sessionsDb.getSessionById('app-dsh-force-delete'), null);
      assert.equal(existsSync(transcriptPath), false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

test('force delete still removes the row when the provider cannot resolve a transcript', { concurrency: false }, async (t) => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-dsh-force-null', 'dsh', '/tmp/dsh-force-null-project');
    sessionsDb.assignProviderSessionId('app-dsh-force-null', 'dsh-native-force-null');

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessionSynchronizer: {
        resolveTranscriptPath: async () => null,
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const result = await sessionsService.deleteOrArchiveSessionById('app-dsh-force-null', {
      force: true,
      deletedFromDisk: true,
    });

    assert.equal(result.action, 'deleted');
    assert.equal(result.deletedFromDisk, false);
    assert.equal(sessionsDb.getSessionById('app-dsh-force-null'), null);
  });
});

test('fetchOutline returns user-turn snippets and filters assistant/non-text rows', { concurrency: false }, async (t) => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-outline-session', 'claude', '/tmp/outline-project');
    sessionsDb.assignProviderSessionId('app-outline-session', 'claude-native-outline');

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: [
            { id: 'm1', sessionId: 'app-outline-session', timestamp: '2026-08-26T10:00:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: 'First question\nmore text' },
            { id: 'm2', sessionId: 'app-outline-session', timestamp: '2026-08-26T10:01:00.000Z', provider: 'claude', kind: 'text', role: 'assistant', content: 'First answer' },
            { id: 'm3', sessionId: 'app-outline-session', timestamp: '2026-08-26T10:02:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: '' },
            { id: 'm4', sessionId: 'app-outline-session', timestamp: '2026-08-26T10:03:00.000Z', provider: 'claude', kind: 'tool_use', role: 'user', content: 'tool text' },
          ],
          total: 4, hasMore: false, offset: 0, limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const outline = await sessionsService.fetchOutline('app-outline-session');
    assert.deepEqual(outline, [
      { timestamp: '2026-08-26T10:00:00.000Z', snippet: 'First question' },
      { timestamp: '2026-08-26T10:02:00.000Z', snippet: '' },
    ]);
  });
});

test('fetchOutline caps snippets to 80 chars and falls back to displayText', { concurrency: false }, async (t) => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-outline-cap', 'claude', '/tmp/outline-cap-project');
    sessionsDb.assignProviderSessionId('app-outline-cap', 'claude-native-cap');

    const longLine = 'x'.repeat(120);
    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: [
            { id: 'c1', sessionId: 'app-outline-cap', timestamp: '2026-08-26T10:00:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: longLine },
            { id: 'c2', sessionId: 'app-outline-cap', timestamp: '2026-08-26T10:01:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: '', displayText: 'Fallback line' },
            { id: 'c3', sessionId: 'app-outline-cap', timestamp: '2026-08-26T10:02:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: '<task-notification>\n<status>done</status>\n</task-notification>' },
          ],
          total: 3, hasMore: false, offset: 0, limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const outline = await sessionsService.fetchOutline('app-outline-cap');
    assert.deepEqual(outline, [
      { timestamp: '2026-08-26T10:00:00.000Z', snippet: 'x'.repeat(80) },
      { timestamp: '2026-08-26T10:01:00.000Z', snippet: 'Fallback line' },
    ]);
  });
});

test('fetchOutline returns an empty outline for sessions without a provider transcript', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-outline-pending', 'claude', '/tmp/outline-pending-project');

    const outline = await sessionsService.fetchOutline('app-outline-pending');
    assert.deepEqual(outline, []);
  });
});

test('fetchOutline reports a missing session', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    await assert.rejects(
      () => sessionsService.fetchOutline('missing-outline-session'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'SESSION_NOT_FOUND' && typedError.statusCode === 404;
      },
    );
  });
});
