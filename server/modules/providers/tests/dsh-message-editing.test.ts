import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { decodeDshSessionLogStrict } from '@/modules/providers/list/dsh/dsh-fork.provider.js';
import { encodeSessionSegment, projectKey } from '@/modules/providers/list/dsh/dsh-session-path.js';
import { DshSessionSynchronizer } from '@/modules/providers/list/dsh/dsh-session-synchronizer.provider.js';
import { DshSessionsProvider } from '@/modules/providers/list/dsh/dsh-sessions.provider.js';
import { dshRuntime } from '@/modules/providers/list/dsh/dsh-runtime.provider.js';

/**
 * DSH cannot resume into the middle of a session, so editing a message copies
 * the prefix that precedes it and moves the session onto the copy — the same
 * artifact a fork writes. These cover both halves: which messages are
 * addressable and what boundary they resolve to, and that the rewind leaves the
 * pre-edit transcript on disk without the indexer handing it back.
 */

async function withIsolatedEnvironment(
  runTest: (env: { sessionsRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionsRoot = process.env.DSH_SESSIONS_ROOT;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-edit-test-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const sessionsRoot = path.join(tempDirectory, 'sessions');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.DSH_SESSIONS_ROOT = sessionsRoot;
  await initializeDatabase();
  await mkdir(cwd, { recursive: true });

  try {
    await runTest({ sessionsRoot, cwd });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSessionsRoot === undefined) {
      delete process.env.DSH_SESSIONS_ROOT;
    } else {
      process.env.DSH_SESSIONS_ROOT = previousSessionsRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Writes one v4 session log, stored as concatenated Zstandard frames. */
async function writeSessionLog(
  sessionsRoot: string,
  cwd: string,
  acpSessionId: string,
  events: unknown[],
): Promise<string> {
  const header = {
    type: 'session',
    version: 4,
    id: acpSessionId,
    createdAt: Date.now(),
    cwd,
    delegationDepth: 0,
  };
  const lines = [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))];
  const logDirectory = path.join(sessionsRoot, projectKey(cwd), encodeSessionSegment(acpSessionId));
  await mkdir(logDirectory, { recursive: true });
  const logPath = path.join(logDirectory, 'session.v4.jsonl.zstd');
  await writeFile(logPath, Buffer.concat(lines.map((line) => zlib.zstdCompressSync(Buffer.from(`${line}\n`)))));
  return logPath;
}

const userMessage = (text: string, seq: number, time: number) => ({
  type: 'user/message',
  seq,
  time,
  data: {
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
    role: 'user',
  },
});

const assistantMessage = (text: string, seq: number, time: number) => ({
  type: 'assistant/message',
  seq,
  time,
  data: {
    message: {
      id: `msg-${seq}`,
      content: [{ type: 'text', text }],
      source: { kind: 'model', model: 'deepseek-v4-flash' },
    },
  },
});

/** One closed turn: a prompt, its reply, and the boundary that ends it. */
const turn = (turnNumber: number, startSeq: number, prompt: string, reply: string) => {
  const time = 1_800_000_000_000 + startSeq * 10;
  return [
    { type: 'turn/start', seq: startSeq, time, data: { turn: turnNumber } },
    userMessage(prompt, startSeq + 1, time + 1),
    assistantMessage(reply, startSeq + 2, time + 2),
    { type: 'turn/end', seq: startSeq + 3, time: time + 3, data: { turn: turnNumber, reason: { kind: 'completed' } } },
  ];
};

/** Registers the app session and points it at the log the runtime announced. */
function indexSession(appSessionId: string, acpSessionId: string, cwd: string): void {
  sessionsDb.createAppSession(appSessionId, 'dsh', cwd, 'DSH session');
  sessionsDb.assignProviderSessionId(appSessionId, acpSessionId);
}

test('resolveEditAnchor resolves a prompt to the turn boundary before it', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeSessionLog(sessionsRoot, cwd, 'acp-edit', [
      ...turn(1, 0, '第一问', '第一答'),
      ...turn(2, 4, '第二问', '第二答'),
      ...turn(3, 8, '第三问', '第三答'),
    ]);
    indexSession('app-edit', 'acp-edit', cwd);

    const provider = new DshSessionsProvider();
    // Editing the first prompt has nothing to resume through: start over.
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', '1'),
      { found: true, resumeThroughId: null },
    );
    // Every later prompt keeps the turn that preceded it.
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', '5'),
      { found: true, resumeThroughId: '3' },
    );
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', '9'),
      { found: true, resumeThroughId: '7' },
    );
  });
});

test('resolveEditAnchor refuses replies, injected context and unknown anchors', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeSessionLog(sessionsRoot, cwd, 'acp-edit', [
      ...turn(1, 0, '第一问', '第一答'),
      {
        type: 'user/message',
        seq: 4,
        time: 1_800_000_000_100,
        data: {
          content: [{ type: 'text', text: '工作区上下文' }],
          source: { kind: 'workspace' },
          role: 'user',
        },
      },
      ...turn(2, 5, '第二问', '第二答'),
    ]);
    indexSession('app-edit', 'acp-edit', cwd);

    const provider = new DshSessionsProvider();
    // A reply is not a prompt, injected context is not the user's own words,
    // and a seq that no event carries is not an entry point at all.
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', '2'),
      { found: false, resumeThroughId: null },
    );
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', '4'),
      { found: false, resumeThroughId: null },
    );
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', '999'),
      { found: false, resumeThroughId: null },
    );
    assert.deepEqual(
      await provider.resolveEditAnchor('app-edit', 'not-a-seq'),
      { found: false, resumeThroughId: null },
    );
  });
});

