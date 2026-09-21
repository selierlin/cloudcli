import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { resetOmpModelsForTests } from '@/modules/providers/list/omp/omp-models.provider.js';
import { OmpSessionsProvider, resolveOmpTranscriptPath } from '@/modules/providers/list/omp/omp-sessions.provider.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** OMP session uuid + the timestamp prefix OMP itself wrote (see the fixtures). */
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
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'omp-sessions-test-'));
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

/** Mirrors OMP's directory encoding: strip the leading slash, `/:\` → `-`. */
function encodeOmpCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** Copies a real OMP transcript into the isolated sessions root with the test cwd. */
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

/** Writes one synthetic OMP JSONL transcript with an optional leading title line. */
async function writeTranscript(
  sessionsRoot: string,
  cwd: string,
  uuid: string,
  entries: unknown[],
  title?: string,
): Promise<string> {
  const dir = path.join(sessionsRoot, encodeOmpCwd(cwd));
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `2026-09-21T00-00-00-000Z_${uuid}.jsonl`);
  // OMP rewrites a `title` line in place as the file's first line.
  const lines = (title === undefined
    ? entries
    : [{ type: 'title', v: 1, title, updatedAt: '2026-09-21T00:00:00.000Z', pad: '  ' }, ...entries]
  ).map((entry) => JSON.stringify(entry));
  await writeFile(filePath, `${lines.join('\n')}\n`);
  return filePath;
}

const header = (uuid: string, cwd: string) => ({
  type: 'session',
  version: 3,
  id: uuid,
  timestamp: '2026-09-21T00:00:00.000Z',
  cwd,
});

const text = (value: string) => ({ type: 'text', text: value });
const thinking = (value: string) => ({ type: 'thinking', thinking: value, thinkingSignature: 'reasoning_content' });
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
});

function messageEntry(
  id: string,
  parentId: string | null,
  message: Record<string, unknown>,
  timestamp = '2026-09-21T00:00:01.000Z',
): Record<string, unknown> {
  return {
    type: 'message',
    id,
    parentId,
    timestamp,
    message: {
      timestamp: 1789990948474,
      ...message,
    },
  };
}

function userMessage(id: string, parentId: string | null, content: unknown): Record<string, unknown> {
  return messageEntry(id, parentId, { role: 'user', content });
}

function assistantMessage(
  id: string,
  parentId: string | null,
  content: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return messageEntry(id, parentId, {
    role: 'assistant',
    api: 'openai-completions',
    provider: 'ark',
    model: 'deepseek-v4-flash',
    stopReason: 'stop',
    ...extra,
    content,
  });
}

function toolResultMessage(
  id: string,
  parentId: string | null,
  toolCallId: string,
  content: unknown,
  isError = false,
): Record<string, unknown> {
  return messageEntry(id, parentId, {
    role: 'toolResult',
    toolCallId,
    toolName: 'bash',
    content,
    isError,
  });
}

test('normalizeMessage maps assistant blocks to thinking/text/tool_use rows', () => {
  const provider = new OmpSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'message_end',
    id: 'a1b2c3d4',
    timestamp: '2026-09-21T00:00:02.000Z',
    message: {
      role: 'assistant',
      content: [
        thinking('Let me check'),
        text('Here is the answer'),
        toolCall('call_1', 'read', { path: '/tmp/x' }),
      ],
      stopReason: 'toolUse',
    },
  }, 'session-1');

  assert.deepEqual(messages.map((message) => message.kind), ['thinking', 'text', 'tool_use']);
  assert.equal(messages[0].content, 'Let me check');
  assert.equal(messages[1].content, 'Here is the answer');
  assert.equal(messages[2].toolName, 'read');
  assert.equal(messages[2].toolId, 'call_1');
  assert.deepEqual(messages[2].toolInput, { path: '/tmp/x' });
  // Ids are stable from the entry id.
  assert.equal(messages[0].id, 'omp-a1b2c3d4');
  assert.equal(messages[1].id, 'omp-a1b2c3d4-1');
  assert.equal(messages[2].id, 'omp-a1b2c3d4-2');
});

