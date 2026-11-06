import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { DshForkProvider, decodeDshSessionLogStrict } from '@/modules/providers/list/dsh/dsh-fork.provider.js';
import { encodeSessionSegment, projectKey } from '@/modules/providers/list/dsh/dsh-session-path.js';

const ZSTD_FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

type Event = Record<string, unknown>;

/**
 * Runs one test body with `DSH_SESSIONS_ROOT` pointed at a fresh directory and
 * a project cwd under it. The fork path reads its source through that root, so
 * an isolated one keeps a test from touching the real harness home.
 */
async function withSessionsRoot(
  runTest: (environment: { sessionsRoot: string; cwd: string; projectDir: string }) => Promise<void>,
): Promise<void> {
  const previousRoot = process.env.DSH_SESSIONS_ROOT;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'dsh-fork-test-'));
  const sessionsRoot = path.join(tempDirectory, 'sessions');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');
  const projectDir = path.join(sessionsRoot, projectKey(cwd));
  await mkdir(projectDir, { recursive: true });
  process.env.DSH_SESSIONS_ROOT = sessionsRoot;

  try {
    await runTest({ sessionsRoot, cwd, projectDir });
  } finally {
    if (previousRoot === undefined) {
      delete process.env.DSH_SESSIONS_ROOT;
    } else {
      process.env.DSH_SESSIONS_ROOT = previousRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** One realistic two-turn conversation, with dense seqs from 0. */
function conversation(): Event[] {
  const time = 1_800_000_000_000;
  return [
    { type: 'turn/start', seq: 0, time, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 1,
      time,
      surfaceOp: 'append',
      data: {
        content: [{ type: 'text', text: '我让你读取的项目路径是什么' }],
        source: { kind: 'user' },
        role: 'user',
        id: 'user-1',
      },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time,
      surfaceOp: 'append',
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '/Users/selier/Projects/open_projects/dsh-purge-mirror' }],
          source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
          id: 'assistant-1',
        },
      },
    },
    { type: 'turn/end', seq: 3, time, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 4, time, data: { turn: 2 } },
    {
      type: 'user/message',
      seq: 5,
      time,
      surfaceOp: 'append',
      data: {
        content: [{ type: 'text', text: '再总结一下' }],
        source: { kind: 'user' },
        role: 'user',
        id: 'user-2',
      },
    },
    {
      type: 'assistant/message',
      seq: 6,
      time,
      surfaceOp: 'append',
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '它是 DSH 的镜像目录。' }],
          source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
          id: 'assistant-2',
        },
      },
    },
    { type: 'turn/end', seq: 7, time, data: { turn: 2, reason: { kind: 'completed' } } },
  ];
}

/**
 * Writes one source log in the harness layout. `compression: 'none'` writes a
 * plaintext `.jsonl` file, matching a root configured without Zstandard.
 */
async function writeSourceLog(
  projectDir: string,
  cwd: string,
  sessionId: string,
  events: Event[],
  options: { fileName?: string; compression?: 'zstd' | 'none'; header?: Record<string, unknown> } = {},
): Promise<string> {
  const { fileName = 'session.v4.jsonl.zstd', compression = 'zstd' } = options;
  const header = {
    type: 'session',
    version: 4,
    id: sessionId,
    createdAt: 1_800_000_000_000,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    ...options.header,
  };
  const lines = [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))];
  const payload = compression === 'zstd'
    ? Buffer.concat(lines.map((line) => zlib.zstdCompressSync(Buffer.from(`${line}\n`, 'utf8'))))
    : Buffer.from(lines.map((line) => `${line}\n`).join(''), 'utf8');
  const directory = path.join(projectDir, encodeSessionSegment(sessionId));
  await mkdir(directory, { recursive: true });
  const logPath = path.join(directory, fileName);
  await writeFile(logPath, payload);
  return logPath;
}

const fork = new DshForkProvider();

const forkOnce = (input: {
  providerSessionId: string;
  jsonlPath: string | null;
  projectPath: string;
  upToAnchorId?: string;
}) => fork.forkSession(input);

