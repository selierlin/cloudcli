import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import type { GitStatusResponse } from '@/shared/types';
import { useProjectGitSummary } from '@/modules/project-workspace/hooks/useProjectGitSummary';

/**
 * The header's git badge is a best-effort read: it must surface branch and
 * change count when the server answers, stay hidden when the folder is not a
 * repository, and never let a project switch show the previous project's
 * branch while the new read is still in flight.
 */

const respondWith = (respond: (projectId: string) => GitStatusResponse) => {
  const fetchMock = vi.fn(async (url: string) => {
    const projectId = new URL(url, 'http://localhost').searchParams.get('project') ?? '';
    return new Response(JSON.stringify(respond(projectId)), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

test('a repository reports its branch and the union of changed files', async () => {
  respondWith(() => ({
    branch: 'cloudcli-dev',
    modified: ['src/a.ts'],
    untracked: ['src/b.ts'],
  }));

  const { result } = renderHook(() => useProjectGitSummary('project-1'));

  await waitFor(() => assert.deepEqual(result.current, {
    branch: 'cloudcli-dev',
    changedFileCount: 2,
  }));
});

test('a folder outside a repository has no badge', async () => {
  const fetchMock = respondWith(() => ({ error: 'Not a git repository', notGitRepository: true }));

  const { result } = renderHook(() => useProjectGitSummary('project-1'));

  await waitFor(() => assert.equal(fetchMock.mock.calls.length, 1));
  assert.equal(result.current, null);
});

test('switching projects drops the previous badge before the new read lands', async () => {
  respondWith((projectId) => ({
    branch: projectId === 'project-1' ? 'old-branch' : 'new-branch',
  }));

  const { result, rerender } = renderHook(
    ({ projectId }: { projectId: string }) => useProjectGitSummary(projectId),
    { initialProps: { projectId: 'project-1' } },
  );
  await waitFor(() => assert.equal(result.current?.branch, 'old-branch'));

  rerender({ projectId: 'project-2' });
  assert.equal(result.current, null);

  await waitFor(() => assert.equal(result.current?.branch, 'new-branch'));
});
