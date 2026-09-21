import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { resetOmpModelsForTests } from '@/modules/providers/list/omp/omp-models.provider.js';
import { OmpSessionSynchronizer } from '@/modules/providers/list/omp/omp-session-synchronizer.provider.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const TITLED = {
  fixture: 'omp-transcript-titled.jsonl',
  uuid: '01a0c3c6-856e-743f-acd3-bd2b990212e3',
  file: '2026-09-21T11-42-42-542Z_01a0c3c6-856e-743f-acd3-bd2b990212e3.jsonl',
};
const UNTITLED = {
  fixture: 'omp-transcript-untitled.jsonl',
  uuid: '01a0c34a-5806-72f6-9609-a95aee132e18',
  file: '2026-09-21T09-27-04-454Z_01a0c34a-5806-72f6-9609-a95aee132e18.jsonl',
};

async function withIsolatedEnvironment(
  runTest: (env: { sessionsRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionsRoot = process.env.PI_CODING_AGENT_SESSION_DIR;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'omp-session-sync-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const sessionsRoot = path.join(tempDirectory, 'sessions');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.PI_CODING_AGENT_SESSION_DIR = sessionsRoot;
  resetOmpModelsForTests();
  await initializeDatabase();
  await mkdir(cwd, { recursive: true });

  try {
    await runTest({ sessionsRoot, cwd });
  } finally {
    closeConnection();
    resetOmpModelsForTests();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSessionsRoot === undefined) {
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    } else {
      process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionsRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Mirrors OMP's directory encoding. */
function encodeOmpCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

async function writeOmpFixture(
  sessionsRoot: string,
  cwd: string,
  fixture: { fixture: string; file: string },
): Promise<string> {
  const raw = await readFile(path.join(FIXTURES_DIR, fixture.fixture), 'utf8');
  const dir = path.join(sessionsRoot, encodeOmpCwd(cwd));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fixture.file);
  await writeFile(filePath, raw.replaceAll('__OMP_CWD__', cwd));
  return filePath;
}

const header = (uuid: string, cwd: string) => ({
  type: 'session',
  version: 3,
  id: uuid,
  timestamp: '2026-09-21T00:00:00.000Z',
  cwd,
});

const userMessage = (id: string, parentId: string | null, content: unknown) => ({
  type: 'message',
  id,
  parentId,
  timestamp: '2026-09-21T00:00:01.000Z',
  message: { role: 'user', content, timestamp: 1789990948474 },
});

test('synchronizer indexes a real OMP transcript and reads its title line', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const filePath = await writeOmpFixture(sessionsRoot, cwd, TITLED);

    const processed = await new OmpSessionSynchronizer().synchronize();
    assert.equal(processed, 1);

    const session = sessionsDb.getSessionById(TITLED.uuid);
    assert.ok(session);
    assert.equal(session.provider, 'omp');
    assert.equal(session.project_path, cwd);
    assert.equal(session.jsonl_path, filePath);
    // The CLI-generated title wins over the first prompt.
    assert.equal(session.custom_name, 'Attachment smoke test');
  });
});

test('synchronizer falls back to the first user prompt when the title is empty', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeOmpFixture(sessionsRoot, cwd, UNTITLED);

    const processed = await new OmpSessionSynchronizer().synchronize();
    assert.equal(processed, 1);
    assert.equal(sessionsDb.getSessionById(UNTITLED.uuid)?.custom_name, 'Describe this bug');
  });
});

// OMP rewrites the first `title` line in place once it has titled the session,
// so a later scan has to upgrade a prompt-derived name to the real title.
test('synchronizer upgrades a prompt-derived name to a later OMP title', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const filePath = await writeOmpFixture(sessionsRoot, cwd, UNTITLED);
    const synchronizer = new OmpSessionSynchronizer();

    await synchronizer.synchronize();
    assert.equal(sessionsDb.getSessionById(UNTITLED.uuid)?.custom_name, 'Describe this bug');

    // Simulate OMP filling the title in afterwards.
    const lines = (await readFile(filePath, 'utf8')).split('\n');
    lines[0] = JSON.stringify({
      type: 'title',
      v: 1,
      title: 'Summarize the parser bug',
      updatedAt: '2026-09-21T09:30:00.000Z',
      pad: '  ',
    });
    await writeFile(filePath, lines.join('\n'));

    await synchronizer.synchronize();
    assert.equal(sessionsDb.getSessionById(UNTITLED.uuid)?.custom_name, 'Summarize the parser bug');
  });
});

