import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, test, vi } from 'vitest';

import type { MCPServerStatus, Project } from '@/shared/types';

/**
 * A click on a project row both selects the project and toggles its group. The
 * selection effect in the controller expands the selected project, so selecting
 * a group that is already open re-expanded it right after the collapse: the row
 * looked like "select only" and could never be closed again. Only the opening
 * direction may move the selection.
 */

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => false,
}));

vi.mock('@/modules/sidebar/hooks/useExpandScrollAnchor', () => ({
  useExpandScrollAnchor: () => () => undefined,
}));

vi.mock('@/modules/sidebar/SidebarProjectSessions', () => ({
  default: () => null,
}));

const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

const t = ((key: string) => key) as unknown as TFunction;
const noop = () => undefined;

const PROJECT = {
  projectId: 'project-2',
  name: 'project-2',
  displayName: 'project two',
  fullPath: '/repo/two',
  sessions: [],
  sessionMeta: { total: 0 },
} as unknown as Project;

type RowOptions = {
  isExpanded: boolean;
  isSelected: boolean;
};

const renderRow = ({ isExpanded, isSelected }: RowOptions) => {
  const onProjectSelect = vi.fn();
  const onToggleProject = vi.fn();
  const view = render(
    <SidebarProjectItem
      project={PROJECT}
      selectedProject={isSelected ? PROJECT : null}
      selectedSession={null}
      isExpanded={isExpanded}
      isDeleting={false}
      isStarred={false}
      isEditing={false}
      renameDraft=""
      sessions={[]}
      initialSessionsLoaded
      isLoadingMoreSessions={false}
      currentTime={new Date()}
      sessionRenameId={null}
      sessionRenameDraft=""
      tasksEnabled={false}
      mcpServerStatus={{} as MCPServerStatus}
      onRenameDraftChange={noop}
      onToggleProject={onToggleProject}
      onProjectSelect={onProjectSelect}
      onToggleStarProject={noop}
      onStartEditingProject={noop}
      onCancelEditingProject={noop}
      onSaveProjectName={noop}
      onDeleteProject={noop}
      onSessionSelect={noop}
      onDeleteSession={noop}
      onLoadMoreSessions={noop}
      activeSessions={new Set()}
      backgroundSessionIds={new Set()}
      attentionSessions={new Map()}
      onNewSession={noop}
      onStartEditingSession={noop}
      onCancelEditingSession={noop}
      onSaveEditingSession={noop}
      t={t}
    />,
  );

  // Exact name: the row's accessible name is the project name, while the
  // overflow menu next to it is named "<project> · More".
  const row = view.getByRole('button', { name: 'project two' });
  return { ...view, row, onProjectSelect, onToggleProject };
};

afterEach(() => {
  vi.clearAllMocks();
});

test('clicking a collapsed group selects it and opens it', () => {
  const { row, onProjectSelect, onToggleProject } = renderRow({ isExpanded: false, isSelected: false });

  fireEvent.click(row);

  assert.equal(onProjectSelect.mock.calls.length, 1, 'the selection follows the user into the group it opens');
  assert.equal(onToggleProject.mock.calls.length, 1);
});

test('clicking an already open group collapses it without moving the selection', () => {
  const { row, onProjectSelect, onToggleProject } = renderRow({ isExpanded: true, isSelected: false });

  fireEvent.click(row);

  assert.equal(
    onProjectSelect.mock.calls.length,
    0,
    'selecting an open group would make the controller expand it again',
  );
  assert.equal(onToggleProject.mock.calls.length, 1);
});

test('clicking the group that is already open and selected still collapses it', () => {
  const { row, onProjectSelect, onToggleProject } = renderRow({ isExpanded: true, isSelected: true });

  fireEvent.click(row);

  assert.equal(onProjectSelect.mock.calls.length, 0);
  assert.equal(onToggleProject.mock.calls.length, 1);
});
