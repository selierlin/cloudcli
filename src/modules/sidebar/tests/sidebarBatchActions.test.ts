import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * The two destructive outcomes of the sidebar's bulk selection. Archiving keeps
 * the sessions restorable, so a partial failure only warns; deleting for good
 * has to report the ids that survived so the caller can keep them selected.
 * Neither may send a session that started running after the selection.
 */

const deleteSession = vi.fn();
const permanentlyDeleteArchivedSessions = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    deleteSession: (...args: unknown[]) => deleteSession(...args),
    permanentlyDeleteArchivedSessions: (...args: unknown[]) => permanentlyDeleteArchivedSessions(...args),
    recentConversations: () => Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [], total: 0, hasMore: false } }) }),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;
const project: Project = { projectId: 'project-1', displayName: 'repo', fullPath: '/repo', sessions: [] };
// One stable array: a fresh literal on every render re-runs the controller's project effects.
const projects: Project[] = [project];

const renderController = (activeSessionIds: string[] = []) => renderHook(
  ({ active }: { active: string[] }) => useSidebarController({
    projects,
    selectedProject: null,
    selectedSession: null,
    createdConversation: null,
    activeSessions: new Set(active),
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
  { initialProps: { active: activeSessionIds } },
);

beforeEach(() => {
  deleteSession.mockReset();
  permanentlyDeleteArchivedSessions.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('deleting a selection hard-deletes each id and reports them back', async () => {
  deleteSession.mockResolvedValue({ ok: true });
  const onCompleted = vi.fn();
  const { result } = renderController();

  act(() => result.current.showBatchSessionArchiveConfirmation(['a', 'b'], onCompleted));
  await act(async () => { await result.current.confirmBatchSessionDelete(); });

  assert.deepEqual(deleteSession.mock.calls, [['a', true], ['b', true]]);
  assert.deepEqual(onCompleted.mock.calls, [[['a', 'b']]]);
});

test('a delete that fails leaves that id for a retry and still reports the rest', async () => {
  const alertMock = vi.fn();
  vi.stubGlobal('alert', alertMock);
  deleteSession.mockImplementation(async (sessionId: string) => ({ ok: sessionId !== 'b', status: 500 }));
  const onCompleted = vi.fn();
  const { result } = renderController();

  act(() => result.current.showBatchSessionArchiveConfirmation(['a', 'b'], onCompleted));
  await act(async () => { await result.current.confirmBatchSessionDelete(); });

  assert.deepEqual(onCompleted.mock.calls, [[['a']]]);
  assert.equal(alertMock.mock.calls[0][0], 'messages.batchDeletePartialFailure');
});

test('a session that started running after the selection is never sent to delete', async () => {
  const alertMock = vi.fn();
  vi.stubGlobal('alert', alertMock);
  deleteSession.mockResolvedValue({ ok: true });
  const onCompleted = vi.fn();
  const { result, rerender } = renderController();

  act(() => result.current.showBatchSessionArchiveConfirmation(['a', 'b'], onCompleted));
  rerender({ active: ['a', 'b'] });
  await act(async () => { await result.current.confirmBatchSessionDelete(); });

  assert.equal(deleteSession.mock.calls.length, 0);
  assert.equal(onCompleted.mock.calls.length, 0, 'the selection is left untouched for a later retry');
  assert.equal(alertMock.mock.calls[0][0], 'messages.batchDeleteNoLongerAvailable');
});

test('archiving reports only the sessions that actually went', async () => {
  const alertMock = vi.fn();
  vi.stubGlobal('alert', alertMock);
  deleteSession.mockImplementation(async (sessionId: string) => ({ ok: sessionId !== 'b', status: 500 }));
  const onCompleted = vi.fn();
  const { result } = renderController();

  act(() => result.current.showBatchSessionArchiveConfirmation(['a', 'b'], onCompleted));
  await act(async () => { await result.current.confirmBatchSessionArchive(); });

  assert.deepEqual(onCompleted.mock.calls, [[['a']]]);
  assert.equal(alertMock.mock.calls[0][0], 'messages.batchArchivePartialFailure');
});

test('confirming the archived-selection dialog deletes exactly the ids it was given', async () => {
  permanentlyDeleteArchivedSessions.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { sessionIds: ['x'] } }),
  });
  const onCompleted = vi.fn();
  const { result } = renderController();

  act(() => result.current.showBatchArchivedSessionDeleteConfirmation(['x', 'y'], onCompleted));
  await act(async () => { await result.current.confirmBatchArchivedSessionDelete(); });

  assert.deepEqual(permanentlyDeleteArchivedSessions.mock.calls, [[['x', 'y']]]);
  assert.deepEqual(onCompleted.mock.calls, [[['x']]]);
});

test('cancelling the archived-selection dialog deletes nothing', () => {
  const onCompleted = vi.fn();
  const { result } = renderController();

  act(() => result.current.showBatchArchivedSessionDeleteConfirmation(['x'], onCompleted));
  act(() => result.current.cancelBatchArchivedSessionDelete());

  assert.equal(permanentlyDeleteArchivedSessions.mock.calls.length, 0);
  assert.equal(onCompleted.mock.calls.length, 0);
});
