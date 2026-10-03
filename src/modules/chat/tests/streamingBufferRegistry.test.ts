import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import type { LLMProvider, StreamingChannelUpdate } from '@/shared/types';

type FlushCall = {
  sessionId: string;
  updates: StreamingChannelUpdate[];
  provider: LLMProvider;
};

const flushCalls: FlushCall[] = [];
let visibleSessions: Set<string>;
let nextFrameId: number;
let frameCallbacks: Map<number, FrameRequestCallback>;

const create = () => {
  flushCalls.length = 0;
  return createStreamingBufferRegistry(
    (sessionId, updates, provider) => {
      flushCalls.push({ sessionId, updates, provider });
    },
    sessionId => visibleSessions.has(sessionId),
  );
};

const runNextFrame = (timestamp: number): void => {
  const next = frameCallbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
  assert.ok(next, 'expected a pending animation frame');
  frameCallbacks.delete(next[0]);
  next[1](timestamp);
};

beforeEach(() => {
  vi.useFakeTimers();
  visibleSessions = new Set(['s1', 's2', 'a', 'b']);
  nextFrameId = 1;
  frameCallbacks = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('publishes the first visible delta on the next animation frame', () => {
  const registry = create();

  registry.append('s1', '你', 'claude');
  assert.deepEqual(flushCalls, []);

  runNextFrame(0);
  assert.deepEqual(flushCalls, [{
    sessionId: 's1',
    updates: [{ channel: 'text', text: '你' }],
    provider: 'claude',
  }]);
});

test('coalesces same-frame deltas into one latest-state batch', () => {
  const registry = create();

  registry.append('s1', '你', 'claude');
  registry.append('s1', '好', 'claude');
  runNextFrame(0);

  assert.deepEqual(flushCalls, [{
    sessionId: 's1',
    updates: [{ channel: 'text', text: '你好' }],
    provider: 'claude',
  }]);
});

test('limits visible publishes to one eligible frame per 32ms', () => {
  const registry = create();

  registry.append('s1', 'A', 'claude');
  runNextFrame(0);
  registry.append('s1', 'B', 'claude');
  runNextFrame(16);
  assert.equal(flushCalls.length, 1);

  runNextFrame(32);
  assert.deepEqual(flushCalls[1].updates, [{ channel: 'text', text: 'AB' }]);
});

test('uses the watchdog when animation frames do not run', () => {
  const registry = create();

  registry.append('s1', 'partial', 'claude');
  vi.advanceTimersByTime(99);
  assert.equal(flushCalls.length, 0);

  vi.advanceTimersByTime(1);
  assert.deepEqual(flushCalls[0].updates, [{ channel: 'text', text: 'partial' }]);
  assert.equal(frameCallbacks.size, 0, 'watchdog cancels the pending frame');
});

test('publishes only channels changed since the previous batch', () => {
  const registry = create();

  registry.append('s1', '推理', 'claude', 'thinking');
  runNextFrame(0);
  registry.append('s1', '正文', 'claude', 'text');
  runNextFrame(32);

  assert.deepEqual(flushCalls.map(call => call.updates), [
    [{ channel: 'thinking', text: '推理' }],
    [{ channel: 'text', text: '正文' }],
  ]);
});

test('publishes two dirty channels in one thinking-first batch', () => {
  const registry = create();

  registry.append('s1', '正文', 'claude', 'text');
  registry.append('s1', '推理', 'claude', 'thinking');
  runNextFrame(0);

  assert.deepEqual(flushCalls, [{
    sessionId: 's1',
    updates: [
      { channel: 'thinking', text: '推理' },
      { channel: 'text', text: '正文' },
    ],
    provider: 'claude',
  }]);
});

test('limits hidden sessions to one publish every 200ms without requesting a frame', () => {
  visibleSessions.delete('s1');
  const registry = create();

  registry.append('s1', 'A', 'claude');
  registry.append('s1', 'B', 'claude');
  assert.equal(frameCallbacks.size, 0);
  vi.advanceTimersByTime(199);
  assert.equal(flushCalls.length, 0);

  vi.advanceTimersByTime(1);
  assert.deepEqual(flushCalls[0].updates, [{ channel: 'text', text: 'AB' }]);
});

test('replaces a pending foreground schedule with the hidden cadence', () => {
  const registry = create();
  registry.append('s1', 'A', 'claude');

  visibleSessions.delete('s1');
  registry.append('s1', 'B', 'claude');
  assert.equal(frameCallbacks.size, 0);
  vi.advanceTimersByTime(100);
  assert.equal(flushCalls.length, 0, 'the old foreground watchdog must be cancelled');

  vi.advanceTimersByTime(100);
  assert.deepEqual(flushCalls[0].updates, [{ channel: 'text', text: 'AB' }]);
});

test('flushNow synchronously catches up a session that becomes visible', () => {
  visibleSessions.delete('s1');
  const registry = create();
  registry.append('s1', 'latest', 'claude');

  visibleSessions.add('s1');
  registry.flushNow('s1');

  assert.deepEqual(flushCalls[0].updates, [{ channel: 'text', text: 'latest' }]);
  vi.advanceTimersByTime(200);
  assert.equal(flushCalls.length, 1);
});

test('flushNow with no dirty content is a no-op', () => {
  const registry = create();
  registry.append('s1', 'done', 'claude');
  registry.flushNow('s1');
  registry.flushNow('s1');

  assert.equal(flushCalls.length, 1);
});

test('empty deltas do not create a buffer or placeholder row', () => {
  const registry = create();
  registry.append('s1', '', 'claude');
  registry.flushNow('s1');

  assert.equal(registry.has('s1'), false);
  assert.deepEqual(flushCalls, []);
});

test('drop and dropAll cancel all pending frame and timer work', () => {
  const registry = create();
  registry.append('s1', 'A', 'claude');
  registry.append('s2', 'B', 'cursor');
  registry.drop('s1');
  registry.dropAll();

  assert.equal(registry.has('s1'), false);
  assert.equal(registry.has('s2'), false);
  assert.equal(frameCallbacks.size, 0);
  vi.advanceTimersByTime(200);
  assert.deepEqual(flushCalls, []);
});

test('a dropped session starts its next cycle from empty text', () => {
  const registry = create();

  registry.append('s1', 'first', 'claude');
  registry.flushNow('s1');
  registry.drop('s1');
  registry.append('s1', 'second', 'claude');
  registry.flushNow('s1');

  assert.deepEqual(flushCalls.map(call => call.updates), [
    [{ channel: 'text', text: 'first' }],
    [{ channel: 'text', text: 'second' }],
  ]);
});

test('a stream_end reaching a frozen page converges in one stack with no residual replay (§6.1 15)', () => {
  const registry = create();

  // The page is fully backgrounded: neither frames nor timers run while the
  // terminal event arrives. The teardown (flush → finalize → drop) then runs
  // in one synchronous stack the moment JavaScript executes again.
  registry.append('s1', '后台积压的正文', 'claude');
  registry.append('s1', '，还在增长', 'claude');
  registry.flushNow('s1');
  registry.drop('s1');

  assert.deepEqual(flushCalls, [{
    sessionId: 's1',
    updates: [{ channel: 'text', text: '后台积压的正文，还在增长' }],
    provider: 'claude',
  }], 'the frozen page gets exactly one complete publish on convergence');

  // No residual buffer means the deferred rAF/watchdog cannot batch-replay
  // the accumulated state after the page returns to the foreground.
  vi.advanceTimersByTime(1000);
  assert.equal(frameCallbacks.size, 0, 'convergence cancels the deferred frame');
  assert.equal(flushCalls.length, 1);
});

test('the watchdog publishes a frozen page once it resumes, before any teardown', () => {
  const registry = create();

  registry.append('s1', '冻结期间到达', 'claude');
  vi.advanceTimersByTime(100);

  assert.deepEqual(flushCalls[0].updates, [{ channel: 'text', text: '冻结期间到达' }]);
  assert.equal(frameCallbacks.size, 0, 'the watchdog cancels the pending frame');
});
