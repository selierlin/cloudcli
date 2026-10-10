import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

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

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
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