test('rewind copies the kept prefix and moves the row onto the copy', async (t) => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const released: string[] = [];
    t.mock.method(
      // The contract marks the hook optional, so the runtime's own type is the
      // only place the implementation is visible to the mocker.
      dshRuntime as unknown as { disposeSession(id: string): Promise<void> },
      'disposeSession',
      async (id: string) => {
        released.push(id);
      },
    );

    const sourcePath = await writeSessionLog(sessionsRoot, cwd, 'acp-edit', [
      ...turn(1, 0, '第一问', '第一答'),
      ...turn(2, 4, '第二问', '第二答'),
      ...turn(3, 8, '第三问', '第三答'),
    ]);
    indexSession('app-edit', 'acp-edit', cwd);

    await new DshSessionsProvider().rewindSession('app-edit', '3');

    const row = sessionsDb.getSessionById('app-edit');
    assert.ok(row);
    assert.notEqual(row.provider_session_id, 'acp-edit');
    const rewrittenPath = row.jsonl_path;
    assert.ok(rewrittenPath, 'the row must record the transcript it now reads');
    assert.equal(
      path.dirname(rewrittenPath),
      path.join(path.dirname(path.dirname(sourcePath)), encodeSessionSegment(row.provider_session_id as string)),
    );

    const artifact = decodeDshSessionLogStrict(await readFile(rewrittenPath), rewrittenPath);
    assert.equal(artifact.header.id, row.provider_session_id);
    assert.equal(artifact.header.isSeeded, true, 'a resumed prefix is a seed');
    assert.equal(artifact.header.parentSession, undefined, 'a seed with a parent is unresumable');
    // The prefix ends on the kept turn boundary, plus the inherited marker.
    assert.equal(artifact.events.length, 5);
    assert.equal(artifact.events[3].type, 'turn/end');
    assert.equal(artifact.events.at(-1)?.type, 'session/end-seed');

    // The pre-edit transcript stays on disk for recovery, and is recorded as
    // left behind so nothing offers it back.
    assert.ok(await readFile(sourcePath));
    assert.equal(sessionsDb.isProviderSessionSuperseded('acp-edit', 'dsh'), true);

    // The ACP child held the old log open; the conversation is released so it
    // cannot keep appending to a transcript the row no longer points at.
    assert.deepEqual(released, ['acp-edit']);
  });
});

test('editing the first prompt detaches the row instead of branching', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeSessionLog(sessionsRoot, cwd, 'acp-edit', [
      ...turn(1, 0, '第一问', '第一答'),
      ...turn(2, 4, '第二问', '第二答'),
    ]);
    indexSession('app-edit', 'acp-edit', cwd);

    await new DshSessionsProvider().rewindSession('app-edit', null);

    const row = sessionsDb.getSessionById('app-edit');
    assert.equal(row?.provider_session_id, null, 'the next run starts a fresh conversation');
    assert.equal(row?.jsonl_path, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded('acp-edit', 'dsh'), true);
    // The old log is still there — the abandoned attempt stays recoverable.
    assert.equal(sessionsDb.getSessionByProviderSessionId('acp-edit'), null);
  });
});

test('a full rescan does not hand an edited-away transcript back', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeSessionLog(sessionsRoot, cwd, 'acp-edit', [
      ...turn(1, 0, '第一问', '第一答'),
      ...turn(2, 4, '第二问', '第二答'),
    ]);
    indexSession('app-edit', 'acp-edit', cwd);
    projectsDb.createProjectPath(cwd);

    await new DshSessionsProvider().rewindSession('app-edit', '3');
    const rewrittenSessionId = sessionsDb.getSessionById('app-edit')?.provider_session_id;
    assert.ok(rewrittenSessionId);

    // The relinked row's own log is the only one the scan may keep; the
    // superseded one must not come back as a row or a repoint.
    await new DshSessionSynchronizer().synchronize();

    const row = sessionsDb.getSessionById('app-edit');
    assert.equal(row?.provider_session_id, rewrittenSessionId);
    assert.equal(sessionsDb.getSessionByProviderSessionId('acp-edit'), null);
    assert.equal(sessionsDb.getSessionById('acp-edit'), null);
  });
});

test('an indexer pass that read the directory before the edit cannot revive it', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeSessionLog(sessionsRoot, cwd, 'acp-edit', [
      ...turn(1, 0, '第一问', '第一答'),
      ...turn(2, 4, '第二问', '第二答'),
    ]);
    indexSession('app-edit', 'acp-edit', cwd);

    await new DshSessionsProvider().rewindSession('app-edit', '3');
    const rewrittenSessionId = sessionsDb.getSessionById('app-edit')?.provider_session_id;

    // The unconditional write point: a scan that already resolved the old
    // directory calls createSession after the edit committed.
    const returned = sessionsDb.createSession('acp-edit', 'dsh', cwd, '旧标题');

    assert.equal(returned, 'acp-edit');
    assert.equal(sessionsDb.getSessionById('app-edit')?.provider_session_id, rewrittenSessionId);
    assert.equal(sessionsDb.getSessionByProviderSessionId('acp-edit'), null);
  });
})
