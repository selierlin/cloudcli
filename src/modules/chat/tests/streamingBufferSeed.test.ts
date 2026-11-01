import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

import type { StreamingChannelUpdate } from '@/shared/types';
import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';

/**
 * Seeding the streaming buffer with the prose a reload interrupted.
 *
 * The point of the seed (rather than replaying a synthetic delta) is that the
 * buffer counts the restored text as published: it neither pushes a frame of
 * its own nor lets the first new delta truncate the answer to its own tail.
 */

test('seeding publishes nothing until a real delta arrives, then sends the whole reply', () => {
  const published: Array<{ sessionId: string; updates: StreamingChannelUpdate[] }> = [];
  const registry = createStreamingBufferRegistry((sessionId, updates) => {
    published.push({ sessionId, updates });
  });

  registry.seed('btw-1', 'half an ans', '', 'claude');
  registry.flushNow('btw-1');

  assert.equal(published.length, 0, 'the restored text was already on screen');

  registry.append('btw-1', 'wer', 'claude');
  registry.flushNow('btw-1');

  assert.equal(published.length, 1);
  assert.deepEqual(published[0].updates, [{ channel: 'text', text: 'half an answer' }]);
});

test('the seeded buffer exists until it is dropped', () => {
  const registry = createStreamingBufferRegistry(() => {});

  registry.seed('btw-1', 'partial', 'reasoning', 'claude');
  assert.equal(registry.has('btw-1'), true);

  registry.drop('btw-1');
  assert.equal(registry.has('btw-1'), false);
});

test('seeding an empty transcript leaves no buffer behind', () => {
  const flush = vi.fn();
  const registry = createStreamingBufferRegistry(flush);

  registry.seed('btw-1', '', '', 'claude');

  assert.equal(registry.has('btw-1'), false);
});
