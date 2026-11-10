import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import { createRevealPacer } from '@/modules/chat/utils/revealPacer';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ProjectSession, ServerEvent } from '@/shared/types';

/**
 * A session with no composer of its own — the side-question copy — has to be
 * marked processing from the first live frame of its turn.
 *
 * The main composer marks its own session when it sends; the drawer cannot,
 * because the send goes through the drawer's own path. Without this the copy
 * showed nothing between the question and the first frame that happened to
 * carry a status line, which is the wait the reader is looking at.
 */

const renderHandlers = (
  markProcessing: (sessionId: string | null | undefined, activity?: unknown) => void,
) => {
  let listener: ((event: ServerEvent) => void) | null = null;

  const sessionStore = {
    finalizeStreaming: () => {},
    appendRealtime: () => {},
    getMessages: () => [],
  } as unknown as SessionStore;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed' } as ProjectSession,
    currentSessionId: 'viewed',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamBuffers: createStreamingBufferRegistry(() => {}, () => false),
    revealPacer: createRevealPacer(() => {}, () => false),
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore,
    sideAskSessionId: 'aside-1',
    onSessionProcessingFromFrame: markProcessing as never,
  }));

  return (event: ServerEvent) => listener?.(event);
};

test('the first delta of a turn marks the copy as processing', () => {
  const marked: string[] = [];
  const dispatch = renderHandlers((sessionId) => {
    if (sessionId) marked.push(sessionId);
  });

  dispatch({
    kind: 'stream_delta',
    sessionId: 'aside-1',
    content: 'an',
    provider: 'claude',
    streamChannel: 'thinking',
  } as unknown as ServerEvent);

  assert.deepEqual(marked, ['aside-1']);
});

test('a terminal frame does not mark the session as processing', () => {
  const marked: string[] = [];
  const dispatch = renderHandlers((sessionId) => {
    if (sessionId) marked.push(sessionId);
  });

  dispatch({
    kind: 'complete',
    sessionId: 'aside-1',
    success: true,
    aborted: false,
  } as unknown as ServerEvent);

  // Reading a terminal frame as "started" would resurrect the indicator the
  // same frame is about to clear.
  assert.deepEqual(marked, []);
});

test('a user echo is not evidence of a run', () => {
  const marked: string[] = [];
  const dispatch = renderHandlers((sessionId) => {
    if (sessionId) marked.push(sessionId);
  });

  dispatch({
    kind: 'text',
    role: 'user',
    sessionId: 'aside-1',
    content: 'my question',
    provider: 'claude',
  } as unknown as ServerEvent);

  assert.deepEqual(marked, []);
});

test('every frame of a turn is attributed to its own session', () => {
  const marked: string[] = [];
  const dispatch = renderHandlers((sessionId) => {
    if (sessionId) marked.push(sessionId);
  });
  const statusFrame = {
    kind: 'status',
    sessionId: 'aside-1',
    text: 'Running a tool',
  } as unknown as ServerEvent;

  dispatch(statusFrame);

  assert.deepEqual(marked, ['aside-1']);
});
