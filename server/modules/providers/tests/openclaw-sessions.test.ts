import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import zlib from 'node:zlib';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { setOpenclawHomeDirForTests } from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import {
  OpenclawSessionsProvider,
  decodeOpenclawTranscriptEvent,
  isOpenclawSyntheticUserPrompt,
  normalizeOpenclawAgentMessage,
  readOpenclawUserText,
  stripOpenclawInboundMetadata,
} from '@/modules/providers/list/openclaw/openclaw-sessions.provider.js';

import {
  openclawHeaderEntry,
  openclawMessageEntry,
  seedOpenclawSession,
} from './fixtures/openclaw-agent-db.js';

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) {
    const run = cleanup;
    cleanup = null;
    await run();
  }
});

/**
 * Isolates the app database and OpenClaw's state root, and registers the app
 * session the reader resolves the provider session id through.
 */
async function withIsolatedEnvironment(
  runTest: (env: { homeDir: string; cwd: string }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'openclaw-sessions-'));
  const databasePath = path.join(tempRoot, 'auth.db');
  const cwd = path.join(tempRoot, 'workspace', 'my-project');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  setOpenclawHomeDirForTests(tempRoot);
  await initializeDatabase();

  cleanup = async () => {
    closeConnection();
    setOpenclawHomeDirForTests(null);
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempRoot, { recursive: true, force: true });
  };

  await runTest({ homeDir: tempRoot, cwd });
}

const user = (id: string, content: unknown) => openclawMessageEntry(id, { role: 'user', content });

const assistant = (id: string, content: unknown, extra: Record<string, unknown> = {}) =>
  openclawMessageEntry(id, { role: 'assistant', model: 'ark/deepseek-v4-flash', content, ...extra });

const toolResult = (id: string, toolCallId: string, content: unknown, isError = false) =>
  openclawMessageEntry(id, {
    role: 'toolResult',
    toolCallId,
    toolName: 'read',
    content,
    isError,
  });

// ─── inbound-context stripping (faithful port of strip-inbound-meta) ─────────

test('stripOpenclawInboundMetadata drops a channel header block and a leading timestamp', () => {
  const raw = [
    'Sender: ⟦openclaw:ctx⟧',
    '```json',
    '{"channel":"dingtalk","sender":"Alice"}',
    '```',
    '',
    '[Fri 2026-04-24 05:01 UTC] Please review the diff.',
  ].join('\n');

  assert.equal(stripOpenclawInboundMetadata(raw), 'Please review the diff.');
});

test('stripOpenclawInboundMetadata removes a leading timestamp on its own', () => {
  assert.equal(
    stripOpenclawInboundMetadata('[Fri 2026-04-24 05:01 UTC] Just a plain question'),
    'Just a plain question',
  );
});

test('stripOpenclawInboundMetadata removes a leading ACP working-directory prefix', () => {
  assert.equal(
    stripOpenclawInboundMetadata('[Working directory: ~/Projects/cloudcli]\n\nPlease review the diff.'),
    'Please review the diff.',
  );
  // With a timestamp behind it, both leading lines go.
  assert.equal(
    stripOpenclawInboundMetadata('[Working directory: ~/Projects/cloudcli]\n\n[Fri 2026-04-24 05:01 UTC] Hi'),
    'Hi',
  );
});

test('stripOpenclawInboundMetadata leaves a working-directory mention mid-message intact', () => {
  const raw = 'Compare these two:\n\n[Working directory: /tmp/a]\n[Working directory: /tmp/b]';
  assert.equal(stripOpenclawInboundMetadata(raw), raw);
});

test('stripOpenclawInboundMetadata removes a trailing channel-context block', () => {
  const raw = [
    'What changed?',
    '',
    'Context: ⟦openclaw:ctx⟧',
    '{"channel":"telegram"}',
  ].join('\n');

  assert.equal(stripOpenclawInboundMetadata(raw), 'What changed?');
});

test('stripOpenclawInboundMetadata removes an active-memory block', () => {
  const raw = [
    'Context:',
    '<active_memory_plugin>',
    'remembered facts',
    '</active_memory_plugin>',
    '',
    'Real user request',
  ].join('\n');

  assert.equal(stripOpenclawInboundMetadata(raw), 'Real user request');
});

test('readOpenclawUserText returns null for pure injection and synthetic prompts', () => {
  assert.equal(readOpenclawUserText('Sender: ⟦openclaw:ctx⟧\n```json\n{}\n```\n'), null);
  assert.equal(readOpenclawUserText('A new session was started via /new or /reset. Execute your Session Startup sequence now.'), null);
  assert.equal(readOpenclawUserText('[cron:job-1 Nightly] do the thing'), null);
  assert.equal(readOpenclawUserText('What is the status?'), 'What is the status?');
});

