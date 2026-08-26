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

// ----------------- Claude session branching -----------------

test('createClaudeBranch rejects a missing source session', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    await assert.rejects(
      () => sessionsService.createClaudeBranch('missing-branch-session', 'msg-uuid_text_0'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'SESSION_NOT_FOUND' && typedError.statusCode === 404;
      },
    );
  });
});

test('createClaudeBranch rejects non-Claude providers', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-branch-codex', 'codex', '/tmp/branch-codex-project');
    sessionsDb.assignProviderSessionId('app-branch-codex', 'codex-native-session');

    await assert.rejects(
      () => sessionsService.createClaudeBranch('app-branch-codex', 'msg-uuid_text_0'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'BRANCH_UNSUPPORTED_PROVIDER' && typedError.statusCode === 400;
      },
    );
  });
});

test('createClaudeBranch requires a provider session id first', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-branch-pending', 'claude', '/tmp/branch-pending-project');

    await assert.rejects(
      () => sessionsService.createClaudeBranch('app-branch-pending', 'msg-uuid_text_0'),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'PROVIDER_SESSION_ID_NOT_AVAILABLE' && typedError.statusCode === 409;
      },
    );
  });
});

test('createClaudeBranch rejects an invalid message id', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-branch-msg', 'claude', '/tmp/branch-msg-project');
    sessionsDb.assignProviderSessionId('app-branch-msg', 'claude-native-msg');

    await assert.rejects(
      () => sessionsService.createClaudeBranch('app-branch-msg', '   '),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number };
        return typedError.code === 'INVALID_MESSAGE_ID' && typedError.statusCode === 400;
      },
    );
  });
});

test('createClaudeBranch surfaces a failed SDK fork', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-branch-fail', 'claude', '/tmp/branch-fail-project');
    sessionsDb.assignProviderSessionId('app-branch-fail', 'claude-native-fail');

    await assert.rejects(
      () => sessionsService.createClaudeBranch('app-branch-fail', 'msg-uuid_text_0', {
        forkSession: async () => {
          throw new Error('SDK boom');
        },
      }),
      (error: unknown) => {
        const typedError = error as { code?: string; statusCode?: number; message?: string };
        return typedError.code === 'SESSION_BRANCH_FAILED'
          && typedError.statusCode === 500
          && typedError.message?.includes('SDK boom');
      },
    );
  });
});

test('createClaudeBranch forks at the native message uuid and registers the new app session', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-branch-'));

    try {
      sessionsDb.createAppSession('app-branch-source', 'claude', '/tmp/branch-project');
      sessionsDb.assignProviderSessionId('app-branch-source', 'claude-native-source');

      const sourceJsonl = path.join(tempRoot, 'claude-native-source.jsonl');
      const forkedJsonl = path.join(tempRoot, 'claude-forked-id.jsonl');
      await writeFile(sourceJsonl, '{}');
      await writeFile(forkedJsonl, '{}');
      sessionsDb.createSession(
        'claude-native-source',
        'claude',
        '/tmp/branch-project',
        'Source Session',
        undefined,
        undefined,
        sourceJsonl,
      );

      let receivedSessionId: string | undefined;
      let receivedUpToMessageId: string | undefined;
      let receivedTitle: string | undefined;
      const result = await sessionsService.createClaudeBranch('app-branch-source', '019f75cd-1234_text_0', {
        forkSession: async (sessionId, options) => {
          receivedSessionId = sessionId;
          receivedUpToMessageId = options?.upToMessageId;
          receivedTitle = options?.title;
          return { sessionId: 'claude-forked-id' };
        },
      });

      // The SDK fork is asked to slice at the leading segment of the message id.
      assert.equal(receivedSessionId, 'claude-native-source');
      assert.equal(receivedUpToMessageId, '019f75cd-1234');
      assert.equal(receivedTitle, 'Source Session (fork)');

      // The new app session row is mapped to the forked provider id and carries
      // the forked transcript path so history resolves immediately.
      const branchRow = sessionsDb.getSessionById(result.sessionId);
      assert.ok(branchRow, 'branch session row exists');
      assert.equal(branchRow?.provider, 'claude');
      assert.equal(branchRow?.provider_session_id, 'claude-forked-id');
      assert.equal(branchRow?.jsonl_path, forkedJsonl);
      assert.equal(branchRow?.custom_name, 'Source Session (fork)');
      assert.equal(result.providerSessionId, 'claude-forked-id');
    } finally {
      mock.reset();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
