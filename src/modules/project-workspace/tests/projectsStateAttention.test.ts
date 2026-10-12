import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The sidebar's unread channel is driven entirely by websocket events, so its
 * leveling and clearing rules live here rather than in a rendered row.
 *
 * Two rules are load-bearing. First, only a `permission_request` is an
 * `action` — an `error` is something the user cannot answer, so it is a plain
 * `notice` and must not promise "act and it clears". Second, a permission that
 * is answered or cancelled elsewhere clears the row, but only once the last of
 * the session's outstanding requests is gone: a session can have several in
 * flight and each resolve names just one.
 */

const projectsResponse = vi.fn();
const readStateResponse = vi.fn();
const saveReadState = vi.fn();
const deleteReadState = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
    user: {
      readState: () => readStateResponse(),
      saveReadState: (sessionId: string, lastSeenAt: string) => saveReadState(sessionId, lastSeenAt),
      deleteReadState: (sessionId: string) => deleteReadState(sessionId),
    },
  },
}));

const URL_SESSION_ID = 'url-session';
const OTHER_SESSION_ID = 'other-session';

type ServerEventListener = (event: Record<string, unknown>) => void;

const listeners = new Set<ServerEventListener>();

const emit = (event: Record<string, unknown>) => {
  for (const listener of listeners) {
    listener(event);
  }
};

const renderProjectsState = async (initialPending: ReadonlySet<string> = new Set()) => {
  const { useProjectsState } = await import(
    '@/modules/project-workspace/hooks/useProjectsState'
  );

  return renderHook(
    ({ pending, sessionId }: { pending: ReadonlySet<string>; sessionId: string }) =>
      useProjectsState({
        sessionId,
        navigate: vi.fn() as never,
        subscribe: (listener: ServerEventListener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        isMobile: false,
        isSessionProcessing: () => false,
        pendingApprovalSessionIds: pending,
      }),
    { initialProps: { pending: initialPending, sessionId: URL_SESSION_ID } },
  );
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [] });
  readStateResponse.mockReset();
  readStateResponse.mockResolvedValue({ ok: true, json: async () => ({ readState: [] }) });
  saveReadState.mockReset();
  saveReadState.mockResolvedValue({ ok: true });
  deleteReadState.mockReset();
  deleteReadState.mockResolvedValue({ ok: true });
  listeners.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('a permission request is an action while an error is only a notice', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
    emit({ kind: 'error', sessionId: 'error-session' });
  });

  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), 'action');
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get('error-session'), 'notice');
});

test('the session open in the chat view is never flagged', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: URL_SESSION_ID, requestId: 'r1' });
  });

  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(URL_SESSION_ID), undefined);
});

test('resolving the only pending permission clears the row', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), 'action');

  await act(async () => {
    emit({ kind: 'permission_resolved', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), undefined);
});

test('a cancellation clears the row just like a resolution', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
    emit({ kind: 'permission_cancelled', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
  });

  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), undefined);
});

test('the capsule stays until the last of several requests is answered', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
    emit({ kind: 'permission_request', sessionId: OTHER_SESSION_ID, requestId: 'r2' });
  });

  await act(async () => {
    emit({ kind: 'permission_resolved', sessionId: OTHER_SESSION_ID, requestId: 'r1' });
  });
  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID),
    'action',
    'one request is still open, so the row keeps its capsule',
  );

  await act(async () => {
    emit({ kind: 'permission_resolved', sessionId: OTHER_SESSION_ID, requestId: 'r2' });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), undefined);
});

test('a resolution for a session we never tracked leaves its notice alone', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'complete', sessionId: OTHER_SESSION_ID });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), 'notice');

  await act(async () => {
    emit({ kind: 'permission_resolved', sessionId: OTHER_SESSION_ID, requestId: 'never-tracked' });
  });
  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID),
    'notice',
    'the notice is not a permission request this event can clear',
  );
});

test('the poll rebuilds a blocked row after a refresh dropped the event', async () => {
  const { result, rerender } = await renderProjectsState();
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID), undefined);

  await act(async () => {
    rerender({ pending: new Set([OTHER_SESSION_ID]), sessionId: URL_SESSION_ID });
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID),
    'action',
    'the poll is the only channel a refreshed page has',
  );
});

