import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

/**
 * The read watermark store decides whether the sidebar shows a session as
 * unread after a reload, so its two rules are load-bearing: a session with no
 * watermark is never unread (an upgrade must not flag everything), and only a
 * content-level timestamp is ever compared (a bare file `touch` moves the
 * file's mtime, not the conversation, and must not raise a flag).
 */

const readStateResponse = vi.fn();
const saveReadState = vi.fn();
const deleteReadState = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      readState: () => readStateResponse(),
      saveReadState: (sessionId: string, lastSeenAt: string) => saveReadState(sessionId, lastSeenAt),
      deleteReadState: (sessionId: string) => deleteReadState(sessionId),
    },
  },
}));

const loadStore = async () => {
  const store = await import('@/shared/sessionReadState');
  store.resetSessionReadState();
  return store;
};

beforeEach(() => {
  readStateResponse.mockReset();
  saveReadState.mockReset();
  deleteReadState.mockReset();
  readStateResponse.mockResolvedValue({ ok: true, json: async () => ({ readState: [] }) });
  saveReadState.mockResolvedValue({ ok: true });
  deleteReadState.mockResolvedValue({ ok: true });
});

test('a session with no watermark is never unread', async () => {
  const store = await loadStore();

  assert.equal(store.isSessionUnread('never-opened', '2026-01-01T00:00:00.000Z'), false);
});

test('a session whose content moved past its watermark is unread', async () => {
  readStateResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      readState: [{ sessionId: 'session-1', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
    }),
  });
  const store = await loadStore();

  await store.hydrateSessionReadState();

  assert.equal(store.isSessionUnread('session-1', '2026-01-02T00:00:00.000Z'), true);
});

test('a session whose content has not moved on is read', async () => {
  readStateResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      readState: [{ sessionId: 'session-1', lastSeenAt: '2026-01-02T00:00:00.000Z' }],
    }),
  });
  const store = await loadStore();

  await store.hydrateSessionReadState();

  assert.equal(store.isSessionUnread('session-1', '2026-01-02T00:00:00.000Z'), false);
  // An older content timestamp can never make a session unread either.
  assert.equal(store.isSessionUnread('session-1', '2026-01-01T00:00:00.000Z'), false);
});

test('a provider without a content timestamp is never judged unread', async () => {
  const store = await loadStore();

  // A null `contentUpdatedAt` is "cannot tell", not "read": the flag is simply
  // never raised for that session rather than guessed at.
  assert.equal(store.isSessionUnread('session-1', null), false);
  assert.equal(store.isSessionUnread('session-1', undefined), false);
});

test('marking a session seen writes the content snapshot to the server', async () => {
  const store = await loadStore();

  store.markSessionSeen('session-1', '2026-01-03T00:00:00.000Z');

  assert.deepEqual(saveReadState.mock.calls, [['session-1', '2026-01-03T00:00:00.000Z']]);
  assert.equal(store.isSessionUnread('session-1', '2026-01-03T00:00:00.000Z'), false);
});

test('marking a session seen with an unchanged snapshot does not hit the network', async () => {
  readStateResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      readState: [{ sessionId: 'session-1', lastSeenAt: '2026-01-03T00:00:00.000Z' }],
    }),
  });
  const store = await loadStore();
  await store.hydrateSessionReadState();

  store.markSessionSeen('session-1', '2026-01-03T00:00:00.000Z');

  assert.equal(saveReadState.mock.calls.length, 0);
});

test('marking a session with no content timestamp is a no-op', async () => {
  const store = await loadStore();

  store.markSessionSeen('session-1', null);

  assert.equal(saveReadState.mock.calls.length, 0);
});

test('clearing a session drops the watermark locally and on the server', async () => {
  readStateResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      readState: [{ sessionId: 'session-1', lastSeenAt: '2026-01-01T00:00:00.000Z' }],
    }),
  });
  const store = await loadStore();
  await store.hydrateSessionReadState();

  store.clearSessionReadState('session-1');

  assert.deepEqual(deleteReadState.mock.calls, [['session-1']]);
  assert.equal(store.isSessionUnread('session-1', '2026-01-02T00:00:00.000Z'), false);
});

test('a failed hydration keeps whatever is already known', async () => {
  const store = await loadStore();
  store.markSessionSeen('session-1', '2026-01-01T00:00:00.000Z');

  readStateResponse.mockRejectedValue(new Error('offline'));
  await store.hydrateSessionReadState();

  assert.equal(store.isSessionUnread('session-1', '2026-01-02T00:00:00.000Z'), true);
});
