import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionReadStateDb, sessionsDb, userDb } from '@/modules/database/index.js';
import {
  broadcastSessionUpserted,
  broadcastSessionUpsertedBatch,
} from '@/modules/websocket/services/session-upsert-broadcast.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'session-upsert-broadcast-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('an upsert always carries the provider session id', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-1', 'opencode', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-1', 'native-1');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('app-1', 'content');

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].kind, 'session_upserted');
    assert.equal(connection.frames[0].sessionId, 'app-1');
    assert.equal(connection.frames[0].providerSessionId, 'native-1');
    assert.equal(
      (connection.frames[0].session as Record<string, unknown>).change,
      'content',
    );
  });
});

test('the watcher path resolves a provider-native id to the same canonical event', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-2', 'opencode', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-2', 'native-2');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    // The sessions watcher only ever knows the id written in the transcript.
    await broadcastSessionUpsertedBatch([{ sessionId: 'native-2', change: 'metadata' }]);

    assert.equal(connection.frames.length, 1);
    assert.equal(connection.frames[0].sessionId, 'app-2');
    assert.equal(connection.frames[0].providerSessionId, 'native-2');
    assert.equal(
      (connection.frames[0].session as Record<string, unknown>).change,
      'metadata',
    );
  });
});

test('a session with no provider id yet reports null rather than omitting the field', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-3', 'claude', '/workspace/demo');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('app-3', 'content');

    assert.equal(connection.frames.length, 1);
    assert.ok('providerSessionId' in connection.frames[0]);
    assert.equal(connection.frames[0].providerSessionId, null);
  });
});

test('an unresolvable id broadcasts nothing', async () => {
  await withIsolatedDatabase(async () => {
    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('does-not-exist', 'content');
    await broadcastSessionUpsertedBatch([{ sessionId: 'also-missing', change: 'content' }]);

    assert.deepEqual(connection.frames, []);
  });
});

test('a batch delivers every resolvable session and skips the rest', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-4', 'claude', '/workspace/demo');
    sessionsDb.createAppSession('app-5', 'claude', '/workspace/demo');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpsertedBatch([
      { sessionId: 'app-4', change: 'content' },
      { sessionId: 'missing', change: 'content' },
      { sessionId: 'app-5', change: 'metadata' },
    ]);

    assert.deepEqual(
      connection.frames.map((frame) => frame.sessionId),
      ['app-4', 'app-5'],
    );
    // Each entry keeps its own classification: one flush can mix a real append
    // with a file that was only touched.
    assert.deepEqual(
      connection.frames.map((frame) => (frame.session as Record<string, unknown>).change),
      ['content', 'metadata'],
    );
  });
});

test('a closed socket is skipped', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-6', 'claude', '/workspace/demo');

    const open = new FakeConnection();
    const closing = new FakeConnection();
    closing.readyState = 3;
    connectedClients.add(open as never);
    connectedClients.add(closing as never);

    await broadcastSessionUpserted('app-6', 'content');

    assert.equal(open.frames.length, 1);
    assert.deepEqual(closing.frames, []);
  });
});

test('an upsert carries the session content timestamp for the client watermark', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession(
      'native-7',
      'claude',
      '/workspace/demo',
      'Fingerprinted',
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-02-01T00:00:00.000Z',
    );

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('native-7', 'content');

    // The client persists this exact value as the read watermark, so it must
    // travel with the event rather than requiring a project re-fetch.
    assert.equal(
      (connection.frames[0].session as Record<string, unknown>).contentUpdatedAt,
      '2026-02-01T00:00:00.000Z',
    );
  });
});

test('a content delta stamps a fallback content timestamp when the provider supplied none', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-fallback', 'codex', '/workspace/demo');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('app-fallback', 'content');

    const stamped = (connection.frames[0].session as Record<string, unknown>).contentUpdatedAt;
    assert.equal(typeof stamped, 'string');
    assert.ok(!Number.isNaN(Date.parse(stamped as string)));
    // Persisted, not only announced: a reload reads the same version back, which
    // is what keeps the unread flag alive across the refresh.
    assert.equal(sessionsDb.getSessionById('app-fallback')?.content_updated_at, stamped);
  });
});

test('a metadata delta never stamps a content timestamp', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-metadata', 'codex', '/workspace/demo');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('app-metadata', 'metadata');

    assert.equal((connection.frames[0].session as Record<string, unknown>).contentUpdatedAt, null);
    assert.equal(sessionsDb.getSessionById('app-metadata')?.content_updated_at, null);
  });
});

test('a precise provider timestamp is never replaced by the fallback', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession(
      'native-precise',
      'claude',
      '/workspace/demo',
      'Precise',
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-02-01T00:00:00.000Z',
    );

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('native-precise', 'content');

    assert.equal(
      (connection.frames[0].session as Record<string, unknown>).contentUpdatedAt,
      '2026-02-01T00:00:00.000Z',
    );
  });
});

test('a delta carries the server-computed unread flag for the sole user', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession(
      'native-unread',
      'claude',
      '/workspace/demo',
      'Unread',
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-01-02T00:00:00.000Z',
    );
    const user = userDb.createUser('reader', 'hash');
    sessionReadStateDb.saveReadState(Number(user.id), 'native-unread', '2026-01-01T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('native-unread', 'metadata');

    assert.equal(
      (connection.frames[0].session as Record<string, unknown>).isUnread,
      true,
      'an incrementally-upserted row carries the same answer a refetch would',
    );
  });
});

test('a delta for a session the sole user has read reports not-unread', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession(
      'native-read',
      'claude',
      '/workspace/demo',
      'Read',
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-01-02T00:00:00.000Z',
    );
    const user = userDb.createUser('reader', 'hash');
    sessionReadStateDb.saveReadState(Number(user.id), 'native-read', '2026-01-02T00:00:00.000Z');

    const connection = new FakeConnection();
    connectedClients.add(connection as never);

    await broadcastSessionUpserted('native-read', 'metadata');

    assert.equal((connection.frames[0].session as Record<string, unknown>).isUnread, false);
  });
});