test('fork copies the prefix through the anchor into a resumable seed', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourceId = 'source-session-1';
    const sourcePath = await writeSourceLog(projectDir, cwd, sourceId, conversation());
    const sourceBytes = await readFile(sourcePath);

    const forked = await forkOnce({
      providerSessionId: sourceId,
      jsonlPath: sourcePath,
      projectPath: cwd,
      upToAnchorId: '3',
    });

    assert.notEqual(forked.providerSessionId, sourceId);
    assert.match(forked.providerSessionId, /^[0-9a-f-]{36}$/);
    assert.equal(
      forked.jsonlPath,
      path.join(projectDir, encodeSessionSegment(forked.providerSessionId), 'session.v4.jsonl.zstd'),
      'the fork lands beside its source under the same project key and file name',
    );

    const log = decodeDshSessionLogStrict(await readFile(forked.jsonlPath), forked.jsonlPath);
    assert.equal(log.header.version, 4);
    assert.equal(log.header.id, forked.providerSessionId);
    assert.equal(log.header.isSeeded, true);
    assert.equal(log.header.cwd, cwd);
    assert.equal(log.header.delegationDepth, 0);
    assert.equal(log.header.parentSession, undefined, 'a parented session cannot be resumed');
    assert.equal(log.events.length, 5, 'four source events plus the end-seed marker');
    assert.deepEqual(log.events.slice(0, 4), conversation().slice(0, 4), 'the prefix is copied verbatim');
    assert.deepEqual(log.events[4], {
      type: 'session/end-seed',
      seq: 4,
      time: 1_800_000_000_000,
      data: { inherited: true },
    });

    assert.deepEqual(await readFile(sourcePath), sourceBytes, 'the source log is never modified');
  });
});

test('fork writes the header line in a Zstandard frame of its own', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourceId = 'source-session-frames';
    const sourcePath = await writeSourceLog(projectDir, cwd, sourceId, conversation());
    const forked = await forkOnce({
      providerSessionId: sourceId,
      jsonlPath: sourcePath,
      projectPath: cwd,
      upToAnchorId: '3',
    });

    const payload = await readFile(forked.jsonlPath);
    const secondFrame = payload.indexOf(ZSTD_FRAME_MAGIC, ZSTD_FRAME_MAGIC.length);
    assert.ok(secondFrame > 0, 'the fork must hold more than one frame');
    const firstFrameText = zlib.zstdDecompressSync(payload.subarray(0, secondFrame)).toString('utf8');
    assert.equal(firstFrameText.split('\n').length, 2, 'frame 0 is exactly one header line plus its newline');
    assert.equal(JSON.parse(firstFrameText).type, 'session');
  });
});

test('fork without an anchor copies the whole closed session', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourcePath = await writeSourceLog(projectDir, cwd, 'source-whole', conversation());
    const forked = await forkOnce({
      providerSessionId: 'source-whole',
      jsonlPath: sourcePath,
      projectPath: cwd,
    });

    const log = decodeDshSessionLogStrict(await readFile(forked.jsonlPath), forked.jsonlPath);
    assert.equal(log.events.length, 9, 'all eight events plus the end-seed marker');
    assert.equal(log.events[8].type, 'session/end-seed');
    assert.equal(log.events[8].seq, 8);
  });
});

