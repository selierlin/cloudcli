import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { createRevealPacer } from '@/modules/chat/utils/revealPacer';
import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type {
  LLMProvider,
  ProjectSession,
  ServerEvent,
  StreamingChannelUpdate,
} from '@/shared/types';

/**
 * Whole-segment providers (DSH) must not land their prose through
 * `appendRealtime`: the streaming plan §11.6 routes it through the reveal
 * pacer so it plays through the same streaming-row channel as real deltas,
 * and the existing terminal/seal branches converge it. Codex used to take the
 * same route; it now runs over `codex app-server` and emits real deltas, so the
 * reverse holds for it — its whole rows stay on the instant path. These tests
 * pin the dispatch: which providers are paced, which rows are not, and the
 * seal ordering (flush → finalize → drop) on `complete` / `tool_use` /
 * `history_truncated`.
 */

type PublishCall = [
  sessionId: string,
  updates: StreamingChannelUpdate[],
  provider: LLMProvider,
];

type Op = 'publish' | 'finalize' | 'append';

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const published: PublishCall[] = [];
  const finalizeStreaming: string[] = [];
  const appendRealtime: Array<[string, unknown]> = [];
  const ops: Op[] = [];

  const sessionStore = {
    finalizeStreaming: (sessionId: string) => {
      finalizeStreaming.push(sessionId);
      ops.push('finalize');
    },
    appendRealtime: (sessionId: string, msg: unknown) => {
      appendRealtime.push([sessionId, msg]);
      ops.push('append');
    },
    truncateAt: () => {},
  } as unknown as SessionStore;

  const streamBuffers = createStreamingBufferRegistry(() => {}, () => false);
  const revealPacer = createRevealPacer(
    (sessionId, updates, provider) => {
      published.push([sessionId, updates, provider]);
      ops.push('publish');
    },
    sessionId => sessionId === 'viewed',
  );

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed' } as ProjectSession,
    currentSessionId: 'viewed',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamBuffers,
    revealPacer,
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore,
  }));

  return {
    published,
    finalizeStreaming,
    appendRealtime,
    ops,
    pacer: revealPacer,
    dispatch: (event: ServerEvent) => listener?.(event),
  };
};

const wholeText = (
  sessionId: string,
  text: string,
  provider: LLMProvider,
  opts: { role?: string; id?: string } = {},
): ServerEvent => ({
  kind: 'text',
  sessionId,
  content: text,
  provider,
  role: opts.role ?? 'assistant',
  id: opts.id ?? 'item-1',
} as unknown as ServerEvent);

const wholeThinking = (
  sessionId: string,
  text: string,
  provider: LLMProvider,
  id = 'reasoning-1',
): ServerEvent => ({
  kind: 'thinking',
  sessionId,
  content: text,
  provider,
  id,
} as unknown as ServerEvent);

const complete = (sessionId: string): ServerEvent => ({
  kind: 'complete',
  sessionId,
  success: false,
} as unknown as ServerEvent);

const toolUse = (sessionId: string): ServerEvent => ({
  kind: 'tool_use',
  sessionId,
  toolId: 'tool-1',
  toolName: 'Bash',
  toolInput: { command: 'pwd' },
} as unknown as ServerEvent);

const historyTruncated = (sessionId: string): ServerEvent => ({
  kind: 'history_truncated',
  sessionId,
  anchorId: 'anchor-1',
} as unknown as ServerEvent);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('codex prose now keeps the instant appendRealtime path', () => {
  const { published, appendRealtime, dispatch } = renderHandlers();

  // Codex streams real `item/agentMessage/delta` frames over `codex app-server`
  // now, so a whole `text` row (a message that never streamed deltas) must not
  // be routed through the pacer any more.
  dispatch(wholeText('viewed', '整'.repeat(300), 'codex'));
  vi.advanceTimersByTime(500);

  assert.equal(appendRealtime.length, 1, 'codex prose takes the instant path');
  assert.equal(published.length, 0, 'the pacer must never see codex');
});