test('normalizeMessage maps toolResult into a tool_result row', () => {
  const provider = new OmpSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'message',
    id: 'd4e5f6g7',
    timestamp: '2026-09-21T00:00:03.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'read',
      content: [text('/tmp/x')],
      isError: false,
    },
  }, 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].toolId, 'call_1');
  assert.equal(messages[0].content, '/tmp/x');
  assert.equal(messages[0].isError, false);
});

test('normalizeMessage turns a terminal error into a redacted error row', () => {
  const provider = new OmpSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'message_end',
    id: 'e5f6g7h8',
    timestamp: '2026-09-21T00:00:04.000Z',
    message: {
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: 'API error 401, api key: sk-12345 invalid',
    },
  }, 'session-1');

  const error = messages.find((message) => message.kind === 'error');
  assert.ok(error && typeof error.content === 'string');
  assert.ok(!error.content.includes('sk-12345'));
  assert.ok(error.content.includes('[REDACTED]'));
});

test('normalizeMessage maps user images into inline data URLs', () => {
  const provider = new OmpSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'message',
    id: 'f6g7h8i9',
    timestamp: '2026-09-21T00:00:05.000Z',
    message: {
      role: 'user',
      content: [
        text('Here is the screenshot'),
        { type: 'image', data: 'AAAA', mimeType: 'image/webp' },
      ],
    },
  }, 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'Here is the screenshot');
  assert.deepEqual(messages[0].images, [{ data: 'data:image/webp;base64,AAAA' }]);
});

// OMP degrades unreadable attachments into a `display:false` custom frame; it
// carries model-facing noise rather than a user turn.
test('normalizeMessage drops a display:false custom frame', () => {
  const provider = new OmpSessionsProvider();
  const messages = provider.normalizeMessage({
    type: 'message_end',
    message: {
      role: 'custom',
      customType: 'image-attachment-description',
      display: false,
      content: [text('<image>The image is a flat white field.</image>')],
    },
  }, 'session-1');

  assert.deepEqual(messages, []);
});

test('normalizeMessage emits stream_delta frames for message_update only', () => {
  const provider = new OmpSessionsProvider();
  const delta = (assistantMessageEvent: Record<string, unknown>) => provider.normalizeMessage(
    { type: 'message_update', assistantMessageEvent },
    'session-1',
  );

  assert.deepEqual(
    delta({ type: 'text_delta', contentIndex: 1, delta: 'hello' }).map((message) => [message.kind, message.streamChannel, message.content]),
    [['stream_delta', 'text', 'hello']],
  );
  assert.deepEqual(
    delta({ type: 'thinking_delta', contentIndex: 0, delta: 'hmm' }).map((message) => [message.kind, message.streamChannel, message.content]),
    [['stream_delta', 'thinking', 'hmm']],
  );
  // Framing events inside the same envelope carry no text of their own.
  assert.deepEqual(delta({ type: 'text_start', contentIndex: 1 }), []);
  assert.deepEqual(delta({ type: 'text_end', contentIndex: 1, content: 'hello' }), []);
});

test('fetchHistory reads a real OMP transcript whose first line is a title', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const filePath = await writeOmpFixture(sessionsRoot, cwd, TITLED);
    sessionsDb.createAppSession('app-1', 'omp', cwd, 'OMP session');
    sessionsDb.assignProviderSessionId('app-1', TITLED.uuid);

    const result = await new OmpSessionsProvider().fetchHistory('app-1');

    // The title line and the custom/custom_message rows contribute no rows, but
    // the branch walk still reaches every real entry underneath them.
    assert.equal(result.total, 6);
    assert.equal(result.hasMore, false);
    assert.deepEqual(result.messages.map((message) => message.kind), [
      'text', 'thinking', 'tool_use', 'tool_result', 'thinking', 'text',
    ]);
    assert.deepEqual(result.messages.map((message) => message.role), [
      'user', 'assistant', 'assistant', 'user', 'assistant', 'assistant',
    ]);
    assert.equal(result.messages[0].content, 'Inspect the attached files.');
    assert.equal(result.messages[1].content, "I'll list the directory first.");
    assert.equal(result.messages[2].toolName, 'read');
    assert.deepEqual(result.messages[2].toolInput, { path: '/tmp/omp-att', i: 'Listing the directory' });
    assert.equal(result.messages[3].toolId, 'call_read_1');
    assert.equal(result.messages[3].content, '- note.txt  13B\n- dot.png   70B');
    assert.equal(result.messages[5].content, 'I can see note.txt and dot.png.');

    // Token usage comes from the newest assistant turn on the active path.
    assert.deepEqual(result.tokenUsage, {
      used: 240,
      total: 260,
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
      cacheTokens: 20,
      breakdown: { input: 220, output: 40 },
    });

    assert.equal(filePath, path.join(sessionsRoot, encodeOmpCwd(cwd), TITLED.file));
  });
});

