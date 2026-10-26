import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * `hasNewerMessages` is the forward half of "the whole transcript is loaded".
 *
 * Two directions can leave rows out of the window, and only one of them is
 * `hasMore`: a search hit opens a window in the middle, whose continuation
 * cursor points forward. The export and share dialog call a selection complete
 * only when both ends are covered, so the state has to track the cursor and not
 * a row count — the UI drops control rows and folds tool results into their
 * call, which makes any count comparison wrong for a session that used a tool.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
      sessionTokenUsage: async () => ({ ok: false }),
    },
  },
}));

const message = (id: string, role: 'user' | 'assistant'): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp: `2026-09-16T10:00:0${id.slice(1)}.000Z`,
  provider: 'claude',
  kind: 'text',
  role,
  content: id,
});

const pageResponse = (newerCursor: string | null, hasMore: boolean) => ({
  ok: true,
  json: async () => ({
    data: {
      messages: [message('u2', 'user'), message('a2', 'assistant')],
      total: 10,
      hasMore,
      pageInfo: {
        mode: 'turns',
        snapshotVersion: 'snapshot-1',
        nextCursor: hasMore ? 'older-1' : null,
        newerCursor,
        partial: { older: false, newer: false },
      },
    },
  }),
});

const project = {
  projectId: 'project-1',
  displayName: 'acme',
  fullPath: '/repo',
} as Project;
const session = { id: 'session-1' } as ProjectSession;

async function renderChatState() {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  const store = renderHook(() => useSessionStore());
  const view = renderHook(() => useChatSessionState({
    isActive: true,
    selectedProject: project,
    selectedSession: session,
    ws: null,
    sendMessage: () => {},
    statusCheckSentAtRef: { current: new Map<string, number>() },
    lastSeqRef: { current: new Map<string, number>() },
    sessionStore: store.result.current,
  }));

  return view;
}

afterEach(() => {
  sessionMessages.mockReset();
  vi.resetModules();
});

test('a window opened in the middle reports newer rows left to fetch', async () => {
  sessionMessages.mockResolvedValue(pageResponse('newer-1', true));

  const view = await renderChatState();

  await waitFor(() => assert.equal(view.result.current.hasNewerMessages, true));
  // Both directions are reported separately: this window also has older rows.
  assert.equal(view.result.current.hasMoreMessages, true);
  // The server counts rows; the UI counts messages. They disagree for any
  // session that used a tool, which is why neither stands in for the other.
  assert.equal(view.result.current.totalMessages, 10);
});

test('the latest page reports nothing left in either direction', async () => {
  sessionMessages.mockResolvedValue(pageResponse(null, false));

  const view = await renderChatState();

  await waitFor(() => assert.equal(view.result.current.hasNewerMessages, false));
  assert.equal(view.result.current.hasMoreMessages, false);
});