test('dsh prose is paced, never appended as an instant row', () => {
  const { published, appendRealtime, dispatch } = renderHandlers();

  dispatch(wholeText('viewed', '整'.repeat(300), 'dsh'));
  assert.equal(appendRealtime.length, 0, 'whole-segment prose must not bypass the pacer');
  assert.equal(published.length, 0, 'and nothing publishes during the grace window');

  vi.advanceTimersByTime(32);
  assert.equal(published.length, 1);
  assert.equal(published[0][2], 'dsh');
  assert.equal(published[0][1].length, 1);
  assert.equal(published[0][1][0].channel, 'text');
  const slice = published[0][1][0].text;
  assert.ok(slice.length > 0 && slice.length < 300, 'the segment reveals in slices');
});

test('dsh reasoning is paced on the thinking channel', () => {
  const { published, appendRealtime, dispatch } = renderHandlers();

  dispatch(wholeThinking('viewed', '推'.repeat(300), 'dsh'));
  assert.equal(appendRealtime.length, 0);

  vi.advanceTimersByTime(32);
  assert.equal(published.length, 1);
  assert.equal(published[0][1].length, 1);
  assert.equal(published[0][1][0].channel, 'thinking');
  const slice = published[0][1][0].text;
  assert.ok(slice.length > 0 && slice.length < 300);
});

test('claude prose keeps its instant appendRealtime path', () => {
  const { published, appendRealtime, dispatch } = renderHandlers();

  dispatch(wholeText('viewed', 'claude 整段？不，claude 没有 text 整段帧——这条守卫未知提供方', 'claude'));
  vi.advanceTimersByTime(500);

  assert.equal(appendRealtime.length, 1, 'non-whole-segment providers keep appendRealtime');
  assert.equal(published.length, 0, 'the pacer must never see them');
});

test('a user-role text frame is never paced', () => {
  const { published, appendRealtime, dispatch } = renderHandlers();

  dispatch(wholeText('viewed', '用户消息', 'dsh', { role: 'user' }));
  vi.advanceTimersByTime(500);

  assert.equal(appendRealtime.length, 1);
  assert.equal(published.length, 0);
});

test('complete converges the reveal in the same synchronous stack, then finalizes', () => {
  const { published, finalizeStreaming, ops, pacer, dispatch } = renderHandlers();

  dispatch(wholeText('viewed', '收'.repeat(300), 'dsh', { id: 'm-final' }));
  dispatch(complete('viewed'));

  assert.equal(ops[0], 'publish', 'the seal flushes the pacer before anything else');
  assert.deepEqual(published[0][1], [{ channel: 'text', text: '收'.repeat(300) }]);
  assert.deepEqual(ops.slice(1), ['finalize'], 'exactly one finalize follows the flush');
  assert.deepEqual(finalizeStreaming, ['viewed']);
  assert.equal(pacer.has('viewed'), false, 'the seal drops the pacer');

  vi.advanceTimersByTime(1000);
  assert.equal(published.length, 1, 'converged content must not replay after the terminal');
});

test('a tool use seals the mid-flight reveal so post-tool prose starts fresh', () => {
  const { published, finalizeStreaming, ops, pacer, dispatch } = renderHandlers();

  dispatch(wholeText('viewed', '前'.repeat(300), 'dsh', { id: 'm-a' }));
  dispatch(toolUse('viewed'));

  assert.equal(ops[0], 'publish');
  assert.deepEqual(published[0][1], [{ channel: 'text', text: '前'.repeat(300) }]);
  assert.deepEqual(finalizeStreaming, ['viewed']);
  assert.equal(pacer.has('viewed'), false);

  vi.advanceTimersByTime(1000);
  assert.equal(published.length, 1, 'no reveal continues after the seal');
});

test('history_truncated drops the pacer so the replaced segment cannot resurrect', () => {
  const { published, pacer, dispatch } = renderHandlers();

  dispatch(wholeText('viewed', '替'.repeat(300), 'dsh', { id: 'm-x' }));
  dispatch(historyTruncated('viewed'));
  assert.equal(pacer.has('viewed'), false);

  vi.advanceTimersByTime(1000);
  assert.equal(published.length, 0, 'no half row may come back after the edit');
});
