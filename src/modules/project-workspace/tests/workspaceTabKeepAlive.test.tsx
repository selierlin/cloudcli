import assert from 'node:assert/strict';

import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { AppTab, Project } from '@/shared/types';
import WorkspaceMain from '@/modules/project-workspace/WorkspaceMain';

/**
 * Regression guard for the files and git tabs losing their browsing state on
 * every tab switch. They used to be conditionally rendered, so switching away
 * unmounted them and React dropped their `useState` (expanded folders, the
 * active git view). They now mount on first visit and are only hidden, the same
 * keep-alive the chat, tasks and browser tabs already get.
 */

vi.mock('@/modules/chat', () => ({ ChatInterface: () => <div data-testid="chat" /> }));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => <div data-testid="file-tree" /> }));
vi.mock('@/modules/git-panel', () => ({ GitPanel: () => <div data-testid="git-panel" /> }));
vi.mock('@/modules/standalone-shell', () => ({ StandaloneShell: () => <div data-testid="shell" /> }));
vi.mock('@/modules/plugins', () => ({ PluginTabContent: () => null }));
vi.mock('@/modules/browser-use', () => ({
  BrowserUsePanel: () => null,
  useBrowserUseEnabled: () => false,
}));
vi.mock('@/modules/command-palette', () => ({ usePaletteOpsRegister: () => {} }));
vi.mock('@/modules/task-master', () => ({
  TaskMasterPanel: () => null,
  useTaskMasterProjectSync: () => {},
  useTasksSettings: () => ({ tasksEnabled: false, isTaskMasterInstalled: false }),
}));
vi.mock('@/modules/code-editor', () => ({
  EditorSidebar: () => null,
  useEditorSidebar: () => ({
    editingFile: null,
    editorWidth: 600,
    editorExpanded: false,
    hasManualWidth: false,
    resizeHandleRef: { current: null },
    handleFileOpen: () => {},
    handleCloseEditor: () => {},
    handleToggleEditorExpand: () => {},
    handleResizeStart: () => {},
  }),
}));
vi.mock('@/shared/context/UiPreferencesContext', () => ({
  useUiPreferences: () => ({ showRawParameters: false, showThinking: false, sendByCtrlEnter: false }),
}));
vi.mock('@/modules/project-workspace/hooks/useFileOpenResolver', () => ({
  useFileOpenResolver: () => () => {},
}));
vi.mock('@/modules/project-workspace/WorkspaceHeader', () => ({ default: () => null }));
vi.mock('@/modules/project-workspace/WorkspaceErrorBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

/** Drives WorkspaceMain through tab switches without mocking the tab state itself. */
function Harness({ initialTab }: { initialTab: AppTab }) {
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);

  return (
    <>
      {(['chat', 'files', 'git'] as const).map((tab) => (
        <button key={tab} type="button" onClick={() => setActiveTab(tab)}>
          {`to-${tab}`}
        </button>
      ))}
      <WorkspaceMain
        projects={[project]}
        selectedProject={project}
        selectedSession={null}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        ws={null}
        sendMessage={() => {}}
        isMobile={false}
        onMenuClick={() => {}}
        isLoading={false}
        onNavigateToSession={() => {}}
        onSessionEstablished={() => {}}
        onShowSettings={() => {}}
        onRenameSession={async () => false}
        externalMessageUpdate={0}
        newSessionTrigger={0}
        onProjectSelect={() => {}}
        onProjectsRefresh={() => {}}
      />
    </>
  );
}

test('files and git stay unmounted until their tab is visited', () => {
  render(<Harness initialTab="chat" />);

  assert.ok(screen.queryByTestId('file-tree') === null, 'file tree mounts before its tab is visited');
  assert.ok(screen.queryByTestId('git-panel') === null, 'git panel mounts before its tab is visited');
});

test('the file tree survives leaving and re-entering the files tab', () => {
  render(<Harness initialTab="chat" />);

  fireEvent.click(screen.getByText('to-files'));
  const tree = screen.getByTestId('file-tree');
  assert.ok(tree.parentElement?.classList.contains('hidden') === false, 'tree is shown while files is active');

  fireEvent.click(screen.getByText('to-chat'));
  assert.ok(screen.queryByTestId('file-tree') === tree, 'file tree was unmounted, so its browsing state was lost');
  assert.ok(tree.parentElement?.classList.contains('hidden') === true, 'a kept-alive panel stays hidden off-tab');

  fireEvent.click(screen.getByText('to-files'));
  assert.ok(screen.queryByTestId('file-tree') === tree, 'returning to files remounted the tree');
  assert.ok(tree.parentElement?.classList.contains('hidden') === false, 'tree is shown again after returning');
});

test('the git panel survives leaving and re-entering the git tab', () => {
  render(<Harness initialTab="chat" />);

  fireEvent.click(screen.getByText('to-files'));
  assert.ok(screen.queryByTestId('git-panel') === null, 'visiting files must not mount the git panel');

  fireEvent.click(screen.getByText('to-git'));
  const panel = screen.getByTestId('git-panel');

  fireEvent.click(screen.getByText('to-chat'));
  assert.ok(screen.queryByTestId('git-panel') === panel, 'git panel was unmounted, so its active view was lost');
  assert.ok(panel.parentElement?.classList.contains('hidden') === true, 'a kept-alive panel stays hidden off-tab');
});