test('a fork of a fork keeps the old end-seed and appends a new one', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourcePath = await writeSourceLog(projectDir, cwd, 'source-of-fork', conversation());
    const first = await forkOnce({
      providerSessionId: 'source-of-fork',
      jsonlPath: sourcePath,
      projectPath: cwd,
      upToAnchorId: '7',
    });

    // A fork that has continued talking: the inherited marker sits inside the
    // log and the last event is again a closed turn.
    const continued = decodeDshSessionLogStrict(await readFile(first.jsonlPath), first.jsonlPath);
    const events: Event[] = [
      ...continued.events,
      { type: 'turn/start', seq: 9, time: 1_800_000_000_000, data: { turn: 3 } },
      {
        type: 'user/message',
        seq: 10,
        time: 1_800_000_000_000,
        data: {
          content: [{ type: 'text', text: '继续' }],
          source: { kind: 'user' },
          role: 'user',
          id: 'user-3',
        },
      },
      { type: 'turn/end', seq: 11, time: 1_800_000_000_000, data: { turn: 3, reason: { kind: 'completed' } } },
    ];
    const headerLine = `${JSON.stringify({ type: 'session', ...continued.header })}\n`;
    const body = events.map((event) => `${JSON.stringify(event)}\n`).join('');
    await writeFile(first.jsonlPath, Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8')),
      zlib.zstdCompressSync(Buffer.from(body, 'utf8')),
    ]));

    const second = await forkOnce({
      providerSessionId: first.providerSessionId,
      jsonlPath: first.jsonlPath,
      projectPath: cwd,
    });

    const log = decodeDshSessionLogStrict(await readFile(second.jsonlPath), second.jsonlPath);
    const markers = log.events.filter((event) => event.type === 'session/end-seed');
    assert.equal(markers.length, 2, 'the inherited marker is copied, not rewritten');
    assert.equal(markers[0].seq, 8);
    assert.equal(markers[1].seq, log.events.length - 1, 'the new marker is last');
    assert.equal(log.header.isSeeded, true);
  });
});

test('fork inherits a plaintext .jsonl encoding instead of writing zstd', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourcePath = await writeSourceLog(projectDir, cwd, 'source-plain', conversation(), {
      fileName: 'session.v4.jsonl',
      compression: 'none',
    });
    const forked = await forkOnce({
      providerSessionId: 'source-plain',
      jsonlPath: sourcePath,
      projectPath: cwd,
      upToAnchorId: '3',
    });

    assert.ok(forked.jsonlPath.endsWith('session.v4.jsonl'), 'the suffix follows the source root');
    const payload = await readFile(forked.jsonlPath);
    assert.equal(payload.includes(ZSTD_FRAME_MAGIC), false);
    const log = decodeDshSessionLogStrict(payload, forked.jsonlPath);
    assert.equal(log.header.isSeeded, true);
  });
});

test('fork repoints a delivery marker at the new session id', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const events = conversation();
    events.splice(2, 0, {
      type: 'session-log-deepseek/delivery-accepted',
      seq: 2,
      time: 1_800_000_000_000,
      data: { sessionFormatVersion: 4, throughSeq: 1, sessionId: 'source-delivery' },
    });
    // Keep the sequence dense after the insertion.
    events.forEach((event, index) => {
      event.seq = index;
    });
    const sourcePath = await writeSourceLog(projectDir, cwd, 'source-delivery', events);

    const forked = await forkOnce({
      providerSessionId: 'source-delivery',
      jsonlPath: sourcePath,
      projectPath: cwd,
      upToAnchorId: '4',
    });

    const log = decodeDshSessionLogStrict(await readFile(forked.jsonlPath), forked.jsonlPath);
    const marker = log.events.find((event) => event.type === 'session-log-deepseek/delivery-accepted');
    assert.ok(marker);
    assert.equal((marker.data as Record<string, unknown>).sessionId, forked.providerSessionId);
    assert.equal((marker.data as Record<string, unknown>).throughSeq, 1, 'only the session id is rewritten');
    assert.equal(marker.seq, 2, 'the marker keeps its own sequence');
  });
});

test('fork rejects an unknown event type and leaves no artifact behind', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const events = conversation();
    events[2] = { type: 'future/unknown-event', seq: 2, time: 1_800_000_000_000, data: {} };
    await writeSourceLog(projectDir, cwd, 'source-unknown', events);
    const before = await readdir(projectDir);

    await assert.rejects(
      forkOnce({
        providerSessionId: 'source-unknown',
        jsonlPath: null,
        projectPath: cwd,
        upToAnchorId: '3',
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_UNSUPPORTED_FORMAT',
    );
    assert.deepEqual((await readdir(projectDir)).sort(), before.sort(), 'nothing was written');
  });
});

