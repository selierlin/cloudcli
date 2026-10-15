import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem, SessionWithProvider } from '@/shared/types';

/**
 * A forked session is created server-side and broadcast as a
 * `session_upserted`, which only updates the project tree — the Conversations
 * list is a separate paginated feed that broadcast never reaches. The sidebar
 * folds the fork's row into the feed state itself at the moment the fork
 * succeeds, so it appears (with the total kept consistent) without a refetch.
 */

const recentConversationsResponse = vi.fn();
const forkSessionResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: () => recentConversationsResponse(),
    forkSession: (sessionId: string) => forkSessionResponse(sessionId),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;

const conversation = (
  sessionId: string,
  sessionTitle: string,
  isPinned = false,
): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'repo',
  sessionTitle,
  lastActivity: '2026-09-22T09:30:00.000Z',
  isPinned,
});

const buildProject = (summaries: Record<string, string>): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: Object.entries(summaries).map(([id, summary]) => ({ id, summary, __provider: 'claude' as const })),
  sessionMeta: { hasMore: false, total: Object.keys(summaries).length },
});

const renderController = (projects: Project[]) => {
  const onSessionSelect = vi.fn();
  const rendered = renderHook(
    ({ projects: currentProjects }: { projects: Project[] }) => useSidebarController({
      projects: currentProjects,
      selectedProject: null,
      selectedSession: null,
      createdConversation: null,
      activeSessions: new Set<string>(),
      isLoading: false,
      isMobile: false,
      t,
      onRefresh: vi.fn(),
      onProjectSelect: vi.fn(),
      onSessionSelect,
      setCurrentProject: vi.fn(),
      setSidebarVisible: vi.fn(),
      sidebarVisible: true,
    }),
    { initialProps: { projects } },
  );
  return { ...rendered, onSessionSelect };
};

const openConversationsTab = async (projects: Project[]) => {
  const rendered = renderController(projects);
  act(() => {
    rendered.result.current.setSearchMode('conversations');
  });
  await waitFor(() => {
    assert.equal(rendered.result.current.recentConversations.length, 2);
  });
  return rendered;
};

beforeEach(() => {
  localStorage.clear();
  recentConversationsResponse.mockReset();
  recentConversationsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        conversations: [conversation('session-1', 'Original title'), conversation('session-2', 'session-2')],
        total: 2,
        hasMore: false,
      },
    }),
  });
  forkSessionResponse.mockReset();
});

test('a forked session joins the feed immediately and bumps the total', async () => {
  const projects = [buildProject({ 'session-1': 'Original title', 'session-2': '' })];
  const { result, onSessionSelect } = await openConversationsTab(projects);
  forkSessionResponse.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { sessionId: 'session-fork', sessionName: 'Original title (fork)' } }),
  });

  await act(async () => {
    await result.current.forkSession({ id: 'session-1', __provider: 'claude' } as SessionWithProvider);
  });

  assert.deepEqual(
    result.current.recentConversations.map((row) => row.sessionId),
    ['session-fork', 'session-1', 'session-2'],
  );
  assert.equal(result.current.recentConversations[0].sessionTitle, 'Original title (fork)');
  assert.equal(result.current.recentConversations[0].projectId, 'project-1');
  assert.equal(result.current.recentConversations[0].projectDisplayName, 'repo');
  assert.equal(result.current.recentConversations[0].isPinned, false);
  assert.equal(result.current.recentConversationsTotal, 3);
  // The row appears without a refetch; navigation still happens.
  assert.equal(recentConversationsResponse.mock.calls.length, 1);
  assert.equal(onSessionSelect.mock.calls.length, 1);
});

test('a fork with no name falls back to the session id', async () => {
  const projects = [buildProject({ 'session-1': 'Original title' })];
  const { result } = await openConversationsTab(projects);
  forkSessionResponse.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { sessionId: 'session-fork', sessionName: '' } }),
  });

  await act(async () => {
    await result.current.forkSession({ id: 'session-1', __provider: 'claude' } as SessionWithProvider);
  });

  assert.equal(result.current.recentConversations[0].sessionTitle, 'session-fork');
});

test('a fork whose owning project cannot be resolved is not inserted, but still opens', async () => {
  const projects = [buildProject({ 'session-1': 'Original title' })];
  const { result, onSessionSelect } = await openConversationsTab(projects);
  forkSessionResponse.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { sessionId: 'session-fork', sessionName: 'Ghost (fork)' } }),
  });

  await act(async () => {
    await result.current.forkSession({ id: 'unknown-session', __provider: 'claude' } as SessionWithProvider);
  });

  assert.deepEqual(
    result.current.recentConversations.map((row) => row.sessionId),
    ['session-1', 'session-2'],
  );
  assert.equal(result.current.recentConversationsTotal, 2);
  assert.equal(onSessionSelect.mock.calls.length, 1);
});