test('a poll that stops listing an approval clears only what it flagged', async () => {
  const { result, rerender } = await renderProjectsState();

  // A plain unread notice the websocket set, with no approval behind it.
  await act(async () => {
    emit({ kind: 'complete', sessionId: 'notice-session' });
  });
  await act(async () => {
    rerender({ pending: new Set([OTHER_SESSION_ID]), sessionId: URL_SESSION_ID });
  });
  await act(async () => {
    rerender({ pending: new Set(), sessionId: URL_SESSION_ID });
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(OTHER_SESSION_ID),
    undefined,
    'the answer reached the server, so the row is no longer blocked',
  );
  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get('notice-session'),
    'notice',
    'a notice the websocket set is not this channel to clear',
  );
});

test('the poll flags the open session too, for its own row to hide', async () => {
  const { result, rerender } = await renderProjectsState();

  await act(async () => {
    rerender({ pending: new Set([URL_SESSION_ID]), sessionId: URL_SESSION_ID });
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(URL_SESSION_ID),
    'action',
    'the row suppresses the indicator for the selected session itself',
  );
});

test('leaving a session blocked on an approval flags it at once, before any poll', async () => {
  const { result, rerender } = await renderProjectsState();

  // The approval lands while the session is on screen, so it is not flagged yet.
  await act(async () => {
    emit({ kind: 'permission_request', sessionId: URL_SESSION_ID, requestId: 'r1' });
  });
  assert.equal(result.current.sidebarSharedProps.attentionSessions.get(URL_SESSION_ID), undefined);

  await act(async () => {
    rerender({ pending: new Set(), sessionId: OTHER_SESSION_ID });
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(URL_SESSION_ID),
    'action',
    'switching away must flag the row without waiting up to 5s for the poll',
  );
});

test('an approval answered while on screen is not re-flagged on leaving', async () => {
  const { result, rerender } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: URL_SESSION_ID, requestId: 'r1' });
    emit({ kind: 'permission_resolved', sessionId: URL_SESSION_ID, requestId: 'r1' });
  });

  await act(async () => {
    rerender({ pending: new Set(), sessionId: OTHER_SESSION_ID });
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(URL_SESSION_ID),
    undefined,
    'an already-answered approval must not come back as a false capsule',
  );
});

test('leaving still flags a session that has an unanswered request left', async () => {
  const { result, rerender } = await renderProjectsState();

  await act(async () => {
    emit({ kind: 'permission_request', sessionId: URL_SESSION_ID, requestId: 'r1' });
    emit({ kind: 'permission_request', sessionId: URL_SESSION_ID, requestId: 'r2' });
    emit({ kind: 'permission_resolved', sessionId: URL_SESSION_ID, requestId: 'r1' });
  });

  await act(async () => {
    rerender({ pending: new Set(), sessionId: OTHER_SESSION_ID });
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get(URL_SESSION_ID),
    'action',
    'one request is still open, so the row is still blocked',
  );
});

const buildUpsert = (sessionId: string, change: 'content' | 'metadata') => ({
  kind: 'session_upserted',
  sessionId,
  providerSessionId: sessionId,
  provider: 'claude',
  session: {
    id: sessionId,
    summary: 'a session',
    messageCount: 0,
    lastActivity: '2026-01-01T00:00:00.000Z',
    change,
  },
  project: null,
  timestamp: '2026-01-01T00:00:00.000Z',
});

test('a metadata-only session_upserted does not raise a notice', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit(buildUpsert('meta-session', 'metadata'));
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get('meta-session'),
    undefined,
    'a title change, fork or bare touch carries no new conversation to read',
  );
});

test('a content session_upserted raises a notice', async () => {
  const { result } = await renderProjectsState();

  await act(async () => {
    emit(buildUpsert('content-session', 'content'));
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get('content-session'),
    'notice',
    'a real new message is what the unread capsule is for',
  );
});

const buildProject = (): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'My Repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
});

