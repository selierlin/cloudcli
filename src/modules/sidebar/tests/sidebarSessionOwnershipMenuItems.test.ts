import assert from 'node:assert/strict';

import { test } from 'vitest';
import type { TFunction } from 'i18next';

import { buildSessionOwnershipMenuItems } from '@/modules/sidebar/utils/sessionOwnershipMenuItems';

const t = ((key: string) => key) as unknown as TFunction;

const keysFor = (input: Partial<Parameters<typeof buildSessionOwnershipMenuItems>[0]>): string[] =>
  buildSessionOwnershipMenuItems({
    parentSessionId: null,
    canAssignParent: false,
    t,
    ...input,
  }).map((item) => item.key);

test('offers "file under…" for a top-level session when a picker is mounted', () => {
  assert.deepEqual(
    keysFor({ canAssignParent: true, onRequestAssignParent: () => {} }),
    ['assign-parent'],
  );
});

test('offers both rows for a nested session, so its parent can be changed or cleared', () => {
  assert.deepEqual(
    keysFor({
      parentSessionId: 'p1',
      canAssignParent: true,
      onRequestAssignParent: () => {},
      onClearParent: () => {},
    }),
    ['assign-parent', 'clear-parent'],
  );
});

test('offers only "move to top level" for a nested session without a picker', () => {
  assert.deepEqual(
    keysFor({ parentSessionId: 'p1', onClearParent: () => {} }),
    ['clear-parent'],
  );
});

test('offers nothing for a session that owns children and has no parent', () => {
  assert.deepEqual(keysFor({ onRequestAssignParent: () => {} }), []);
});

test('offers nothing when the handler is missing even if the flag allows it', () => {
  // Defensive: the flag and the callback are wired together by callers, but a
  // row without a handler must not render an item that cannot open anything.
  assert.deepEqual(keysFor({ canAssignParent: true }), []);
});