test('fetchHistory pages the tail when limit/offset are supplied', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    await writeOmpFixture(sessionsRoot, cwd, TITLED);
    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Paged');
    sessionsDb.assignProviderSessionId('app-1', TITLED.uuid);

    const provider = new OmpSessionsProvider();
    const firstPage = await provider.fetchHistory('app-1', { limit: 2, offset: 0 });
    assert.deepEqual(firstPage.messages.map((message) => message.content), [
      'Both files are present.',
      'I can see note.txt and dot.png.',
    ]);
    assert.equal(firstPage.total, 6);
    assert.equal(firstPage.hasMore, true);

    const secondPage = await provider.fetchHistory('app-1', { limit: 2, offset: 2 });
    assert.deepEqual(secondPage.messages.map((message) => message.kind), ['tool_use', 'tool_result']);
    assert.equal(secondPage.messages[1].content, '- note.txt  13B\n- dot.png   70B');
    assert.equal(secondPage.hasMore, true);

    const oldestPage = await provider.fetchHistory('app-1', { limit: 2, offset: 4 });
    assert.deepEqual(oldestPage.messages.map((message) => message.content), [
      'Inspect the attached files.',
      "I'll list the directory first.",
    ]);
    assert.equal(oldestPage.hasMore, false);

    const emptyPage = await provider.fetchHistory('app-1', { limit: 0 });
    assert.deepEqual(emptyPage.messages, []);
    assert.equal(emptyPage.hasMore, true);

    const fullHistory = await provider.fetchHistory('app-1');
    assert.equal(fullHistory.messages.length, 6);
  });
});

test('fetchHistory returns empty history when no transcript exists', async () => {
  await withIsolatedEnvironment(async ({ cwd }) => {
    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Empty');
    sessionsDb.assignProviderSessionId('app-1', 'missing');
    const result = await new OmpSessionsProvider().fetchHistory('app-1');
    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  });
});

test('fetchHistory walks only the active branch, skipping abandoned ones', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000001';
    await writeTranscript(sessionsRoot, cwd, uuid, [
      header(uuid, cwd),
      // Main branch.
      userMessage('a1', null, 'Root prompt'),
      assistantMessage('a2', 'a1', [text('Main answer')]),
      // Branch point: abandoned branch continues from a1.
      userMessage('b1', 'a1', 'Abandoned prompt'),
      assistantMessage('b2', 'b1', [text('Abandoned answer')]),
      // Active leaf continues the main branch from a2.
      userMessage('a3', 'a2', 'Continued prompt'),
      assistantMessage('a4', 'a3', [text('Active answer')]),
    ], 'Branch walk');

    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Branch');
    sessionsDb.assignProviderSessionId('app-1', uuid);

    const result = await new OmpSessionsProvider().fetchHistory('app-1');
    assert.deepEqual(
      result.messages.map((message) => message.content),
      ['Root prompt', 'Main answer', 'Continued prompt', 'Active answer'],
    );
  });
});