/**
 * Read-state persistence (需求 B). The watermark is what makes an unread flag
 * survive a reload, so two rules are load-bearing: only a session that has a
 * watermark and whose *content* moved past it is unread, and the watermark is
 * written from the session's content timestamp — never the file mtime.
 */

const sessionWithContent = (id: string, contentUpdatedAt: string, isUnread = false) => ({
  id,
  summary: id,
  lastActivity: contentUpdatedAt,
  contentUpdatedAt,
  isUnread,
});

const projectsWithSessions = (sessions: Array<Record<string, unknown>>): Project[] => [
  {
    ...buildProject(),
    sessions: sessions as never,
    sessionMeta: { hasMore: false, total: sessions.length },
  },
];

const hydrateReadState = async (
  readState: Array<{ sessionId: string; lastSeenAt: string }>,
): Promise<void> => {
  readStateResponse.mockResolvedValue({ ok: true, json: async () => ({ readState }) });
  const store = await import('@/shared/sessionReadState');
  await store.hydrateSessionReadState();
};

test('a session the server reports unread loads as unread', async () => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projectsWithSessions([
      sessionWithContent('stale-session', '2026-01-02T00:00:00.000Z', true),
    ]),
  });

  const { result } = await renderProjectsState();
  await act(async () => {
    await hydrateReadState([{ sessionId: 'stale-session', lastSeenAt: '2026-01-01T00:00:00.000Z' }]);
  });

  assert.equal(
    result.current.sidebarSharedProps.attentionSessions.get('stale-session'),
    'notice',
    'the server-computed flag is what survives the reload',
  );
});

test('a session the server reports read stays read even with a stale watermark', async () => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projectsWithSessions([
      sessionWithContent('same-session', '2026-01-02T00:00:00.000Z', false),
    ]),
  });

  const { result } = await renderProjectsState();
  await act(async () => {
    await hydrateReadState([{ sessionId: 'same-session', lastSeenAt: '2026-01-02T00:00:00.000Z' }]);
  });

  assert.equal(result.current.sidebarSharedProps.attentionSessions.get('same-session'), undefined);
});

test('a stale server flag is ignored once this device reads the session', async () => {
  const content = '2026-01-02T00:00:00.000Z';
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projectsWithSessions([sessionWithContent('just-read', content, true)]),
  });

  const { result } = await renderProjectsState();
  // The row still carries `isUnread` from before the read; the local watermark
  // now equals the content, so the flag must not be raised again.
  await act(async () => {
    await hydrateReadState([{ sessionId: 'just-read', lastSeenAt: content }]);
  });

  assert.equal(result.current.sidebarSharedProps.attentionSessions.get('just-read'), undefined);
});

test('a session with no watermark is never flagged unread on load', async () => {
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projectsWithSessions([
      sessionWithContent('never-opened', '2026-01-02T00:00:00.000Z', false),
    ]),
  });

  const { result } = await renderProjectsState();
  await act(async () => {
    await hydrateReadState([]);
  });

  assert.equal(result.current.sidebarSharedProps.attentionSessions.get('never-opened'), undefined);
});

test('leaving a session stores a watermark from its current content timestamp', async () => {
  const content = '2026-01-05T00:00:00.000Z';
  projectsResponse.mockResolvedValue({
    ok: true,
    json: async () => projectsWithSessions([sessionWithContent(URL_SESSION_ID, content)]),
  });

  const { rerender } = await renderProjectsState();
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    rerender({ pending: new Set(), sessionId: OTHER_SESSION_ID });
  });

  assert.deepEqual(
    saveReadState.mock.calls,
    [[URL_SESSION_ID, content]],
    'the watermark is the content snapshot taken while leaving, not the client clock',
  );
});

test('deleting a session drops its read watermark', async () => {
  const { result } = await renderProjectsState();
  await act(async () => {
    await hydrateReadState([{ sessionId: OTHER_SESSION_ID, lastSeenAt: '2026-01-01T00:00:00.000Z' }]);
  });

  await act(async () => {
    result.current.sidebarSharedProps.onSessionDelete(OTHER_SESSION_ID);
  });

  assert.deepEqual(deleteReadState.mock.calls, [[OTHER_SESSION_ID]]);
});
