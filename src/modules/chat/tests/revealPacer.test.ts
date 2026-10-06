import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { createRevealPacer } from '@/modules/chat/utils/revealPacer';
import type { LLMProvider, StreamingChannelUpdate } from '@/shared/types';

/**
 * Whole-segment providers (Codex / DSH) have no token deltas: their prose
 * arrives as complete segments. The pacer spreads each segment over ~1.2s of
 * 32ms ticks through the same streaming-row channel the registry uses, and
 * converges synchronously on terminal/seal events. These tests pin the pacing
 * contract from the streaming plan §11.6: grace window, tick cadence, 1.2s
 * cap, append-only snapshots (no invented characters, no rewind), serial
 * same-channel segments, hidden-session 5Hz coalescing, and the flush/drop
 * lifecycle the handler's seal trio relies on.
 */

type PublishCall = {
  sessionId: string;
  updates: StreamingChannelUpdate[];
  provider: LLMProvider;
};

const publishCalls: PublishCall[] = [];
let visibleSessions: Set<string>;

const create = () => {
  publishCalls.length = 0;
  return createRevealPacer(
    (sessionId, updates, provider) => {
      publishCalls.push({ sessionId, updates, provider });
    },
    sessionId => visibleSessions.has(sessionId),
  );
};

const lastText = (): string => {
  const last = publishCalls[publishCalls.length - 1];
  assert.ok(last, 'expected a publish');
  assert.equal(last.updates.length, 1);
  return last.updates[0].text;
};

beforeEach(() => {
  vi.useFakeTimers();
  visibleSessions = new Set(['s1']);
});

afterEach(() => {
  vi.useRealTimers();
});

test('publishes a short segment in full immediately', () => {
  const pacer = create();

  pacer.append('s1', '短回答', 'codex', 'text', 'item-1');
  assert.equal(publishCalls.length, 1);
  assert.deepEqual(publishCalls[0].updates, [{ channel: 'text', text: '短回答' }]);

  vi.advanceTimersByTime(1000);
  assert.equal(publishCalls.length, 1, 'a short segment needs no further ticks');
});

test('holds the first reveal tick for 32ms so an in-grace terminal converges without playback', () => {
  const pacer = create();
  const full = '长'.repeat(500);

  pacer.append('s1', full, 'codex', 'text', 'm1');
  assert.equal(publishCalls.length, 0, 'nothing publishes during the grace window');

  pacer.flushNow('s1');
  assert.deepEqual(publishCalls[0].updates, [{ channel: 'text', text: full }]);

  vi.advanceTimersByTime(1000);
  assert.equal(publishCalls.length, 1, 'converged content must not replay');
});

test('reveals a long segment on 32ms ticks and finishes within the 1.2s cap', () => {
  const pacer = create();
  const full = '字'.repeat(900);

  pacer.append('s1', full, 'codex', 'text', 'm1');
  vi.advanceTimersByTime(32);
  assert.equal(publishCalls.length, 1, 'the first slice lands on the first tick');
  const first = lastText();
  assert.ok(first.length > 0 && first.length < full.length);

  for (let ms = 64; ms <= 1248; ms += 32) {
    vi.advanceTimersByTime(32);
    if (lastText() === full) {
      assert.ok(ms <= 1248, `reveal must finish within the cap, took ${ms}ms`);
      break;
    }
  }
  assert.equal(lastText(), full, 'the segment must be fully revealed');

  const snapshots = publishCalls.map(call => call.updates[0].text);
  assert.ok(snapshots.length <= 40, `pacing must not publish per character (${snapshots.length})`);
  for (const snapshot of snapshots) {
    assert.ok(full.startsWith(snapshot), 'every snapshot is a prefix of the real text');
  }
  for (let i = 1; i < snapshots.length; i++) {
    assert.ok(snapshots[i].length > snapshots[i - 1].length, 'reveal moves forward only');
  }
});

