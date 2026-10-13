import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  authEventsDb,
  closeConnection,
  getConnection,
  initializeDatabase,
  type AuthEventListParams,
} from '@/modules/database/index.js';
import { createAuthEventsDb } from '@/modules/database/repositories/auth-events.js';

/** List filters that select everything, so a test only has to override what it cares about. */
const ALL: AuthEventListParams = {
  limit: 100,
  offset: 0,
  eventType: null,
  username: null,
  ip: null,
};

/** Runs `runTest` against a fresh on-disk database and restores the previous path afterwards. */
async function withDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'auth-events-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
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

test('record stores each event kind and keeps login_failure user_id null', async () => {
  await withDatabase(() => {
    authEventsDb.record({ type: 'login_failure', username: 'ghost', ip: '203.0.113.1', userAgent: 'ua' });
    authEventsDb.record({ type: 'login_success', userId: 7, username: 'alice', ip: '203.0.113.2' });

    const { events, total } = authEventsDb.list(ALL);

    assert.equal(total, 2);
    const failure = events.find((event) => event.event_type === 'login_failure');
    const success = events.find((event) => event.event_type === 'login_success');
    // The failed attempt keeps the attempted username but never a resolved user id.
    assert.equal(failure?.user_id, null);
    assert.equal(failure?.username, 'ghost');
    assert.equal(success?.user_id, 7);
  });
});

test('list pages without duplicating or skipping rows in the same second', async () => {
  await withDatabase(() => {
    for (let index = 0; index < 10; index += 1) {
      authEventsDb.record({ type: 'login_success', userId: 1, username: 'alice' });
    }

    const firstPage = authEventsDb.list({ ...ALL, limit: 3, offset: 0 });
    const secondPage = authEventsDb.list({ ...ALL, limit: 3, offset: 3 });
    const ids = [...firstPage.events, ...secondPage.events].map((event) => event.id);

    assert.equal(firstPage.total, 10);
    assert.equal(new Set(ids).size, ids.length); // no duplicates across pages
    assert.deepEqual(ids, [10, 9, 8, 7, 6, 5]); // newest first, no gaps
  });
});

test('list filters by event type, username and ip, and total follows the filters', async () => {
  await withDatabase(() => {
    authEventsDb.record({ type: 'login_failure', username: 'ghost', ip: '203.0.113.1' });
    authEventsDb.record({ type: 'login_success', userId: 1, username: 'alice', ip: '203.0.113.2' });
    authEventsDb.record({ type: 'login_failure', username: 'alice', ip: '203.0.113.1' });

    assert.equal(authEventsDb.list({ ...ALL, eventType: 'login_failure' }).total, 2);
    assert.equal(authEventsDb.list({ ...ALL, ip: '203.0.113.1' }).total, 2);
    assert.equal(authEventsDb.list({ ...ALL, username: 'alice' }).total, 2);
  });
});

test('record truncates to a code-point budget without splitting or dropping multi-byte characters', async () => {
  await withDatabase(() => {
    const emoji = '😀'; // one code point, two UTF-16 code units
    const shortWithEmoji = `agent ${emoji} test`;
    // 127 ASCII code points + one emoji: exactly 128 code points, 129 code units.
    const boundaryWithEmoji = `${'a'.repeat(127)}${emoji}`;

    authEventsDb.record({ type: 'login_failure', username: shortWithEmoji, userAgent: 'u'.repeat(600) });
    authEventsDb.record({ type: 'login_failure', username: boundaryWithEmoji });
    authEventsDb.record({ type: 'login_failure', username: 'a'.repeat(200) });

    const rows = authEventsDb.list(ALL).events;

    // Astral characters are preserved verbatim — truncation must never delete
    // them (a code-unit "repair" pass would strip both halves of the pair).
    assert.equal(rows.filter((row) => row.username === shortWithEmoji).length, 1);
    // The cut lands on a code-point boundary, so the trailing emoji survives whole.
    assert.equal(rows.filter((row) => row.username === boundaryWithEmoji).length, 1);
    // Plain ASCII is still bounded by the limit (the budget is code points).
    assert.equal(rows.filter((row) => row.username === 'a'.repeat(128)).length, 1);
    assert.equal(rows.filter((row) => Array.from(row.username ?? '').length > 128).length, 0);
    // The user agent is bounded too, and no row gained a replacement character.
    assert.ok((rows.find((row) => row.user_agent !== null)?.user_agent ?? '').length <= 512);
    assert.ok(!rows.some((row) => (row.username ?? '').includes('\uFFFD')));
  });
});

test('the capacity gate stops new login_failure rows and leaves other kinds alone', async () => {
  await withDatabase(() => {
    const warn = console.warn;
    console.warn = () => undefined; // the gate warns once; keep the test output clean
    try {
      const repository = createAuthEventsDb(3);
      for (let index = 0; index < 3; index += 1) {
        repository.record({ type: 'login_failure', username: 'ghost' });
      }
      repository.record({ type: 'login_failure', username: 'ghost' }); // gated out
      repository.record({ type: 'login_success', userId: 1, username: 'alice' }); // still recorded

      const { events, total } = repository.list(ALL);

      assert.equal(events.filter((event) => event.event_type === 'login_failure').length, 3);
      assert.equal(events.filter((event) => event.event_type === 'login_success').length, 1);
      assert.equal(total, 4);
    } finally {
      console.warn = warn;
    }
  });
});

test('pruneOlderThan removes only rows past the retention window', async () => {
  await withDatabase(() => {
    authEventsDb.record({ type: 'login_success', userId: 1, username: 'alice' });
    getConnection()
      .prepare(
        `INSERT INTO auth_events (event_type, username, created_at)
         VALUES ('login_failure', 'old', datetime('now', '-100 days'))`,
      )
      .run();

    assert.equal(authEventsDb.pruneOlderThan(90), 1);
    const { events } = authEventsDb.list(ALL);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.username, 'alice');
  });
});

test('record swallows a connection failure instead of throwing', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'auth-events-bad-'));
  const blockingFile = path.join(tempDirectory, 'not-a-directory');
  await writeFile(blockingFile, 'x');

  closeConnection();
  // The parent path is a file, so creating the database directory (and thus
  // getConnection) throws — the write must still be swallowed, not propagated.
  process.env.DATABASE_PATH = path.join(blockingFile, 'auth.db');

  try {
    assert.doesNotThrow(() => {
      authEventsDb.record({ type: 'login_success', userId: 1, username: 'alice' });
    });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('importing the repository does not open the database', async () => {
  // Importing must not touch the DB: the capacity-gate baseline is read lazily,
  // and a top-level query would run before initializeDatabase() creates the table.
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'auth-events-import-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const probePath = path.join(tempDirectory, 'probe.mts');
  await writeFile(
    probePath,
    "import fs from 'node:fs';\n"
    + "import('@/modules/database/repositories/auth-events.js').then(() => {\n"
    + "  console.log(fs.existsSync(process.env.DATABASE_PATH ?? '') ? 'CREATED' : 'ABSENT');\n"
    + '});\n',
  );

  try {
    const output = execFileSync(
      path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
      ['--tsconfig', 'server/tsconfig.json', probePath],
      { cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: databasePath }, encoding: 'utf8' },
    );
    assert.match(output, /ABSENT/);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
