import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import type { ZcodeAppServerClient } from '@/modules/providers/list/zcode/zcode-app-server-client.js';
import {
  ZcodeForkProvider,
  planZcodeFork,
  reportsWorkspaceRestore,
  type ZcodeForkInputs,
} from '@/modules/providers/list/zcode/zcode-fork.provider.js';
import { setZcodeHomeDirForTests } from '@/modules/providers/list/zcode/zcode-models.provider.js';
import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProviderFork } from '@/shared/interfaces.js';

// ---------------------------------------------------------------- plan (pure)

test('the requested anchor is the fork point', () => {
  const plan = planZcodeFork({
    messages: [{ id: 'm1', timeCreated: 1 }, { id: 'm2', timeCreated: 2 }],
    checkpoints: [],
    requestedAnchorId: 'm1',
  });
  assert.deepEqual(plan, { ok: true, messageId: 'm1' });
});

test('a whole-session fork anchors on the last message', () => {
  const plan = planZcodeFork({
    messages: [{ id: 'm1', timeCreated: 1 }, { id: 'm2', timeCreated: 2 }],
    checkpoints: [],
  });
  assert.deepEqual(plan, { ok: true, messageId: 'm2' });
});

test('a session with no messages cannot be forked', () => {
  assert.deepEqual(planZcodeFork({ messages: [], checkpoints: [] }), {
    ok: false,
    reason: 'no-messages',
  });
});

test('an unknown anchor is refused rather than guessed', () => {
  assert.deepEqual(
    planZcodeFork({ messages: [{ id: 'm1', timeCreated: 1 }], checkpoints: [], requestedAnchorId: 'gone' }),
    { ok: false, reason: 'anchor-not-found' },
  );
});

test('a checkpoint after the anchor blocks the fork, because it would revert the workspace', () => {
  const plan = planZcodeFork({
    messages: [{ id: 'm1', timeCreated: 10 }, { id: 'm2', timeCreated: 20 }],
    checkpoints: [{ timeCreated: 15 }],
    requestedAnchorId: 'm1',
  });
  assert.deepEqual(plan, { ok: false, reason: 'workspace-would-rewind' });
});

test('a checkpoint at or before the anchor does not block', () => {
  const plan = planZcodeFork({
    messages: [{ id: 'm1', timeCreated: 10 }, { id: 'm2', timeCreated: 20 }],
    checkpoints: [{ timeCreated: 5 }, { timeCreated: 10 }],
    requestedAnchorId: 'm1',
  });
  assert.deepEqual(plan, { ok: true, messageId: 'm1' });
});

test('anchoring at the last message never trips the guard', () => {
  const plan = planZcodeFork({
    messages: [{ id: 'm1', timeCreated: 10 }, { id: 'm2', timeCreated: 20 }],
    checkpoints: [{ timeCreated: 15 }],
  });
  assert.deepEqual(plan, { ok: true, messageId: 'm2' });
});

// ------------------------------------------------------------ restore report

test('the "restored" clause is recognised, the plain copy report is not', () => {
  assert.equal(reportsWorkspaceRestore('Forked session s: copied 4 messages.'), false);
  assert.equal(
    reportsWorkspaceRestore('Forked session s: copied 4 messages and restored 2 files to the fork point.'),
    true,
  );
});

// -------------------------------------------------------------- fork provider

type ForkCall = { providerSessionId: string; messageId: string };

function stubClient(calls: ForkCall[], response = ''): ZcodeAppServerClient {
  return {
    forkSession: async (input: ForkCall) => {
      calls.push(input);
      return { providerSessionId: 'native-child', response };
    },
  } as unknown as ZcodeAppServerClient;
}

function fixedInputs(inputs: ZcodeForkInputs): (providerSessionId: string) => ZcodeForkInputs {
  return () => inputs;
}