test('extends the current segment when the same messageId arrives with accumulated text', () => {
  const pacer = create();
  const a = 'A'.repeat(400);
  pacer.append('s1', a, 'dsh', 'text', 'msg-1');
  vi.advanceTimersByTime(64);
  const publishedSoFar = lastText().length;

  const ab = `${a}${'B'.repeat(400)}`;
  const beforeExtension = publishCalls.length;
  pacer.append('s1', ab, 'dsh', 'text', 'msg-1');
  vi.advanceTimersByTime(2000);

  const texts = publishCalls.slice(beforeExtension).map(call => call.updates[0].text);
  for (const text of texts) {
    assert.ok(ab.startsWith(text), 'no rewind and no invented characters');
    assert.ok(text.length >= publishedSoFar, 'already published characters never shrink');
  }
  assert.equal(texts[texts.length - 1], ab, 'the extension must be fully revealed');
});

test('queues a distinct segment until the current one finishes revealing', () => {
  const pacer = create();
  const a = 'A'.repeat(600);
  const b = 'B'.repeat(600);

  pacer.append('s1', a, 'codex', 'text', 'item-1');
  pacer.append('s1', b, 'codex', 'text', 'item-2');

  vi.advanceTimersByTime(32);
  const first = lastText();
  assert.ok(first.startsWith('A') && !first.includes('B'), 'B must not start before A finishes');

  vi.advanceTimersByTime(3000);
  const final = lastText();
  assert.equal(final, a + b, 'the queued segment accumulates append-only after A');
  for (const call of publishCalls) {
    assert.ok(final.startsWith(call.updates[0].text), 'snapshots never shrink');
  }
});

test('folds queued snapshots of one message into a single queued segment', () => {
  const pacer = create();
  const a = 'A'.repeat(600);
  const b1 = 'B'.repeat(300);
  const b2 = `${b1}${'C'.repeat(300)}`;

  // A is still revealing when both snapshots of the next message arrive.
  pacer.append('s1', a, 'dsh', 'text', 'm1');
  pacer.append('s1', b1, 'dsh', 'text', 'm2');
  pacer.append('s1', b2, 'dsh', 'text', 'm2');

  vi.advanceTimersByTime(3000);

  // Without tail-folding the queue replays b1 and then b2, so the final row
  // would contain B's prefix twice.
  const final = lastText();
  assert.equal(final, a + b2, 'queued snapshots of one message must collapse into one wave');
  for (const call of publishCalls) {
    assert.ok((a + b2).startsWith(call.updates[0].text), 'no duplicated or rewound text');
  }
});

test('a queued snapshot shorter than its queued predecessor never regresses the tail', () => {
  const pacer = create();
  const a = 'A'.repeat(600);
  const b1 = 'B'.repeat(400);
  const stale = b1.slice(0, 200);

  pacer.append('s1', a, 'dsh', 'text', 'm1');
  pacer.append('s1', b1, 'dsh', 'text', 'm2');
  pacer.append('s1', stale, 'dsh', 'text', 'm2');

  vi.advanceTimersByTime(3000);

  assert.equal(lastText(), a + b1, 'a stale shorter snapshot must not shrink the queued text');
});

test('a queued short segment lands in full once its turn comes', () => {
  const pacer = create();

  pacer.append('s1', 'G'.repeat(600), 'codex', 'text', 'i1');
  pacer.append('s1', '短段', 'codex', 'text', 'i2');
  vi.advanceTimersByTime(2000);

  assert.equal(lastText(), 'G'.repeat(600) + '短段');
});

test('extends a short segment that already published in full', () => {
  const pacer = create();

  pacer.append('s1', '短', 'dsh', 'text', 'msg-1');
  assert.equal(publishCalls.length, 1);

  const extended = `短${'续'.repeat(300)}`;
  pacer.append('s1', extended, 'dsh', 'text', 'msg-1');
  vi.advanceTimersByTime(2000);

  assert.equal(lastText(), extended);
});