test('isOpenclawSyntheticUserPrompt recognises the startup and cron prefixes', () => {
  assert.equal(isOpenclawSyntheticUserPrompt('A new session was started via /new or /reset.'), true);
  assert.equal(isOpenclawSyntheticUserPrompt('[cron:abc Job] tick'), true);
  assert.equal(isOpenclawSyntheticUserPrompt('hello'), false);
});

// ─── entry decoding ─────────────────────────────────────────────────────────

test('decodeOpenclawTranscriptEvent reads plain and zstd-compressed rows', () => {
  const entry = { type: 'message', id: 'a1', message: { role: 'user', content: 'hi' } };

  assert.deepEqual(
    decodeOpenclawTranscriptEvent({ event_json: JSON.stringify(entry), event_zstd: null }),
    entry,
  );
  assert.deepEqual(
    decodeOpenclawTranscriptEvent({
      event_json: null,
      event_zstd: zlib.zstdCompressSync(Buffer.from(JSON.stringify(entry))),
    }),
    entry,
  );
  // A corrupt payload is skipped rather than thrown.
  assert.equal(decodeOpenclawTranscriptEvent({ event_json: '{not json', event_zstd: null }), null);
  assert.equal(decodeOpenclawTranscriptEvent({ event_json: null, event_zstd: Buffer.from('nope') }), null);
});

// ─── entry normalization (Pi lineage) ───────────────────────────────────────

test('normalizeOpenclawAgentMessage maps an assistant turn to thinking/text/tool_use rows', () => {
  const messages = normalizeOpenclawAgentMessage({
    role: 'assistant',
    model: 'ark/deepseek-v4-flash',
    content: [
      { type: 'thinking', thinking: 'Let me look' },
      { type: 'text', text: 'Here is the answer' },
      { type: 'toolCall', id: 'call_1', name: 'read', arguments: { path: '/tmp/x' } },
    ],
  }, 'a1', 'session-1');

  assert.deepEqual(messages.map((message) => message.kind), ['thinking', 'text', 'tool_use']);
  assert.equal(messages[0].content, 'Let me look');
  assert.equal(messages[1].content, 'Here is the answer');
  // Only the prose row carries the answering model; thinking has no footer.
  assert.equal(messages[0].model, undefined);
  assert.equal(messages[1].model, 'ark/deepseek-v4-flash');
  assert.equal(messages[2].toolName, 'read');
  assert.equal(messages[2].toolId, 'call_1');
  assert.deepEqual(messages[2].toolInput, { path: '/tmp/x' });
  assert.equal(messages[0].id, 'openclaw-a1');
  assert.equal(messages[1].id, 'openclaw-a1-1');
  assert.equal(messages[2].id, 'openclaw-a1-2');
});

test('normalizeOpenclawAgentMessage maps a toolResult into a tool_result row', () => {
  const messages = normalizeOpenclawAgentMessage({
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'read',
    content: [{ type: 'text', text: 'file body' }],
    isError: false,
  }, 't1', 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].toolId, 'call_1');
  assert.equal(messages[0].content, 'file body');
  assert.equal(messages[0].isError, false);
});

test('normalizeOpenclawAgentMessage strips injected context from a user row', () => {
  const messages = normalizeOpenclawAgentMessage({
    role: 'user',
    content: 'Sender: ⟦openclaw:ctx⟧\n```json\n{}\n```\n\n[Fri 2026-04-24 05:01 UTC] Genuine question',
  }, 'u1', 'session-1');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'Genuine question');
});

test('normalizeOpenclawAgentMessage emits nothing for a pure-injection user row', () => {
  const messages = normalizeOpenclawAgentMessage({
    role: 'user',
    content: 'A new session was started via /new or /reset.',
  }, 'u2', 'session-1');

  assert.deepEqual(messages, []);
});

test('normalizeOpenclawAgentMessage turns a terminal error into an error row', () => {
  const messages = normalizeOpenclawAgentMessage({
    role: 'assistant',
    content: [],
    stopReason: 'error',
    errorMessage: 'API error 401',
  }, 'e1', 'session-1');

  const error = messages.find((message) => message.kind === 'error');
  assert.ok(error && typeof error.content === 'string');
  assert.equal(error.content, 'API error 401');
});

// ─── history reading from the SQLite store ──────────────────────────────────

