import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { PiSessionSynchronizer } from '@/modules/providers/list/pi/pi-session-synchronizer.provider.js';
import { PiSessionsProvider } from '@/modules/providers/list/pi/pi-sessions.provider.js';

/**
 * Pi has no resume-at-an-entry flag, so an edit copies the conversation prefix
 * that precedes the replaced prompt and moves the session onto the copy. These
 * cover both halves: that a user prompt is addressable and resolves to the
 * entry before it, and that the rewind leaves the pre-edit transcript behind
 * without the indexer handing it back.
 */

async function withIsolatedEnvironment(
  runTest: (env: { sessionsRoot: string; cwd: string }) => void | Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSessionsRoot = process.env.PI_CODING_AGENT_SESSION_DIR;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'pi-edit-test-'));
  const databasePath = path.join(tempDirectory, 'auth.db');
  const sessionsRoot = path.join(tempDirectory, 'sessions');
  const cwd = path.join(tempDirectory, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  process.env.PI_CODING_AGENT_SESSION_DIR = sessionsRoot;
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
      delete process.env.PI_CODING_AGENT_SESSION_DIR;
    } else {
      process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionsRoot;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Mirrors Pi's directory encoding: strip the leading slash, `/:\` → `-`. */
function encodePiCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** Writes one Pi JSONL transcript file with the given entries (header + tree). */
async function writeTranscript(
  sessionsRoot: string,
  cwd: string,
  uuid: string,
  entries: unknown[],
): Promise<string> {
  const dir = path.join(sessionsRoot, encodePiCwd(cwd));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `2026-09-09T00-00-00-000Z_${uuid}.jsonl`);
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return filePath;
}

const header = (uuid: string, cwd: string) => ({
  type: 'session',
  version: 3,
  id: uuid,
  timestamp: '2026-09-09T08:00:00.000Z',
  cwd,
});

const text = (value: string) => ({ type: 'text', text: value });

const changeEntry = (id: string, parentId: string | null) => ({
  type: 'model_change',
  id,
  parentId,
  modelId: 'deepseek-v4-flash',
  provider: 'ark',
  timestamp: '2026-09-09T08:00:00.500Z',
});

function messageEntry(id: string, parentId: string | null, message: Record<string, unknown>) {
  return { type: 'message', id, parentId, timestamp: '2026-09-09T08:00:01.000Z', message };
}

const userMessage = (id: string, parentId: string | null, content: string) =>
  messageEntry(id, parentId, { role: 'user', content });

const assistantMessage = (id: string, parentId: string | null, content: string) =>
  messageEntry(id, parentId, { role: 'assistant', model: 'deepseek-v4-flash', stopReason: 'stop', content: [text(content)] });

const THREE_EXCHANGES = [
  changeEntry('mc', null),
  userMessage('u1', 'mc', 'first prompt'),
  assistantMessage('a1', 'u1', 'answer one'),
  userMessage('u2', 'a1', 'second prompt'),
  assistantMessage('a2', 'u2', 'answer two'),
  userMessage('u3', 'a2', 'third prompt'),
  assistantMessage('a3', 'u3', 'answer three'),
];

function indexSession(appId: string, uuid: string, cwd: string): void {
  sessionsDb.createAppSession(appId, 'pi', cwd, 'Pi session');
  sessionsDb.assignProviderSessionId(appId, uuid);
}

const UUID = '01a0854d-c915-701f-b114-06ddbce5b14f';

test('every Pi prompt is anchored, and only prompts are editable', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeTranscript(sessionsRoot, cwd, UUID, [header(UUID, cwd), ...THREE_EXCHANGES]);
    indexSession('app-1', UUID, cwd);

    const history = await new PiSessionsProvider().fetchHistory('app-1');
    const prompts = history.messages.filter((message) => message.role === 'user' && message.kind === 'text');

    assert.deepEqual(
      prompts.map((message) => [message.content, message.transcriptAnchorId, message.forkAnchorId]),
      [
        ['first prompt', 'u1', 'u1'],
        ['second prompt', 'u2', 'u2'],
        ['third prompt', 'u3', 'u3'],
      ],
    );
    // An answer is forkable but not editable, so it carries no edit anchor.
    assert.equal(
      history.messages.some((message) => message.role !== 'user' && message.transcriptAnchorId),
      false,
    );
    assert.equal(history.messages.find((message) => message.content === 'answer one')?.forkAnchorId, 'a1');
  });
});