test('hidden sessions publish the accumulated full text at most 5 times per second', () => {
  visibleSessions.delete('s1');
  const pacer = create();

  pacer.append('s1', 'A'.repeat(300), 'codex', 'text', 'm1');
  pacer.append('s1', `${'A'.repeat(300)}${'B'.repeat(300)}`, 'codex', 'text', 'm1');

  assert.ok(!publishCalls.length, 'hidden sessions never reveal');
  vi.advanceTimersByTime(199);
  assert.equal(publishCalls.length, 0);

  vi.advanceTimersByTime(1);
  assert.deepEqual(publishCalls[0].updates, [{
    channel: 'text',
    text: 'A'.repeat(300) + 'B'.repeat(300),
  }]);

  vi.advanceTimersByTime(5000);
  assert.equal(publishCalls.length, 1, 'hidden cadence stays at the 200ms coalesce window');
});

test('flushNow converges a hidden session the moment it becomes visible', () => {
  visibleSessions.delete('s1');
  const pacer = create();

  pacer.append('s1', 'C'.repeat(300), 'codex', 'text', 'm1');
  visibleSessions.add('s1');
  pacer.flushNow('s1');

  assert.deepEqual(publishCalls[0].updates, [{ channel: 'text', text: 'C'.repeat(300) }]);
  vi.advanceTimersByTime(1000);
  assert.equal(publishCalls.length, 1);
});

test('flushNow with nothing unpublished is a no-op', () => {
  const pacer = create();

  pacer.append('s1', 'E'.repeat(300), 'codex', 'text', 'm1');
  pacer.flushNow('s1');
  pacer.flushNow('s1');

  assert.equal(publishCalls.length, 1);
});

test('drop cancels pending reveal work so no half row resurrects', () => {
  const pacer = create();

  pacer.append('s1', 'D'.repeat(900), 'codex', 'text', 'm1');
  pacer.drop('s1');
  assert.equal(pacer.has('s1'), false);

  vi.advanceTimersByTime(1000);
  assert.deepEqual(publishCalls, []);
});

test('has tracks the segment lifecycle through flush and drop', () => {
  const pacer = create();

  assert.equal(pacer.has('s1'), false);
  pacer.append('s1', 'F'.repeat(300), 'codex', 'text', 'm1');
  assert.equal(pacer.has('s1'), true);
  pacer.flushNow('s1');
  assert.equal(pacer.has('s1'), true, 'flush keeps state until the seal drops it');
  pacer.drop('s1');
  assert.equal(pacer.has('s1'), false);
});

test('empty text does not create state', () => {
  const pacer = create();

  pacer.append('s1', '', 'codex', 'text', 'm1');
  assert.equal(pacer.has('s1'), false);
  assert.deepEqual(publishCalls, []);
});

test('publishes thinking and text slices in one thinking-first batch', () => {
  const pacer = create();

  pacer.append('s1', '思'.repeat(300), 'codex', 'thinking', 'r1');
  pacer.append('s1', '文'.repeat(300), 'codex', 'text', 'm1');
  pacer.flushNow('s1');

  assert.deepEqual(publishCalls[0].updates, [
    { channel: 'thinking', text: '思'.repeat(300) },
    { channel: 'text', text: '文'.repeat(300) },
  ]);
});

test('a dropped session starts its next segment from an empty row', () => {
  const pacer = create();

  pacer.append('s1', 'first', 'codex', 'text', 'i1');
  pacer.flushNow('s1');
  pacer.drop('s1');
  pacer.append('s1', 'second', 'codex', 'text', 'i2');
  pacer.flushNow('s1');

  assert.deepEqual(publishCalls.map(call => call.updates), [
    [{ channel: 'text', text: 'first' }],
    [{ channel: 'text', text: 'second' }],
  ]);
});