test('the provider forks at the resolved anchor and reports a null artifact', async () => {
  const calls: ForkCall[] = [];
  const provider = new ZcodeForkProvider(
    stubClient(calls),
    fixedInputs({ messages: [{ id: 'm1', timeCreated: 1 }, { id: 'm2', timeCreated: 2 }], checkpoints: [] }),
  );

  const result = await provider.forkSession({
    providerSessionId: 'sess_source',
    jsonlPath: null,
    projectPath: '/tmp',
    upToAnchorId: 'm1',
  });

  assert.deepEqual(calls, [{ providerSessionId: 'sess_source', messageId: 'm1' }]);
  assert.deepEqual(result, { providerSessionId: 'native-child', jsonlPath: null });
});

test('a rewinding fork is refused before the app-server is touched', async () => {
  const calls: ForkCall[] = [];
  const provider = new ZcodeForkProvider(
    stubClient(calls),
    fixedInputs({
      messages: [{ id: 'm1', timeCreated: 10 }, { id: 'm2', timeCreated: 20 }],
      checkpoints: [{ timeCreated: 15 }],
    }),
  );

  await assert.rejects(
    () => provider.forkSession({
      providerSessionId: 'sess_source',
      jsonlPath: null,
      projectPath: '/tmp',
      upToAnchorId: 'm1',
    }),
    (error: Error & { code?: string }) => error.code === 'FORK_WOULD_REWIND_WORKSPACE',
  );
  assert.equal(calls.length, 0);
});

test('an unknown anchor is refused before the app-server is touched', async () => {
  const calls: ForkCall[] = [];
  const provider = new ZcodeForkProvider(
    stubClient(calls),
    fixedInputs({ messages: [{ id: 'm1', timeCreated: 1 }], checkpoints: [] }),
  );

  await assert.rejects(
    () => provider.forkSession({
      providerSessionId: 'sess_source',
      jsonlPath: null,
      projectPath: '/tmp',
      upToAnchorId: 'gone',
    }),
    (error: Error & { code?: string }) => error.code === 'FORK_ANCHOR_NOT_FOUND',
  );
  assert.equal(calls.length, 0);
});

// ------------------------------------------------------------------ store read

/**
 * Builds a ZCode session database under a temp storage root and points the
 * adapter at it, so the guard and the history reader read the real schema.
 */
