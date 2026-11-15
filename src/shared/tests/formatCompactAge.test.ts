import assert from 'node:assert/strict';

import { test } from 'vitest';

import { formatCompactAge } from '@/shared/utils';

/**
 * The sidebar rows and the workspace header share this label, so its bucket
 * boundaries are pinned: a missing timestamp hides the field instead of
 * rendering a placeholder, and each bucket stops at its own threshold.
 */

const now = new Date('2026-11-14T12:00:00.000Z');

const at = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();

test('a missing or unparseable timestamp renders nothing', () => {
  assert.equal(formatCompactAge(undefined, now), '');
  assert.equal(formatCompactAge(null, now), '');
  assert.equal(formatCompactAge('', now), '');
  assert.equal(formatCompactAge('not a date', now), '');
});

test('each bucket reports its own unit', () => {
  assert.equal(formatCompactAge(at(30 * 1000), now), '<1m');
  assert.equal(formatCompactAge(at(59 * 60 * 1000), now), '59m');
  assert.equal(formatCompactAge(at(2 * 60 * 60 * 1000), now), '2hr');
  assert.equal(formatCompactAge(at(3 * 24 * 60 * 60 * 1000), now), '3d');
});

test('a clock-skewed future timestamp still reads as just now', () => {
  assert.equal(formatCompactAge(at(-60 * 1000), now), '<1m');
});
