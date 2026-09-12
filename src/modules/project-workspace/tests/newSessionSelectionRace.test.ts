import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

const projectsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: () => Promise.resolve({ ok: false }),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [{ id: 'old-session', summary: 'Old' }],
  sessionMeta: { hasMore: false, total: 1 },
};

type Props = { sessionId?: string };

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [project] });
});

afterEach(() => {
  vi.resetModules();
});

test('clears the old selected session when navigating to the root route', async () => {
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const { result, rerender } = renderHook(
    ({ sessionId }: Props) => useProjectsState({
      sessionId,
      navigate: vi.fn(),
      subscribe: () => () => {},
      isMobile: false,
      isSessionProcessing: () => false,
    }),
    { initialProps: { sessionId: 'old-session' } as Props },
  );

  await waitFor(() => assert.equal(result.current.selectedSession?.id, 'old-session'));

  act(() => {
    result.current.handleNewSession(project);
  });
  rerender({ sessionId: undefined });

  assert.equal(result.current.selectedSession, null);
});
