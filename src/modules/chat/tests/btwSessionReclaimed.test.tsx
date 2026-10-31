import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * A side-question copy can be reclaimed by the server while this tab is away
 * (an idle sweep, or a restart). The drawer keeps the id in React state, so
 * without a signal here every later send answers `SESSION_NOT_FOUND` and every
 * close answers 404 — and the raw server line would be appended to a branch
 * nobody can reopen.
 *
 * Two frames carry that signal: the sweep's `session_deleted` broadcast, and
 * the rejection of a send into the dead id. Both must reach the drawer, and
 * neither may leak into another conversation.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const gone: string[] = [];
  const appended: NormalizedMessage[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamBuffers: {
      append: () => {},
      flushNow: () => {},
      drop: () => {},
      dropAll: () => {},
      has: () => false,
    },
    revealPacer: {
      append: () => {},
      flushNow: () => {},
      drop: () => {},
      dropAll: () => {},
      has: () => false,
    },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: (_sessionId: string, message: NormalizedMessage) => { appended.push(message); },
    } as unknown as SessionStore,
    sideAskSessionId: 'btw-1',
    onSideAskSessionGone: (sessionId) => { gone.push(sessionId); },
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { dispatch, gone, appended };
};

test('the sweep broadcast reaches the drawer that still holds the copy', () => {
  const { dispatch, gone } = renderHandlers();

  dispatch({ kind: 'session_deleted', sessionId: 'btw-1', timestamp: new Date().toISOString() });

  assert.deepEqual(gone, ['btw-1']);
});

test('deleting another session leaves the drawer alone', () => {
  const { dispatch, gone } = renderHandlers();

  dispatch({ kind: 'session_deleted', sessionId: 'viewed-session', timestamp: new Date().toISOString() });

  assert.deepEqual(gone, []);
});

test('a send rejected because the copy is gone reports the copy, not a transcript row', () => {
  const { dispatch, gone, appended } = renderHandlers();

  dispatch({
    kind: 'protocol_error',
    code: 'SESSION_NOT_FOUND',
    error: 'Session "btw-1" was not found. Create it via POST /api/providers/sessions first.',
    sessionId: 'btw-1',
  } as unknown as ServerEvent);

  assert.deepEqual(gone, ['btw-1']);
  // The drawer explains the loss in its own words; the server's protocol text
  // would be a row in a transcript that no longer exists.
  assert.deepEqual(appended, []);
});

test('a rejected send on another session still surfaces its error', () => {
  const { dispatch, gone, appended } = renderHandlers();

  dispatch({
    kind: 'protocol_error',
    code: 'SESSION_NOT_FOUND',
    error: 'Session "viewed-session" was not found.',
    sessionId: 'viewed-session',
  } as unknown as ServerEvent);

  assert.deepEqual(gone, []);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].kind, 'error');
});
