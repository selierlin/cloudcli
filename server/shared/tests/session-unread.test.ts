import assert from 'node:assert/strict';
import test from 'node:test';

import { isSessionContentUnread } from '@/shared/session-unread.js';

/**
 * The single server-side unread rule. Two boundaries are load-bearing and must
 * not be "fixed" into guesses: a session with no content timestamp and a user
 * with no watermark are both *never* unread — the first because the provider
 * cannot say, the second so an upgrade never greets a user with a wall of
 * flags for sessions they never opened.
 */

test('content newer than the watermark is unread', () => {
  assert.equal(isSessionContentUnread('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'), true);
});

test('content equal to the watermark is read', () => {
  assert.equal(isSessionContentUnread('2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'), false);
});

test('content older than the watermark is read', () => {
  assert.equal(isSessionContentUnread('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'), false);
});

test('no content timestamp is never unread', () => {
  assert.equal(isSessionContentUnread(null, '2026-01-01T00:00:00.000Z'), false);
  assert.equal(isSessionContentUnread(undefined, '2026-01-01T00:00:00.000Z'), false);
});

test('no watermark is never unread, so an upgrade cannot flood the sidebar', () => {
  assert.equal(isSessionContentUnread('2026-01-02T00:00:00.000Z', null), false);
  assert.equal(isSessionContentUnread('2026-01-02T00:00:00.000Z', undefined), false);
});

test('unparseable values are treated as read', () => {
  assert.equal(isSessionContentUnread('nonsense', '2026-01-01T00:00:00.000Z'), false);
  assert.equal(isSessionContentUnread('2026-01-02T00:00:00.000Z', 'nonsense'), false);
});