async function withZcodeStore<T>(
  build: (db: Database.Database) => void,
  run: () => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'zcode-fork-'));
  const dbDirectory = path.join(home, 'cli', 'db');
  await mkdir(dbDirectory, { recursive: true });

  const db = new Database(path.join(dbDirectory, 'db.sqlite'));
  db.exec(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER,
      time_updated INTEGER, data TEXT NOT NULL, sequence INTEGER
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      time_created INTEGER, time_updated INTEGER, data TEXT NOT NULL, sequence INTEGER
    );
    CREATE TABLE session_entry (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
  `);
  build(db);
  db.close();

  setZcodeHomeDirForTests(home);
  try {
    return await run();
  } finally {
    setZcodeHomeDirForTests(null);
    await rm(home, { recursive: true, force: true });
  }
}

function insertMessage(
  db: Database.Database,
  row: { id: string; sessionId: string; sequence: number; timeCreated: number; data: unknown },
): void {
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, row.sessionId, row.timeCreated, row.timeCreated, JSON.stringify(row.data), row.sequence);
}

function insertPart(
  db: Database.Database,
  row: { id: string; sessionId: string; messageId: string; sequence: number; timeCreated: number; data: unknown },
): void {
  db.prepare('INSERT INTO part (id, session_id, message_id, time_created, time_updated, data, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.sessionId, row.messageId, row.timeCreated, row.timeCreated, JSON.stringify(row.data), row.sequence);
}

function insertCheckpoint(db: Database.Database, sessionId: string, timeCreated: number): void {
  db.prepare('INSERT INTO session_entry (id, session_id, type, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      `workspace-checkpoint:${sessionId}:${timeCreated}`,
      sessionId,
      'runtime/workspace_checkpoint',
      timeCreated,
      timeCreated,
      '{}',
    );
}

test('the guard reads ZCode\'s own message order and workspace checkpoints', async () => {
  const calls: ForkCall[] = [];
  await withZcodeStore(
    (db) => {
      insertMessage(db, { id: 'm1', sessionId: 'sess_fixture', sequence: 0, timeCreated: 100, data: { role: 'user' } });
      insertMessage(db, { id: 'm2', sessionId: 'sess_fixture', sequence: 1, timeCreated: 200, data: { role: 'assistant' } });
      insertCheckpoint(db, 'sess_fixture', 150);
    },
    async () => {
      const provider = new ZcodeForkProvider(stubClient(calls));

      await assert.rejects(
        () => provider.forkSession({
          providerSessionId: 'sess_fixture',
          jsonlPath: null,
          projectPath: '/tmp',
          upToAnchorId: 'm1',
        }),
        (error: Error & { code?: string }) => error.code === 'FORK_WOULD_REWIND_WORKSPACE',
      );

      // Anchoring past the checkpoint is allowed, and reaches the client.
      const result = await provider.forkSession({
        providerSessionId: 'sess_fixture',
        jsonlPath: null,
        projectPath: '/tmp',
        upToAnchorId: 'm2',
      });
      assert.equal(result.providerSessionId, 'native-child');
      assert.deepEqual(calls, [{ providerSessionId: 'sess_fixture', messageId: 'm2' }]);
    },
  );
});

test('history rows carry their ZCode message id as the fork anchor', async () => {
  await withZcodeStore(
    (db) => {
      insertMessage(db, { id: 'msg_user_1', sessionId: 'sess_fixture', sequence: 0, timeCreated: 100, data: { role: 'user' } });
      insertPart(db, {
        id: 'part_user_1',
        sessionId: 'sess_fixture',
        messageId: 'msg_user_1',
        sequence: 0,
        timeCreated: 100,
        data: { type: 'text', text: 'hello' },
      });
    },
    async () => {
      const result = await new ZcodeSessionsProvider().fetchHistory('app-session', {
        providerSessionId: 'sess_fixture',
      });
      const text = result.messages.find((message) => message.kind === 'text');
      assert.ok(text);
      assert.equal(text?.content, 'hello');
      assert.equal(text?.forkAnchorId, 'msg_user_1');
    },
  );
});

// ----------------------------------------------------------- service contract

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zcode-app-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'app.db');
  await initializeDatabase();
  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function withStubbedZcodeFork(run: () => Promise<void>): Promise<void> {
  const zcode = providerRegistry.resolveProvider('zcode') as { fork?: IProviderFork };
  const realFork = zcode.fork;
  Object.defineProperty(zcode, 'fork', {
    value: new ZcodeForkProvider(
      stubClient([]),
      fixedInputs({ messages: [{ id: 'm1', timeCreated: 1 }], checkpoints: [] }),
    ),
    configurable: true,
    writable: true,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(zcode, 'fork', { value: realFork, configurable: true, writable: true });
  }
}

test('a store-backed zcode session with no transcript file can still be forked', async () => {
  await withDatabase(async () => {
    const now = new Date().toISOString();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'zcode-project-'));
    try {
      // ZCode indexes sessions into one shared database, so the app row has no
      // jsonl_path — the case the shared guard used to reject outright.
      sessionsDb.createSession('sess_source', 'zcode', directory, 'Original', now, now, null);

      await withStubbedZcodeFork(async () => {
        const result = await sessionsService.forkSessionById('sess_source', { upToAnchorId: 'm1' });

        const forked = sessionsDb.getSessionById(result.sessionId);
        assert.ok(forked);
        assert.equal(forked?.provider_session_id, 'native-child');
        assert.equal(forked?.jsonl_path, null);
        assert.equal(forked?.forked_from_session_id, 'sess_source');
        assert.equal(forked?.custom_name, 'Original (fork)');
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test('ZCode advertises session forking', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('zcode').supportsSessionForking, true);
});
