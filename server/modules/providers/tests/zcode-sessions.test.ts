import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { ZcodeSessionsProvider } from '@/modules/providers/list/zcode/zcode-sessions.provider.js';
import { appendImagesInputTag } from '@/shared/image-attachments.js';

import { seedZcodeRichSession } from './fixtures/zcode-session-db.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

test('ZCode sessions provider reads sqlite history and aggregates token usage', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await seedZcodeRichSession(tempRoot, workspacePath);
    const provider = new ZcodeSessionsProvider();
    const history = await provider.fetchHistory('zcode-session-1');

    assert.equal(history.total, 5);
    assert.equal(history.messages[0]?.kind, 'text');
    assert.equal(history.messages[0]?.role, 'user');
    assert.equal(history.messages[0]?.content, 'Build the ZCode integration.');
    // The user row records the picker's selection, but the footer names only
    // the model that answered, so nothing is stamped on a user turn.
    assert.equal(history.messages[0]?.model, undefined);
    assert.equal(history.messages[1]?.kind, 'thinking');
    // The assistant row names the model ZCode recorded for the reply.
    assert.equal(history.messages[2]?.model, 'deepseek-v4-flash');
    assert.equal(history.messages[2]?.content, 'The provider is wired.');
    assert.equal(history.messages[3]?.kind, 'tool_use');
    assert.equal(history.messages[3]?.toolName, 'bash');
    assert.deepEqual(history.messages[3]?.toolResult, { content: 'ok', isError: false });
    assert.equal(history.messages[4]?.kind, 'stream_end');
    // Input is reported with cache reads folded in; `used` sums every bucket.
    assert.deepEqual(history.tokenUsage, {
      used: 35,
      inputTokens: 13,
      outputTokens: 20,
      breakdown: { input: 13, output: 20 },
    });

    const paged = await provider.fetchHistory('zcode-session-1', { limit: 2, offset: 0 });
    assert.equal(paged.messages.length, 2);
    assert.equal(paged.hasMore, true);
    // Pages are tail-aligned (newest last), so the two newest entries are the
    // tool call and the step-finish marker that ends the turn.
    assert.deepEqual(paged.messages.map((message) => message.kind), ['tool_use', 'stream_end']);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode sessions provider returns an empty page when the database is missing', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-missing-'));
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const history = await new ZcodeSessionsProvider().fetchHistory('zcode-session-missing');
    assert.deepEqual(history, { messages: [], total: 0, hasMore: false, offset: 0, limit: null });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode sessions provider strips <images_input> from user turns and exposes attachments', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-images-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const dbPath = await seedZcodeRichSession(tempRoot, workspacePath);
    const db = new Database(dbPath);
    try {
      db.prepare('UPDATE part SET data = ? WHERE id = ?').run(
        JSON.stringify({ type: 'text', text: appendImagesInputTag('Look at this screenshot.', [{ path: '/tmp/shot.png' }]) }),
        'part-user-text',
      );
    } finally {
      db.close();
    }

    const history = await new ZcodeSessionsProvider().fetchHistory('zcode-session-1');
    const userMessage = history.messages.find((message) => message.kind === 'text' && message.role === 'user');
    assert.equal(userMessage?.content, 'Look at this screenshot.');
    assert.deepEqual(userMessage?.images, [{ path: '/tmp/shot.png' }]);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode sessions provider skips malformed and half-written rows instead of failing', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-truncated-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const dbPath = await seedZcodeRichSession(tempRoot, workspacePath);
    const db = new Database(dbPath);
    try {
      // A truncated assistant message (invalid JSON) and a message with no
      // parts must both be tolerated: the reader skips them, never throws.
      db.prepare(`
        INSERT INTO message (id, session_id, time_created, time_updated, data, sequence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('message-truncated', 'zcode-session-1', 1_700_000_005_000, 1_700_000_005_000, '{"role":"assis', 2);
      db.prepare(`
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('part-truncated', 'message-truncated', 'zcode-session-1', 1_700_000_005_000, 1_700_000_005_000, '{oops', 0);
      db.prepare(`
        INSERT INTO message (id, session_id, time_created, time_updated, data, sequence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('message-empty', 'zcode-session-1', 1_700_000_006_000, 1_700_000_006_000, JSON.stringify({ role: 'assistant' }), 3);
    } finally {
      db.close();
    }

    const history = await new ZcodeSessionsProvider().fetchHistory('zcode-session-1');
    assert.equal(history.total, 5);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode sessions provider drops cancelled turns but keeps real failures', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'zcode-session-cancelled-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const dbPath = await seedZcodeRichSession(tempRoot, workspacePath);
    const db = new Database(dbPath);
    try {
      const insertAssistant = db.prepare(`
        INSERT INTO message (id, session_id, time_created, time_updated, data, sequence)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertPart = db.prepare(`
        INSERT INTO part (id, message_id, session_id, time_created, time_updated, data, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // A user-interrupted turn: ZCode stores the cancellation record itself on
      // the assistant row. The partial text is real and must survive.
      insertAssistant.run(
        'message-cancelled', 'zcode-session-1', 1_700_000_010_000, 1_700_000_010_000,
        JSON.stringify({
          role: 'assistant',
          error: {
            name: 'AiSdkModelAdapterError',
            data: {
              message: 'Model request was cancelled.',
              code: 'model_request_cancelled',
              turnResult: 'cancelled',
            },
          },
        }),
        10,
      );
      insertPart.run(
        'part-cancelled-text', 'message-cancelled', 'zcode-session-1',
        1_700_000_010_000, 1_700_000_010_000,
        JSON.stringify({ type: 'text', text: 'half a sentence' }), 0,
      );

      // An abort surfaced as a bare AbortError is cancelled too.
      insertAssistant.run(
        'message-aborted', 'zcode-session-1', 1_700_000_011_000, 1_700_000_011_000,
        JSON.stringify({ role: 'assistant', error: { name: 'AbortError', data: { message: 'aborted' } } }),
        11,
      );

      // A genuine provider failure must still render as an error.
      insertAssistant.run(
        'message-failed', 'zcode-session-1', 1_700_000_012_000, 1_700_000_012_000,
        JSON.stringify({
          role: 'assistant',
          error: {
            name: 'AiSdkModelAdapterError',
            data: { message: 'Insufficient Balance', code: 'model_request_failed' },
          },
        }),
        12,
      );
    } finally {
      db.close();
    }

    const history = await new ZcodeSessionsProvider().fetchHistory('zcode-session-1');
    const errors = history.messages.filter((message) => message.kind === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0]?.content ?? '', /Insufficient Balance/);

    // The interrupted turn's partial text is still shown.
    assert.ok(history.messages.some((message) => message.content === 'half a sentence'));
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('ZCode normalizeMessage maps streaming deltas, tool events and the permission denial', () => {
  const provider = new ZcodeSessionsProvider();
  const envelope = (type: string, payload: Record<string, unknown>) => ({
    type,
    sessionId: 'sess_live-1',
    timestamp: 1_700_000_000_000,
    payload,
  });

  const textDelta = provider.normalizeMessage(
    envelope('model.streaming', { kind: 'text_delta', delta: 'hello', assistantMessageId: 'msg_1' }),
    null,
  );
  assert.equal(textDelta.length, 1);
  assert.equal(textDelta[0]?.kind, 'stream_delta');
  assert.equal(textDelta[0]?.streamChannel, 'text');
  assert.equal(textDelta[0]?.content, 'hello');
  assert.equal(textDelta[0]?.sessionId, 'sess_live-1');

  const reasoningDelta = provider.normalizeMessage(
    envelope('model.streaming', { kind: 'reasoning_delta', delta: 'thinking' }),
    null,
  );
  assert.equal(reasoningDelta[0]?.kind, 'stream_delta');
  assert.equal(reasoningDelta[0]?.streamChannel, 'thinking');

  const toolCall = provider.normalizeMessage(
    envelope('model.streaming', { kind: 'tool_call', toolCallId: 'call_1', toolName: 'Bash', input: { command: 'echo hi' } }),
    null,
  );
  assert.equal(toolCall[0]?.kind, 'tool_use');
  assert.equal(toolCall[0]?.toolId, 'call_1');
  assert.equal(toolCall[0]?.toolName, 'Bash');

  const success = provider.normalizeMessage(
    envelope('tool.updated', { kind: 'result', toolCallId: 'call_1', result: { success: true, content: 'ZCODE_TOOL_OK' } }),
    null,
  );
  assert.equal(success[0]?.kind, 'tool_result');
  assert.equal(success[0]?.isError, false);
  assert.equal(success[0]?.content, 'ZCODE_TOOL_OK');

  const denied = provider.normalizeMessage(
    envelope('permission.resolved', {
      decision: 'deny',
      toolCallId: 'call_2',
      toolName: 'Write',
      reason: 'No permission client configured for Write',
    }),
    null,
  );
  assert.equal(denied[0]?.kind, 'tool_result');
  assert.equal(denied[0]?.isError, true);
  assert.equal(denied[0]?.toolId, 'call_2');

  // A batch with errors closes the listed calls; a pure-success batch is silent.
  const errorBatch = provider.normalizeMessage(
    envelope('tool.updated', { kind: 'batch', toolCallIds: ['call_2'], successCount: 0, errorCount: 1 }),
    null,
  );
  assert.equal(errorBatch.length, 1);
  assert.equal(errorBatch[0]?.kind, 'tool_result');
  assert.equal(errorBatch[0]?.isError, true);
  assert.deepEqual(
    provider.normalizeMessage(
      envelope('tool.updated', { kind: 'batch', toolCallIds: ['call_1'], successCount: 1, errorCount: 0 }),
      null,
    ),
    [],
  );

  const finished = provider.normalizeMessage(envelope('turn.completed', { response: 'done', resultType: 'success' }), null);
  assert.equal(finished[0]?.kind, 'stream_end');
});

test('ZCode normalizeMessage keeps whitespace-significant deltas untrimmed', () => {
  const provider = new ZcodeSessionsProvider();
  const envelope = (payload: Record<string, unknown>) => ({
    type: 'model.streaming',
    sessionId: 'sess_live-1',
    payload: { assistantMessageId: 'msg_1', ...payload },
  });

  // A whitespace-only delta is the word separator and must survive as its own
  // frame instead of being dropped as empty.
  const space = provider.normalizeMessage(envelope({ kind: 'text_delta', delta: ' ' }), null);
  assert.equal(space.length, 1);
  assert.equal(space[0]?.content, ' ');

  // A leading space must not be trimmed off the word it precedes.
  const leading = provider.normalizeMessage(envelope({ kind: 'text_delta', delta: ' world' }), null);
  assert.equal(leading[0]?.content, ' world');

  // A genuinely empty or non-string delta is still dropped.
  assert.deepEqual(provider.normalizeMessage(envelope({ kind: 'text_delta', delta: '' }), null), []);
  assert.deepEqual(provider.normalizeMessage(envelope({ kind: 'text_delta', delta: 7 }), null), []);
});

test('ZCode normalizeMessage falls back to the passed session id and ignores non-rendering events', () => {
  const provider = new ZcodeSessionsProvider();

  // The first real event carries no sessionId; the runtime supplies the id.
  const delta = provider.normalizeMessage(
    { type: 'model.streaming', payload: { kind: 'text_delta', delta: 'hi' } },
    'app-session-1',
  );
  assert.equal(delta[0]?.sessionId, 'app-session-1');

  for (const type of ['session.titleUpdated', 'turn.started', 'session.updated', 'streamRecovery.updated', 'result', 'permission.requested']) {
    assert.deepEqual(provider.normalizeMessage({ type, payload: {} }, 'app-1'), [], `${type} should not render`);
  }
});