test('fork rejects a header version it does not know', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const pathWithVersion = await writeSourceLog(projectDir, cwd, 'source-v5', conversation(), {
      fileName: 'session.v5.jsonl.zstd',
      header: { version: 5 },
    });
    await assert.rejects(
      forkOnce({
        providerSessionId: 'source-v5',
        jsonlPath: pathWithVersion,
        projectPath: cwd,
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_UNSUPPORTED_FORMAT',
    );
  });
});

test('fork rejects a file name that disagrees with the header version', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourcePath = await writeSourceLog(projectDir, cwd, 'source-mismatch', conversation(), {
      fileName: 'session.v4.jsonl.zstd',
      header: { version: 4 },
    });
    // Same content, but named for a different generation than the header claims.
    const renamed = path.join(path.dirname(sourcePath), 'session.v3.jsonl.zstd');
    await writeFile(renamed, await readFile(sourcePath));
    await rm(sourcePath);

    await assert.rejects(
      forkOnce({
        providerSessionId: 'source-mismatch',
        jsonlPath: renamed,
        projectPath: cwd,
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_UNSUPPORTED_FORMAT',
    );
  });
});

test('fork rejects a non-dense event sequence', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const events = conversation();
    const { seq: _omitted, ...withoutSeq } = events[2];
    events[2] = withoutSeq;
    await writeSourceLog(projectDir, cwd, 'source-gap', events);
    await assert.rejects(
      forkOnce({
        providerSessionId: 'source-gap',
        jsonlPath: null,
        projectPath: cwd,
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_SOURCE_CORRUPT',
    );
  });
});

test('fork refuses an anchor that is not a turn boundary', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    await writeSourceLog(projectDir, cwd, 'source-anchor', conversation());
    for (const anchor of ['1', '99', 'abc', '-1']) {
      await assert.rejects(
        forkOnce({
          providerSessionId: 'source-anchor',
          jsonlPath: null,
          projectPath: cwd,
          upToAnchorId: anchor,
        }),
        (error: unknown) => (error as { code?: string }).code === 'FORK_ANCHOR_INVALID',
        `anchor ${anchor} must be refused`,
      );
    }
  });
});

test('fork of the whole session refuses a log whose last turn is still open', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const events = conversation();
    events.push({ type: 'step/start', seq: 8, time: 1_800_000_000_000, data: { turn: 3, step: 1 } });
    await writeSourceLog(projectDir, cwd, 'source-open', events);

    await assert.rejects(
      forkOnce({
        providerSessionId: 'source-open',
        jsonlPath: null,
        projectPath: cwd,
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_SOURCE_NOT_READY',
    );

    // Cutting at the last closed turn is still allowed.
    const forked = await forkOnce({
      providerSessionId: 'source-open',
      jsonlPath: null,
      projectPath: cwd,
      upToAnchorId: '7',
    });
    const log = decodeDshSessionLogStrict(await readFile(forked.jsonlPath), forked.jsonlPath);
    assert.equal(log.events.at(-1)?.type, 'session/end-seed');
  });
});

test('fork requires a source log and never falls back to the newest log in the project', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    await writeSourceLog(projectDir, cwd, 'another-session', conversation());
    await assert.rejects(
      forkOnce({
        providerSessionId: 'missing-session',
        jsonlPath: null,
        projectPath: cwd,
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_SOURCE_NOT_READY',
    );
  });
});

test('fork refuses a recorded path that belongs to another session', async () => {
  await withSessionsRoot(async ({ cwd, projectDir }) => {
    const sourcePath = await writeSourceLog(projectDir, cwd, 'source-path', conversation());
    const otherPath = await writeSourceLog(projectDir, cwd, 'other-path', conversation());

    await assert.rejects(
      forkOnce({
        providerSessionId: 'source-path',
        jsonlPath: otherPath,
        projectPath: cwd,
        upToAnchorId: '3',
      }),
      (error: unknown) => (error as { code?: string }).code === 'FORK_SOURCE_NOT_READY',
    );

    const forked = await forkOnce({
      providerSessionId: 'source-path',
      jsonlPath: sourcePath,
      projectPath: cwd,
      upToAnchorId: '3',
    });
    assert.equal(await stat(forked.jsonlPath).then((info) => info.isFile()), true);
  });
});
