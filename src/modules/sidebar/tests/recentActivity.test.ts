import assert from 'node:assert/strict';

import { test } from 'vitest';

import { RECENT_ACTIVITY_TTL_MS, isRecentlyActive } from '@/modules/sidebar/utils/recentActivity';

const now = new Date('2026-10-15T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

test('content changed inside the window lights the row', () => {
  assert.equal(isRecentlyActive(ago(5 * 60 * 1000), now), true);
});

test('content older than the window does not', () => {
  assert.equal(isRecentlyActive(ago(RECENT_ACTIVITY_TTL_MS + 1), now), false);
});

test('the window excludes its own boundary', () => {
  assert.equal(isRecentlyActive(ago(RECENT_ACTIVITY_TTL_MS), now), false);
  assert.equal(isRecentlyActive(ago(RECENT_ACTIVITY_TTL_MS - 1), now), true);
});

test('a missing or unparseable timestamp never lights the row', () => {
  assert.equal(isRecentlyActive(null, now), false);
  assert.equal(isRecentlyActive(undefined, now), false);
  assert.equal(isRecentlyActive('', now), false);
  assert.equal(isRecentlyActive('not a date', now), false);
});

test('a timestamp slightly ahead of the clock still counts as recent', () => {
  // Cross-device clock skew can push the timestamp a little into the future; it
  // is still the newest content we know about, so it must not read as idle.
  assert.equal(isRecentlyActive(new Date(now.getTime() + 30_000).toISOString(), now), true);
});