test('fetchHistory honors compaction via firstKeptEntryId', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000002';
    await writeTranscript(sessionsRoot, cwd, uuid, [
      header(uuid, cwd),
      userMessage('a1', null, 'Old 1'),
      assistantMessage('a2', 'a1', [text('Old 2')]),
      userMessage('a3', 'a2', 'Old 3'),
      {
        type: 'compaction',
        id: 'c1',
        parentId: 'a3',
        timestamp: '2026-09-21T01:00:00.000Z',
        summary: 'Earlier turns were summarized.',
        firstKeptEntryId: 'a3',
        tokensBefore: 50000,
      },
      userMessage('a4', 'c1', 'Kept after compaction'),
      assistantMessage('a5', 'a4', [text('Answer')]),
    ], 'Compacted');

    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Compacted');
    sessionsDb.assignProviderSessionId('app-1', uuid);

    const result = await new OmpSessionsProvider().fetchHistory('app-1');
    // a1/a2 dropped (before firstKeptEntryId), summary first, a3 kept, then tail.
    assert.deepEqual(result.messages.map((message) => message.content), [
      'Earlier turns were summarized.',
      'Old 3',
      'Kept after compaction',
      'Answer',
    ]);
    assert.equal(result.messages[0].isCompactSummary, true);
  });
});

test('fetchHistory honors compaction via retainedTail (defensive compat)', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000003';
    await writeTranscript(sessionsRoot, cwd, uuid, [
      header(uuid, cwd),
      userMessage('a1', null, 'Old 1'),
      assistantMessage('a2', 'a1', [text('Old 2')]),
      {
        type: 'compaction',
        id: 'c1',
        parentId: 'a2',
        timestamp: '2026-09-21T01:00:00.000Z',
        summary: 'Everything was compacted.',
        retainedTail: [
          { role: 'user', content: 'Checkpoint prompt' },
          { role: 'assistant', content: [text('Checkpoint answer')] },
        ],
      },
      userMessage('a3', 'c1', 'After checkpoint'),
    ], 'Compacted tail');

    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Compacted tail');
    sessionsDb.assignProviderSessionId('app-1', uuid);

    const result = await new OmpSessionsProvider().fetchHistory('app-1');
    assert.deepEqual(result.messages.map((message) => message.content), [
      'Everything was compacted.',
      'Checkpoint prompt',
      'Checkpoint answer',
      'After checkpoint',
    ]);
  });
});

test('fetchHistory tolerates malformed transcript lines next to a title', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000004';
    const dir = path.join(sessionsRoot, encodeOmpCwd(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `2026-09-21T00-00-00-000Z_${uuid}.jsonl`),
      `${JSON.stringify({ type: 'title', v: 1, title: 'Odd', pad: ' ' })}\n${JSON.stringify(header(uuid, cwd))}\nnot-json\n${JSON.stringify(userMessage('a1', null, 'ok'))}\n`,    );

    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Malformed');
    sessionsDb.assignProviderSessionId('app-1', uuid);

    const result = await new OmpSessionsProvider().fetchHistory('app-1');
    assert.equal(result.total, 1);
    assert.equal(result.messages[0].content, 'ok');
  });
});

// OMP stores a transcript opened from `/tmp/...` under `--private-tmp-...--`,
// which the encoded directory for the logical cwd cannot reproduce.
test('resolveOmpTranscriptPath finds a transcript in an unexpected directory', async () => {
  await withIsolatedEnvironment(async ({ sessionsRoot, cwd }) => {
    const uuid = '01a0c3c6-0000-7000-8000-000000000005';
    const oddDir = path.join(sessionsRoot, '--private-tmp-omp-odd--');
    await mkdir(oddDir, { recursive: true });
    const filePath = path.join(oddDir, `2026-09-21T00-00-00-000Z_${uuid}.jsonl`);
    await writeFile(filePath, `${JSON.stringify(header(uuid, '/private/tmp/omp-odd'))}\n`);

    sessionsDb.createAppSession('app-1', 'omp', cwd, 'Odd');
    sessionsDb.assignProviderSessionId('app-1', uuid);

    const result = await new OmpSessionsProvider().fetchHistory('app-1');
    // No message entries, but the transcript was located rather than treated as
    // missing: the header alone yields zero rows either way, so assert on the
    // resolver directly.
    assert.equal(result.total, 0);
    assert.equal(await resolveOmpTranscriptPath(uuid, cwd), filePath);
  });
});