test('fetchHistory reads the active branch and strips injected user context', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      displayName: 'Indexed title',
      createdAt: 1_776_000_000_000,
      updatedAt: 1_776_000_010_000,
      lastInteractionAt: 1_776_000_010_000,
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', `Sender: ⟦openclaw:ctx⟧\n\`\`\`json\n{}\n\`\`\`\n\n[Fri 2026-04-24 05:01 UTC] Inspect the files.`) },
        {
          json: assistant('a1', [
            { type: 'thinking', thinking: 'First I list the directory.' },
            { type: 'text', text: 'Listing now.' },
            { type: 'toolCall', id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
          ]),
        },
        { json: toolResult('t1', 'call_1', [{ type: 'text', text: 'note.txt' }]) },
        { json: assistant('a2', [{ type: 'text', text: 'All done.' }], { usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 200 } }) },
      ],
    });

    sessionsDb.createAppSession('app-1', 'openclaw', cwd, 'OpenClaw session');
    sessionsDb.assignProviderSessionId('app-1', sessionKey);

    const result = await new OpenclawSessionsProvider()
      .fetchHistory('app-1', { providerSessionId: sessionKey });

    assert.equal(result.total, 6);
    assert.equal(result.hasMore, false);
    assert.deepEqual(result.messages.map((message) => message.kind), [
      'text', 'thinking', 'text', 'tool_use', 'tool_result', 'text',
    ]);
    assert.equal(result.messages[0].content, 'Inspect the files.');
    assert.equal(result.messages[1].content, 'First I list the directory.');
    assert.equal(result.messages[3].toolName, 'bash');
    assert.deepEqual(result.messages[3].toolInput, { command: 'ls' });
    assert.equal(result.messages[4].content, 'note.txt');
    assert.equal(result.messages[5].content, 'All done.');
    assert.equal(result.messages[5].model, 'ark/deepseek-v4-flash');

    // Token usage comes from the newest assistant turn on the active path.
    assert.deepEqual(result.tokenUsage, {
      used: 120,
      total: 200,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      cacheTokens: 15,
      breakdown: { input: 115, output: 20 },
    });
  });
});

test('fetchHistory pages the tail when limit/offset are supplied', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'One') },
        { json: assistant('a1', [{ type: 'text', text: 'Answer one' }]) },
        { json: user('u2', 'Two') },
        { json: assistant('a2', [{ type: 'text', text: 'Answer two' }]) },
      ],
    });

    const provider = new OpenclawSessionsProvider();
    const page = await provider.fetchHistory(sessionKey, { limit: 2, offset: 0 });
    assert.deepEqual(page.messages.map((message) => message.content), ['Two', 'Answer two']);
    assert.equal(page.total, 4);
    assert.equal(page.hasMore, true);

    const oldest = await provider.fetchHistory(sessionKey, { limit: 2, offset: 2 });
    assert.deepEqual(oldest.messages.map((message) => message.content), ['One', 'Answer one']);
    assert.equal(oldest.hasMore, false);
  });
});

test('fetchHistory decodes zstd-compressed events and skips seq gaps', async () => {
  await withIsolatedEnvironment(async ({ homeDir, cwd }) => {
    const sessionKey = 'agent:main:main';
    await seedOpenclawSession(homeDir, {
      sessionKey,
      windowId: 'window-1',
      events: [
        { json: openclawHeaderEntry(cwd) },
        { json: user('u1', 'Compressed prompt'), compressed: true },
        null,
        { json: assistant('a1', [{ type: 'text', text: 'Reached after the gap' }]) },
      ],
      // Active path skips the missing seq 2.
      activeSeq: [0, 1, 3],
    });

    const result = await new OpenclawSessionsProvider().fetchHistory(sessionKey);
    assert.deepEqual(result.messages.map((message) => message.content), [
      'Compressed prompt',
      'Reached after the gap',
    ]);
  });
});

test('fetchHistory is empty when the agent store does not exist', async () => {
  await withIsolatedEnvironment(async ({ cwd }) => {
    sessionsDb.createAppSession('app-1', 'openclaw', cwd, 'Missing store');
    sessionsDb.assignProviderSessionId('app-1', 'agent:main:main');
    const result = await new OpenclawSessionsProvider().fetchHistory('app-1', { providerSessionId: 'agent:main:main' });
    assert.equal(result.total, 0);
    assert.deepEqual(result.messages, []);
  });
});

test('normalizeMessage ignores history entry shapes that are not ACP live events', () => {
  assert.deepEqual(new OpenclawSessionsProvider().normalizeMessage({ type: 'message' }, 'session-1'), []);
});
