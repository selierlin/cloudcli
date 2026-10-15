import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

/**
 * The "looked at it here" mirror behind the sidebar's hollow dot.
 *
 * Its whole reason to exist is surviving a reload, so each test loads a fresh
 * module copy and seeds the one it wants through the API — exactly what the
 * page does — then loads again to prove the value came back off localStorage.
 */

const loadStore = async () => {
  vi.resetModules();
  return import('@/shared/sessionLastViewed');
};

beforeEach(() => {
  localStorage.clear();
});

test('a remembered view survives a module reload', async () => {
  const store = await loadStore();
  store.noteSessionLastViewed('session-a', 1_700_000_000_000);

  const restored = await loadStore();

  assert.equal(restored.getSessionLastViewedAt('session-a'), 1_700_000_000_000);
});

test('an unknown session has no remembered view', async () => {
  const store = await loadStore();

  assert.equal(store.getSessionLastViewedAt('never-seen'), null);
});

test('clearing one session forgets only that one', async () => {
  const store = await loadStore();
  store.noteSessionLastViewed('session-a', 1_700_000_000_000);
  store.noteSessionLastViewed('session-b', 1_700_000_001_000);

  store.clearSessionLastViewed('session-a');

  assert.equal(store.getSessionLastViewedAt('session-a'), null);
  assert.equal(store.getSessionLastViewedAt('session-b'), 1_700_000_001_000);

  const restored = await loadStore();
  assert.equal(restored.getSessionLastViewedAt('session-a'), null);
  assert.equal(restored.getSessionLastViewedAt('session-b'), 1_700_000_001_000);
});

test('signing out forgets every view and drops the mirror', async () => {
  const store = await loadStore();
  store.noteSessionLastViewed('session-a', 1_700_000_000_000);

  store.resetSessionLastViewed();

  assert.equal(store.getSessionLastViewedAt('session-a'), null);

  const restored = await loadStore();
  assert.equal(restored.getSessionLastViewedAt('session-a'), null);
});

test('writing drops views too old to matter', async () => {
  const store = await loadStore();
  store.noteSessionLastViewed('old', 1_700_000_000_000);

  const now = 1_700_000_000_000 + 2 * 60 * 60 * 1000;
  store.noteSessionLastViewed('new', now);

  assert.equal(store.getSessionLastViewedAt('old'), null, 'the stale entry is dropped on write');
  assert.equal(store.getSessionLastViewedAt('new'), now);

  const restored = await loadStore();
  assert.equal(restored.getSessionLastViewedAt('old'), null);
  assert.equal(restored.getSessionLastViewedAt('new'), now);
});
