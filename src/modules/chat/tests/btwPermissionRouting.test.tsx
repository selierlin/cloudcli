import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { PendingPermissionRequest, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * The drawer's copy runs with the main conversation's permission mode, so its
 * tool prompts must reach the drawer. Browser-side pending requests are global
 * and the handler used to keep only the viewed session's, which left the copy's
 * prompts invisible — its tools then waited for an answer no UI ever showed.
 *
 * The two lists also have to stay apart: a prompt authorized in the wrong
 * conversation is exactly the failure this split prevents.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  let viewed: PendingPermissionRequest[] = [];
  let aside: PendingPermissionRequest[] = [];

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
    setPendingPermissionRequests: (next) => {
      viewed = typeof next === 'function' ? next(viewed) : next;
    },
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
    sessionStore: { appendRealtime: () => {} } as unknown as SessionStore,
    sideAskSessionId: 'btw-1',
    setSideAskPermissionRequests: (next) => {
      aside = typeof next === 'function' ? next(aside) : next;
    },
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { dispatch, getViewed: () => viewed, getAside: () => aside };
};

const request = (sessionId: string, requestId: string, seq: number): ServerEvent => ({
  kind: 'permission_request',
  requestId,
  toolName: 'Bash',
  input: { command: 'ls' },
  sessionId,
  seq,
} as unknown as ServerEvent);

const resolved = (sessionId: string, requestId: string, seq: number): ServerEvent => ({
  kind: 'permission_resolved',
  requestId,
  sessionId,
  seq,
} as unknown as ServerEvent);

test('a prompt from the copy reaches the drawer, not the main banner', () => {
  const { dispatch, getViewed, getAside } = renderHandlers();

  dispatch(request('btw-1', 'aside-1', 1));

  assert.equal(getAside().length, 1);
  assert.equal(getAside()[0].requestId, 'aside-1');
  assert.deepEqual(getViewed(), []);
});

test('a prompt from the viewed conversation stays out of the drawer', () => {
  const { dispatch, getViewed, getAside } = renderHandlers();

  dispatch(request('viewed-session', 'main-1', 1));

  assert.equal(getViewed().length, 1);
  assert.deepEqual(getAside(), []);
});

test('resolving the copy prompt clears only the drawer list', () => {
  const { dispatch, getViewed, getAside } = renderHandlers();

  dispatch(request('viewed-session', 'main-1', 1));
  dispatch(request('btw-1', 'aside-1', 2));
  dispatch(resolved('btw-1', 'aside-1', 3));

  assert.deepEqual(getAside(), []);
  assert.equal(getViewed().length, 1);
});

test('the drawer subscribe ack seeds prompts a replay buffer still holds', () => {
  const { dispatch, getAside } = renderHandlers();

  dispatch({
    kind: 'chat_subscribed',
    sessionId: 'btw-1',
    isProcessing: true,
    pendingPermissions: [{ requestId: 'replayed', toolName: 'Bash', sessionId: 'btw-1' }],
  } as unknown as ServerEvent);

  assert.equal(getAside().length, 1);
  assert.equal(getAside()[0].requestId, 'replayed');
});
