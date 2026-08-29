import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../types/types';

import {
  canApplyMessageSearchHistoryLoad,
  keepMessageSearchTargetCentered,
  resolveMessageSearchTarget,
} from './messageSearchNavigation';

const messages: ChatMessage[] = [
  {
    id: 'user-first',
    type: 'user',
    timestamp: '2026-08-29T01:00:00.000Z',
    content: 'Investigate the provider history endpoint',
  },
  {
    id: 'assistant-first',
    type: 'assistant',
    timestamp: '2026-08-29T01:00:01.000Z',
    content: 'I will inspect it.',
  },
  {
    id: 'user-second',
    type: 'user',
    timestamp: '2026-08-29T02:00:00.000Z',
    content: 'Investigate the provider history endpoint again',
  },
];

test('message search resolves an already-loaded outline target without requesting history', () => {
  const result = resolveMessageSearchTarget(messages, {
    timestamp: '2026-08-29T02:00:00.000Z',
    snippet: 'Investigate the provider history endpoint again',
  });

  assert.equal(result.message?.id, 'user-second');
  assert.equal(result.shouldLoadHistory, false);
});

test('message search requests history only when the outline target is absent', () => {
  const result = resolveMessageSearchTarget(messages, {
    timestamp: '2026-08-29T03:00:00.000Z',
    snippet: 'A question outside the loaded page',
  });

  assert.equal(result.message, null);
  assert.equal(result.shouldLoadHistory, true);
});

test('message search uses the timestamp to disambiguate repeated snippets', () => {
  const result = resolveMessageSearchTarget(messages, {
    timestamp: '2026-08-29T01:00:00.000Z',
    snippet: 'Investigate the provider history endpoint',
  });

  assert.equal(result.message?.id, 'user-first');
});

test('message search does not use a repeated snippet when the timestamp is absent from the page', () => {
  const result = resolveMessageSearchTarget(messages, {
    timestamp: '2026-08-28T01:00:00.000Z',
    snippet: 'Investigate the provider history endpoint',
  });

  assert.equal(result.message, null);
  assert.equal(result.shouldLoadHistory, true);
});

test('message search can resolve an empty-snippet outline item by timestamp alone', () => {
  const result = resolveMessageSearchTarget(messages, {
    timestamp: '2026-08-29T01:00:00.000Z',
    snippet: ' ',
  });

  assert.equal(result.message?.id, 'user-first');
  assert.equal(result.shouldLoadHistory, false);
});

test('message search does not apply a failed or stale full-history response', () => {
  assert.equal(canApplyMessageSearchHistoryLoad(null, 'session-1', 'session-1'), false);
  assert.equal(canApplyMessageSearchHistoryLoad({ status: 'error' }, 'session-1', 'session-1'), false);
  assert.equal(canApplyMessageSearchHistoryLoad({ status: 'idle' }, 'session-1', 'session-2'), false);
  assert.equal(canApplyMessageSearchHistoryLoad({ status: 'idle' }, 'session-1', 'session-1'), true);
});

test('message search animates after layout settles and retries smoothly after a shift', () => {
  let targetLayoutTop = 500;
  let settledCount = 0;
  const scrollBehaviors: Array<ScrollBehavior | undefined> = [];
  const frames: FrameRequestCallback[] = [];
  const container = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, height: 100 }),
  };
  const target = {
    isConnected: true,
    getBoundingClientRect: () => ({
      top: targetLayoutTop - container.scrollTop,
      height: 20,
    }),
    scrollIntoView: (options?: ScrollIntoViewOptions) => {
      scrollBehaviors.push(options?.behavior);
      container.scrollTop = targetLayoutTop - 40;
    },
  };

  keepMessageSearchTargetCentered({
    container,
    target,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: () => undefined,
    onSettled: () => {
      settledCount += 1;
    },
  });

  assert.equal(scrollBehaviors.length, 0);
  while (scrollBehaviors.length === 0) {
    frames.shift()?.(0);
  }
  assert.deepEqual(scrollBehaviors, ['smooth']);

  // The full-history render shifts once after the first smooth scroll starts.
  targetLayoutTop += 210;
  for (let frame = 0; frame < 100 && settledCount === 0; frame += 1) {
    frames.shift()?.(0);
  }

  assert.deepEqual(scrollBehaviors, ['smooth', 'smooth']);
  assert.equal(settledCount, 1);
});