test('synchronizer tolerates malformed transcript lines', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000010';
    const dir = path.join(sessionsRoot, encodeOmpCwd(cwd));
    await mkdir(dir, { recursive: true });
    // The header leads (as in every real OMP transcript, where the valid-JSON
    // `title` line sits above it); later malformed rows must not stop the scan.
    await writeFile(
      path.join(dir, `2026-09-21T00-00-00-000Z_${uuid}.jsonl`),
      `${JSON.stringify(header(uuid, cwd))}\nnot-json\n${JSON.stringify(userMessage('a1', null, 'ok'))}\n`,
    );

    const processed = await new OmpSessionSynchronizer().synchronize();
    assert.equal(processed, 1);
    assert.ok(sessionsDb.getSessionById(uuid));
  });
});

test('synchronizer does not resurrect archived sessions on a full re-scan', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeOmpFixture(sessionsRoot, cwd, TITLED);

    const synchronizer = new OmpSessionSynchronizer();
    await synchronizer.synchronize();
    sessionsDb.updateSessionIsArchived(TITLED.uuid, true);

    const processed = await synchronizer.synchronize();
    assert.equal(processed, 0);
    assert.equal(sessionsDb.getSessionById(TITLED.uuid)?.isArchived, 1);
  });
});

test('resolveTranscriptPath finds the file via encoded dir and uuid fallback', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000011';
    const oddCwd = path.join(sessionsRoot, 'space dir', '项目-名');
    await mkdir(oddCwd, { recursive: true });
    // Write under a directory whose encoding OMP would not derive this way.
    const oddDir = path.join(sessionsRoot, 'some-other-location');
    await mkdir(oddDir, { recursive: true });
    const filePath = path.join(oddDir, `2026-09-21T00-00-00-000Z_${uuid}.jsonl`);
    await writeFile(filePath, `${JSON.stringify(header(uuid, oddCwd))}\n`);

    const resolved = await new OmpSessionSynchronizer().resolveTranscriptPath(uuid, oddCwd);
    assert.equal(resolved, filePath);
  });
});

test('synchronizer uses a full scan once, then honors the incremental cursor', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000012';
    const dir = path.join(sessionsRoot, encodeOmpCwd(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `2026-09-21T00-00-00-000Z_${uuid}.jsonl`),
      `${JSON.stringify(header(uuid, cwd))}\n${JSON.stringify(userMessage('a1', null, 'Backfill this session'))}\n`,
    );

    const synchronizer = new OmpSessionSynchronizer();
    assert.equal(await synchronizer.synchronize(), 1);

    // A second scan with a cursor far in the future must not re-walk files.
    assert.equal(await synchronizer.synchronize(new Date('2030-01-01T00:00:00Z')), 0);

    // A new file inside the cursor window is picked up. utimes only rewrites
    // atime/mtime (not birthtime), so stamp mtime clearly past the cursor to
    // avoid same-millisecond flakiness on APFS.
    const cursor = new Date();
    const uuid2 = '01a0c3c6-0000-7000-8000-000000000013';
    const filePath = path.join(dir, `2026-09-21T00-00-00-000Z_${uuid2}.jsonl`);
    await writeFile(filePath, `${JSON.stringify(header(uuid2, cwd))}\n${JSON.stringify(userMessage('b1', null, 'Fresh session'))}\n`);
    const stamped = new Date(Date.now() + 1_000);
    await utimes(filePath, stamped, stamped);

    assert.equal(await synchronizer.synchronize(cursor), 1);
    assert.ok(sessionsDb.getSessionById(uuid2));
  });
});
