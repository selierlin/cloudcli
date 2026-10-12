import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, test, vi } from 'vitest';

import type { CreatedConversationSignal, Project, RecentConversationListItem } from '@/shared/types';

/**
 * The Conversations list is a separate paginated feed fetched only when its tab
 * opens, so a freshly created session — which the workspace already knows in
 * full — would not show up until the next refetch. The workspace hands the row
 * over as a signal and the controller folds it straight into the feed state, so
 * the new row appears (and the total, pin ordering and paging stay consistent)
 * without a manual refresh.
 */

const recentConversationsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: () => recentConversationsResponse(),
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

const signalFor = (sessionId: string, sessionTitle?: string): CreatedConversationSignal => ({
  row: {
    sessionId,
    provider: 'claude',
    projectId: 'project-1',
    projectDisplayName: 'repo',
    sessionTitle: sessionTitle ?? sessionId,
    lastActivity: '2026-09-22T10:00:00.000Z',
    isPinned: false,
  },
  nonce: 1,
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

type ControllerProps = { projects: Project[]; createdConversation: CreatedConversationSignal | null };

const renderController = (initialProps: ControllerProps) => renderHook(
  ({ projects, createdConversation }: ControllerProps) => useSidebarController({
    projects,
    selectedProject: null,
    selectedSession: null,
    createdConversation,
    activeSessions: new Set<string>(),
    isLoading: false,
    isMobile: false,
    t,
    onRefresh: vi.fn(),
    onProjectSelect: vi.fn(),
    onSessionSelect: vi.fn(),
    setCurrentProject: vi.fn(),
    setSidebarVisible: vi.fn(),
    sidebarVisible: true,
  }),
  { initialProps },
);

const openConversationsTab = async (initialProjects: Project[]) => {
  const rendered = renderController({ projects: initialProjects, createdConversation: null });
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
});

test('a locally created session joins the feed immediately and bumps the total', async () => {
  const projects = [buildProject({ 'session-1': 'Original title', 'session-2': '' })];
  const { result, rerender } = await openConversationsTab(projects);

  rerender({ projects, createdConversation: signalFor('session-3', 'New chat') });

  assert.deepEqual(
    result.current.recentConversations.map((row) => row.sessionId),
    ['session-3', 'session-1', 'session-2'],
  );
  assert.equal(result.current.recentConversations[0].sessionTitle, 'New chat');
  assert.equal(result.current.recentConversationsTotal, 3);
  // No refetch was needed for the row to appear.
  assert.equal(recentConversationsResponse.mock.calls.length, 1);
});

test('an unnamed new session keeps its id as the title', async () => {
  const projects = [buildProject({ 'session-1': '', 'session-2': '' })];
  const { result, rerender } = await openConversationsTab(projects);

  rerender({ projects, createdConversation: signalFor('session-3') });

  assert.equal(result.current.recentConversations[0].sessionTitle, 'session-3');
});

test('a new session sorts after pinned rows, mirroring the server ordering', async () => {
  recentConversationsResponse.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        conversations: [conversation('session-pinned', 'Pinned', true), conversation('session-2', 'session-2')],
        total: 2,
        hasMore: false,
      },
    }),
  });
  const projects = [buildProject({ 'session-pinned': '', 'session-2': '' })];
  const { result, rerender } = await openConversationsTab(projects);

  rerender({ projects, createdConversation: signalFor('session-3', 'New chat') });

  assert.deepEqual(
    result.current.recentConversations.map((row) => row.sessionId),
    ['session-pinned', 'session-3', 'session-2'],
  );
});

test('a signal for a session the feed already carries neither duplicates it nor the total', async () => {
  const projects = [buildProject({ 'session-1': 'Original title', 'session-2': '' })];
  const { result, rerender } = await openConversationsTab(projects);

  rerender({ projects, createdConversation: signalFor('session-1', 'Original title') });

  assert.equal(result.current.recentConversations.length, 2);
  assert.equal(result.current.recentConversationsTotal, 2);
});

test('a session that later leaves the feed is not pushed back in by its old signal', async () => {
  const projects = [buildProject({ 'session-1': 'Original title', 'session-2': '' })];
  const { result, rerender } = await openConversationsTab(projects);

  rerender({ projects, createdConversation: signalFor('session-3', 'New chat') });
  assert.equal(result.current.recentConversations.length, 3);

  // The feed refetches without the optimistic row (the session was archived).
  recentConversationsResponse.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        conversations: [conversation('session-1', 'Original title'), conversation('session-2', 'session-2')],
        total: 2,
        hasMore: false,
      },
    }),
  });
  act(() => {
    result.current.reloadRecentConversations();
  });
  await waitFor(() => {
    assert.equal(result.current.recentConversations.length, 2);
  });

  assert.equal(
    result.current.recentConversations.some((row) => row.sessionId === 'session-3'),
    false,
  );
});
