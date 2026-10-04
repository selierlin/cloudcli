import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  OmpForkProvider,
  buildOmpForkTranscript,
  ompTranscriptStamp,
  selectOmpForkBranch,
} from '@/modules/providers/list/omp/omp-fork.provider.js';
import { normalizeOmpAgentMessage } from '@/modules/providers/list/omp/omp-sessions.provider.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';

// ------------------------------------------------------------------ fixtures

/** OMP's first line is a fixed-width 255-byte title slot rewritten in place. */
function titleLine(): string {
  const base = '{"type":"title","v":1,"title":"","updatedAt":"2026-10-04T08:36:00.292Z","pad":"';
  const suffix = '"}';
  return `${base}${' '.repeat(255 - base.length - suffix.length)}${suffix}`;
}

function sessionHeader(id: string): string {
  return JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-10-04T08:36:00.292Z', cwd: '/tmp/proj' });
}

function entry(id: string, parentId: string | null, role: string, text: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: '2026-10-04T08:36:00.292Z',
    message: { role, content: [{ type: 'text', text }], stopReason: role === 'assistant' ? 'stop' : undefined },
  });
}

/**
 * A two-exchange conversation plus an abandoned branch: `a2b` is an alternate
 * answer to `u2`, so the file's tail is the active branch and `a2` is not.
 */
function transcript(): string {
  return [
    titleLine(),
    sessionHeader('old-id'),
    JSON.stringify({ type: 'model_change', id: 'mc', parentId: null, model: 'x' }),
    JSON.stringify({ type: 'thinking_level_change', id: 'tl', parentId: 'mc' }),
    entry('u1', 'tl', 'user', 'first'),
    entry('a1', 'u1', 'assistant', 'one'),
    entry('u2', 'a1', 'user', 'second'),
    entry('a2b', 'u2', 'assistant', 'two-b'),
    JSON.stringify({ type: 'custom', id: 'cs', parentId: 'a2b' }),
  ].join('\n').concat('\n');
}

type Line = { raw: string; data: Record<string, unknown> };

function body(value: string): Line[] {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(2)
    .map((raw) => ({ raw, data: JSON.parse(raw) as Record<string, unknown> }));
}

function ids(lines: Line[]): unknown[] {
  return lines.map((line) => line.data.id);
}

// ------------------------------------------------------------- branch select

test('the cut is inclusive of the anchor', () => {
  const kept = ids(selectOmpForkBranch(body(transcript()), 'a1'));
  assert.deepEqual(kept, ['mc', 'tl', 'u1', 'a1']);
});

test('omitting the anchor keeps the whole active branch', () => {
  const kept = ids(selectOmpForkBranch(body(transcript()), undefined));
  assert.deepEqual(kept, ['mc', 'tl', 'u1', 'a1', 'u2', 'a2b', 'cs']);
});

test('an anchor that is no longer in the session is refused rather than guessed', () => {
  assert.throws(
    () => selectOmpForkBranch(body(transcript()), 'gone'),
    (error: Error & { code?: string }) => error.code === 'FORK_ANCHOR_NOT_FOUND',
  );
});

test('entries from an abandoned branch are not inherited', () => {
  // `a2` is an alternate answer to `u2` that is no longer the tail, so the
  // active branch runs through `a2b` and `a2` must not be copied.
  const source = [
    titleLine(),
    sessionHeader('old-id'),
    JSON.stringify({ type: 'model_change', id: 'mc', parentId: null, model: 'x' }),
    JSON.stringify({ type: 'thinking_level_change', id: 'tl', parentId: 'mc' }),
    entry('u1', 'tl', 'user', 'first'),
    entry('a1', 'u1', 'assistant', 'one'),
    entry('u2', 'a1', 'user', 'second'),
    entry('a2', 'u2', 'assistant', 'two-a'),
    entry('a2b', 'u2', 'assistant', 'two-b'),
    JSON.stringify({ type: 'custom', id: 'cs', parentId: 'a2b' }),
  ].join('\n').concat('\n');

  const kept = ids(selectOmpForkBranch(body(source), 'cs'));
  assert.deepEqual(kept, ['mc', 'tl', 'u1', 'a1', 'u2', 'a2b', 'cs']);
  assert.ok(!kept.includes('a2'), 'the abandoned sibling must not be copied');
});

// --------------------------------------------------------------- transcript

test('the fork keeps the title slot byte-for-byte and rewrites only the header id', () => {
  const forked = buildOmpForkTranscript(transcript(), { newSessionId: 'new-id', upToAnchorId: 'a1' });
  const lines = forked.split('\n');
  assert.equal(lines[0], titleLine());
  assert.equal(Buffer.byteLength(lines[0]), 255);
  const header = JSON.parse(lines[1]) as Record<string, unknown>;
  assert.equal(header.id, 'new-id');
  assert.equal(header.version, 3);
  assert.equal(header.cwd, '/tmp/proj');
});

test('the fork carries the anchor and drops everything after it', () => {
  const forked = buildOmpForkTranscript(transcript(), { newSessionId: 'new-id', upToAnchorId: 'u2' });
  const lines = forked.trimEnd().split('\n');
  const kept = lines.slice(2).map((line) => (JSON.parse(line) as { id: string }).id);
  assert.deepEqual(kept, ['mc', 'tl', 'u1', 'a1', 'u2']);
  assert.ok(!lines.some((line) => line.includes('"id":"a2b"')));
});

