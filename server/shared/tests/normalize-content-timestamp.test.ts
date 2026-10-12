import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeContentTimestamp } from '@/shared/utils.js';

/**
 * `sessions.content_updated_at` has exactly one stored shape. Providers hand in
 * three shapes — ISO strings (Claude), epoch milliseconds (openclaw, WorkBuddy)
 * and numeric strings — and a bare pass-through drops the numeric ones
 * silently: `new Date('1791531485193')` is `Invalid Date`, so the column would
 * read back null and the unread comparison would always answer "no content".
 */

test('an ISO string is returned as canonical ISO', () => {
  assert.equal(normalizeContentTimestamp('2026-10-10T10:26:45.676Z'), '2026-10-10T10:26:45.676Z');
});

test('epoch milliseconds are converted to ISO', () => {
  const value = 1_791_531_485_193;
  assert.equal(normalizeContentTimestamp(value), new Date(value).toISOString());
});

test('epoch seconds are converted to ISO', () => {
  const value = 1_791_531_485;
  assert.equal(normalizeContentTimestamp(value), new Date(value * 1000).toISOString());
});

test('a numeric string is read as an epoch value, not as an invalid date', () => {
  const value = 1_791_531_485_193;
  assert.equal(normalizeContentTimestamp(String(value)), new Date(value).toISOString());
});

test('SQLite CURRENT_TIMESTAMP is read as UTC', () => {
  assert.equal(normalizeContentTimestamp('2026-10-10 10:26:45'), '2026-10-10T10:26:45.000Z');
});

test('empty and unusable values normalize to null rather than now', () => {
  assert.equal(normalizeContentTimestamp(undefined), null);
  assert.equal(normalizeContentTimestamp(null), null);
  assert.equal(normalizeContentTimestamp(''), null);
  assert.equal(normalizeContentTimestamp('   '), null);
  assert.equal(normalizeContentTimestamp('not a date'), null);
  assert.equal(normalizeContentTimestamp(0), null);
  assert.equal(normalizeContentTimestamp(Number.NaN), null);
});
