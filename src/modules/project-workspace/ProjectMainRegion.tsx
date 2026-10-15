import { memo, useCallback, useEffect } from 'react';

import { useProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { SessionEstablishedContext, SessionNavigationOptions,ProjectWorkspaceShellProps } from '@/shared/types';
import WorkspaceMain from '@/modules/project-workspace/WorkspaceMain';
import { dismissSplash } from '@/utils/splash';

/** Rendered by ProjectWorkspaceShell to bind this module's project state to WorkspaceMain. */
function ProjectMainRegion({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    setActiveTab,
    setSidebarOpen,
    isLoadingProjects,
    openSettings,
    externalMessageUpdate,
    newSessionTrigger,
    registerOptimisticSession,
    registerForkedSession,
    handleProjectSelect,
    refreshProjectsSilently,
    renameSession,
  } = useProjectMainState();

  const handleOpenSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    options?: SessionNavigationOptions,
  ) => {
    navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) });
  }, [navigate]);

  const handleSessionEstablished = useCallback((
    targetSessionId: string,
    context: SessionEstablishedContext,
  ) => {
    registerOptimisticSession({ sessionId: targetSessionId, ...context });
  }, [registerOptimisticSession]);

  // A fork's tree row arrives over the websocket; this only bridges the
  // separate Conversations feed so the new session shows there immediately.
  const handleSessionForked = useCallback((
    targetSessionId: string,
    context: SessionEstablishedContext,
  ) => {
    registerForkedSession({ sessionId: targetSessionId, ...context });
  }, [registerForkedSession]);

  const handleProjectsRefresh = useCallback(() => {
    void refreshProjectsSilently();
  }, [refreshProjectsSilently]);

  // Main-content project loading is the content-ready boundary for the routed
  // app; ProtectedRoute only dismisses the splash on non-content branches, so
  // the launch splash stays up through the workspace load and never flashes it.
  useEffect(() => {
    if (!isLoadingProjects) {
      dismissSplash();
    }
  }, [isLoadingProjects]);

  return (
    <WorkspaceMain
      projects={projects}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      ws={ws}
      sendMessage={sendMessage}
      isMobile={isMobile}
      onMenuClick={handleOpenSidebar}
      isLoading={isLoadingProjects}
      onNavigateToSession={handleNavigateToSession}
      onSessionEstablished={handleSessionEstablished}
      onSessionForked={handleSessionForked}
      onShowSettings={openSettings}
      externalMessageUpdate={externalMessageUpdate}
      newSessionTrigger={newSessionTrigger}
      onProjectSelect={handleProjectSelect}
      onProjectsRefresh={handleProjectsRefresh}
      onRenameSession={renameSession}
    />
  );
}

export default memo(ProjectMainRegion);