test('forking without an anchor copies the whole active branch', () => {
  const forked = buildOmpForkTranscript(transcript(), { newSessionId: 'new-id' });
  const lines = forked.trimEnd().split('\n');
  const kept = lines.slice(2).map((line) => (JSON.parse(line) as { id: string }).id);
  assert.deepEqual(kept, ['mc', 'tl', 'u1', 'a1', 'u2', 'a2b', 'cs']);
});

test('a transcript with no session header is refused as unreadable', () => {
  assert.throws(
    () => buildOmpForkTranscript(`${titleLine()}\n${entry('u1', null, 'user', 'hi')}\n`, { newSessionId: 'new-id' }),
    (error: Error & { code?: string }) => error.code === 'FORK_SOURCE_UNREADABLE',
  );
});

test('the filename stamp matches OMP\'s own format', () => {
  assert.equal(ompTranscriptStamp(new Date('2026-10-04T08:36:26.427Z')), '2026-10-04T08-36-26-427Z');
});

// ------------------------------------------------------------------ provider

test('the provider writes the fork beside the source under a fresh id', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omp-fork-'));
  try {
    const sourcePath = path.join(directory, '2026-10-04T08-36-00-292Z_aaaaaaaa-0000-0000-0000-000000000000.jsonl');
    await writeFile(sourcePath, transcript(), 'utf8');

    const result = await new OmpForkProvider().forkSession({
      providerSessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
      jsonlPath: sourcePath,
      projectPath: '/tmp/proj',
      upToAnchorId: 'a1',
    });

    assert.equal(path.dirname(result.jsonlPath), directory);
    assert.ok(path.basename(result.jsonlPath).endsWith(`_${result.providerSessionId}.jsonl`));

    const forked = await readFile(result.jsonlPath, 'utf8');
    const lines = forked.trimEnd().split('\n');
    assert.equal((JSON.parse(lines[1]) as { id: string }).id, result.providerSessionId);
    assert.deepEqual(
      lines.slice(2).map((line) => (JSON.parse(line) as { id: string }).id),
      ['mc', 'tl', 'u1', 'a1'],
    );

    // The source is left completely untouched.
    assert.equal(await readFile(sourcePath, 'utf8'), transcript());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the provider finds the source through the sessions root when the row has no path', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omp-root-'));
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = directory;
  try {
    const sessionId = 'bbbbbbbb-0000-0000-0000-000000000000';
    await writeFile(path.join(directory, `2026-10-04T08-36-00-292Z_${sessionId}.jsonl`), transcript(), 'utf8');

    const result = await new OmpForkProvider().forkSession({
      providerSessionId: sessionId,
      jsonlPath: null,
      projectPath: '/tmp/proj',
      upToAnchorId: 'u1',
    });

    assert.equal(path.dirname(result.jsonlPath), directory);
    assert.equal((JSON.parse((await readFile(result.jsonlPath, 'utf8')).split('\n')[1]) as { id: string }).id, result.providerSessionId);
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    } else {
      process.env.PI_CODING_AGENT_SESSION_DIR = previous;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('a missing transcript is reported before anything is written', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omp-missing-'));
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = directory;
  try {
    await assert.rejects(
      () => new OmpForkProvider().forkSession({
        providerSessionId: 'cccccccc-0000-0000-0000-000000000000',
        jsonlPath: null,
        projectPath: '/tmp/proj',
      }),
      (error: Error & { code?: string }) => error.code === 'FORK_SOURCE_NOT_READY',
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    } else {
      process.env.PI_CODING_AGENT_SESSION_DIR = previous;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- anchors

test('history rows are stamped with their entry id as the fork anchor', () => {
  const rows = normalizeOmpAgentMessage(
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'hi' }] },
    'entry-1',
    'session',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.forkAnchorId), ['entry-1', 'entry-1']);
});

// ----------------------------------------------------------- service contract

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omp-fork-db-'));
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

test('a fork lands as an indexed session that keeps the source model and lineage', async () => {
  await withDatabase(async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omp-service-'));
    try {
      const sourcePath = path.join(directory, '2026-10-04T08-36-00-292Z_dddddddd-0000-0000-0000-000000000000.jsonl');
      await writeFile(sourcePath, transcript(), 'utf8');
      const now = new Date().toISOString();
      sessionsDb.createSession(
        'dddddddd-0000-0000-0000-000000000000',
        'omp',
        directory,
        'Original',
        now,
        now,
        sourcePath,
      );

      const result = await sessionsService.forkSessionById(
        'dddddddd-0000-0000-0000-000000000000',
        { upToAnchorId: 'a1' },
      );

      const forked = sessionsDb.getSessionById(result.sessionId);
      assert.ok(forked);
      assert.equal(forked?.provider, 'omp');
      assert.equal(forked?.forked_from_session_id, 'dddddddd-0000-0000-0000-000000000000');
      assert.equal(forked?.custom_name, 'Original (fork)');
      assert.ok(forked?.jsonl_path?.endsWith(`_${forked.provider_session_id}.jsonl`));
      assert.equal(
        (JSON.parse((await readFile(forked?.jsonl_path as string, 'utf8')).split('\n')[1]) as { id: string }).id,
        forked?.provider_session_id,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test('OMP advertises session forking', () => {
  assert.equal(providerCapabilitiesService.getProviderCapabilities('omp').supportsSessionForking, true);
});
