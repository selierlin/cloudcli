import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';

/**
 * "Keep projects expanded" (#1648). By default the sidebar treats project
 * groups as an accordion — opening one closes the other — and forgetting
 * everything on reload. When the preference is on, several groups stay open
 * together and survive a reload, while a project the user deliberately
 * collapsed before reloading must not be forced open again.
 *
 * These came from upstream's `sessionBulkSelection.test.ts`, which drives a
 * controller API this fork does not have (batch selection lives in the list
 * components here), so only the expansion cases were carried over.
 */

vi.mock('@/shared/api', () => ({
  api: {
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
    recentConversations: () => Promise.resolve({ ok: true, json: async () => ({ data: { conversations: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;
const noop = () => undefined;
const STORAGE_KEY = 'cloudcli-expanded-projects';

const PROJECTS = [
  { projectId: 'project-1', name: 'project-1', displayName: 'project one', fullPath: '/repo/one', sessions: [] },
  { projectId: 'project-2', name: 'project-2', displayName: 'project two', fullPath: '/repo/two', sessions: [] },
] as unknown as Project[];

const PROJECT = PROJECTS[0];

type ControllerProps = {
  selectedProject?: Project | null;
  keepProjectsExpanded?: boolean;
};

const renderController = (initialProps: ControllerProps = {}) =>
  renderHook(
    ({ selectedProject = null, keepProjectsExpanded }: ControllerProps) =>
      useSidebarController({
        projects: PROJECTS,
        selectedProject,
        selectedSession: null,
        createdConversation: null,
        activeSessions: new Set<string>(),
        isLoading: false,
        isMobile: false,
        t,
        onRefresh: noop,
        onProjectSelect: noop,
        onSessionSelect: noop,
        onSessionDelete: noop,
        onLoadMoreSessions: noop,
        onProjectDelete: noop,
        setCurrentProject: noop,
        setSidebarVisible: noop,
        sidebarVisible: true,
        keepProjectsExpanded,
      }),
    { initialProps },
  );

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('project expansion remains an accordion by default', () => {
  const { result } = renderController();
  act(() => result.current.toggleProject('project-1'));
  act(() => result.current.toggleProject('project-2'));
  assert.equal(result.current.isProjectExpanded('project-1'), false);
  assert.equal(result.current.isProjectExpanded('project-2'), true);
});

test('opt-in multi-open groups survive reloads and toggle independently', () => {
  const first = renderController({ keepProjectsExpanded: true });
  act(() => first.result.current.toggleProject('project-1'));
  act(() => first.result.current.toggleProject('project-2'));
  assert.equal(first.result.current.isProjectExpanded('project-1'), true);
  assert.equal(first.result.current.isProjectExpanded('project-2'), true);
  first.unmount();
  const restored = renderController({ keepProjectsExpanded: true });
  assert.equal(restored.result.current.isProjectExpanded('project-1'), true);
  assert.equal(restored.result.current.isProjectExpanded('project-2'), true);
  act(() => restored.result.current.toggleProject('project-1'));
  assert.equal(restored.result.current.isProjectExpanded('project-1'), false);
  assert.equal(restored.result.current.isProjectExpanded('project-2'), true);
});

test('selecting a second project adds it instead of collapsing the first', () => {
  // `selectAndToggleProject` selects a row and opens it in one click, so the
  // selection effect must not treat that as "collapse everything else" while
  // the preference is on.
  const controller = renderController({ keepProjectsExpanded: true, selectedProject: PROJECTS[0] });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), true);
  act(() => controller.result.current.toggleProject('project-2'));
  controller.rerender({ keepProjectsExpanded: true, selectedProject: PROJECTS[1] });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), true);
  assert.equal(controller.result.current.isProjectExpanded('project-2'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY)!), ['project-1', 'project-2']);
});

test('selecting another project still collapses the rest with the preference off', () => {
  const controller = renderController({ selectedProject: PROJECTS[0] });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), true);
  act(() => controller.result.current.toggleProject('project-2'));
  controller.rerender({ selectedProject: PROJECTS[1] });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), false);
  assert.equal(controller.result.current.isProjectExpanded('project-2'), true);
});

test('hydrating the preference restores groups before writing browser storage', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(['saved-1', 'saved-2']));
  const controller = renderController();
  controller.rerender({ keepProjectsExpanded: true });
  assert.equal(controller.result.current.isProjectExpanded('saved-1'), true);
  assert.equal(controller.result.current.isProjectExpanded('saved-2'), true);
  controller.rerender({ keepProjectsExpanded: false });
  assert.equal(controller.result.current.isProjectExpanded('saved-2'), false);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY)!), ['saved-1', 'saved-2']);
});

test('invalid saved expansion data does not break navigation', () => {
  localStorage.setItem(STORAGE_KEY, 'invalid JSON');
  const { result } = renderController({ keepProjectsExpanded: true });
  act(() => result.current.toggleProject('project-1'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
});

test('only string project IDs are restored from browser storage', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(['saved-1', 5, null, {}, 'saved-2']));
  const { result } = renderController({ keepProjectsExpanded: true });
  assert.equal(result.current.isProjectExpanded('saved-1'), true);
  assert.equal(result.current.isProjectExpanded('saved-2'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY)!), ['saved-1', 'saved-2']);
});

test('unavailable browser storage does not prevent opening projects', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  const { result } = renderController({ keepProjectsExpanded: true });
  act(() => result.current.toggleProject('project-1'));
  act(() => result.current.toggleProject('project-2'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
  assert.equal(result.current.isProjectExpanded('project-2'), true);
});

test('Running groups keep their independent collapse state in multi-open mode', () => {
  const { result } = renderController({ keepProjectsExpanded: true });
  act(() => result.current.toggleProject('project-1'));
  act(() => result.current.setSearchMode('running'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
  act(() => result.current.toggleProject('project-1'));
  assert.equal(result.current.isProjectExpanded('project-1'), false);
  act(() => result.current.setSearchMode('projects'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
});

test('a selected project intentionally collapsed before reload stays collapsed', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(['other-project']));
  const controller = renderController({ keepProjectsExpanded: true, selectedProject: PROJECT });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), false);
  assert.equal(controller.result.current.isProjectExpanded('other-project'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem(STORAGE_KEY)!), ['other-project']);
  controller.rerender({ keepProjectsExpanded: true, selectedProject: { ...PROJECT, projectId: 'new-selection' } });
  assert.equal(controller.result.current.isProjectExpanded('new-selection'), true);
});

test('an empty saved set also preserves a collapsed selection restored after mount', () => {
  localStorage.setItem(STORAGE_KEY, '[]');
  const controller = renderController({ keepProjectsExpanded: true });
  controller.rerender({ keepProjectsExpanded: true, selectedProject: PROJECT });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), false);
  assert.equal(localStorage.getItem(STORAGE_KEY), '[]');
});

test('without saved expansion, initial project selection still opens normally', () => {
  const controller = renderController({ keepProjectsExpanded: true, selectedProject: PROJECT });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), true);
});