test('the edit anchor resolves to the entry before the one being replaced', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeTranscript(sessionsRoot, cwd, UUID, [header(UUID, cwd), ...THREE_EXCHANGES]);
    indexSession('app-1', UUID, cwd);
    const provider = new PiSessionsProvider();

    assert.deepEqual(
      await provider.resolveEditAnchor('app-1', 'u3'),
      { found: true, resumeThroughId: 'a2' },
    );
    // Nothing precedes the first prompt, so the conversation starts over.
    assert.deepEqual(
      await provider.resolveEditAnchor('app-1', 'u1'),
      { found: true, resumeThroughId: null },
    );
    assert.deepEqual(
      await provider.resolveEditAnchor('app-1', 'gone'),
      { found: false, resumeThroughId: null },
    );
    // An answer is not a prompt and cannot be edited.
    assert.deepEqual(
      await provider.resolveEditAnchor('app-1', 'a2'),
      { found: false, resumeThroughId: null },
    );
  });
});

test('rewinding copies the prefix and moves the session onto it', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const sourcePath = await writeTranscript(sessionsRoot, cwd, UUID, [header(UUID, cwd), ...THREE_EXCHANGES]);
    indexSession('app-1', UUID, cwd);

    await new PiSessionsProvider().rewindSession('app-1', 'a2');

    const session = sessionsDb.getSessionById('app-1');
    const forkedPath = session?.jsonl_path as string;
    assert.ok(session?.provider_session_id);
    assert.notEqual(session?.provider_session_id, UUID);
    assert.ok(forkedPath.endsWith(`_${session?.provider_session_id}.jsonl`));

    const copy = await readFile(forkedPath, 'utf8');
    const lines = copy.trimEnd().split('\n');
    assert.equal((JSON.parse(lines[0]) as { id: string }).id, session?.provider_session_id);
    assert.deepEqual(
      lines.slice(1).map((line) => (JSON.parse(line) as { id: string }).id),
      ['mc', 'u1', 'a1', 'u2', 'a2'],
    );

    // The pre-edit transcript stays on disk on purpose, and is retired so the
    // indexer will not offer it back.
    assert.equal(existsSync(sourcePath), true);
    assert.equal(sessionsDb.isProviderSessionSuperseded(UUID, 'pi'), true);
  });
});

test('editing the first prompt starts the conversation over', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeTranscript(sessionsRoot, cwd, UUID, [header(UUID, cwd), ...THREE_EXCHANGES]);
    indexSession('app-1', UUID, cwd);

    await new PiSessionsProvider().rewindSession('app-1', null);

    const session = sessionsDb.getSessionById('app-1');
    assert.equal(session?.provider_session_id, null);
    assert.equal(session?.jsonl_path, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded(UUID, 'pi'), true);
  });
});

test('the indexer does not hand back a transcript a session was edited off', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeTranscript(sessionsRoot, cwd, UUID, [header(UUID, cwd), ...THREE_EXCHANGES]);
    indexSession('app-1', UUID, cwd);

    await new PiSessionsProvider().rewindSession('app-1', 'a2');
    const repointed = sessionsDb.getSessionById('app-1');

    // The pre-edit file is still on disk, so a full rescan finds it again.
    // For a session discovered from disk this would resurrect the conversation
    // the edit replaced; here it must simply be ignored.
    await new PiSessionSynchronizer().synchronize();

    const after = sessionsDb.getSessionById('app-1');
    assert.equal(after?.provider_session_id, repointed?.provider_session_id);
    assert.equal(after?.jsonl_path, repointed?.jsonl_path);
    assert.ok(!sessionsDb.getSessionByProviderSessionId(UUID), 'the retired transcript must not be re-indexed');
  });
});
