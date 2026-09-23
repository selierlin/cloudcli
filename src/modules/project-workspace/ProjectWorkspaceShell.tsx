import { memo, useCallback } from 'react';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useSidebarSwipeGesture } from '@/modules/project-workspace/hooks/useSidebarSwipeGesture';
import { QuickSettingsPanel } from '@/modules/quick-settings-panel';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';

/** Width of the invisible strip along the left edge where the open-drawer swipe may begin. */
const EDGE_ZONE_PX = 32;

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const { sidebarOpen, setSidebarOpen } = useProjectSidebarState();

  const handleOpenSwipe = useCallback(() => {
    setSidebarOpen(true);
  }, [setSidebarOpen]);

  // Edge-swipe to open the mobile sidebar drawer: a touch starting within the
  // left edge and dragging rightward past the threshold opens the menu, mirroring
  // the native drawer gesture. Only active on mobile, and disarmed once the drawer
  // is open — swiping it shut is ProjectSidebarRegion's job.
  const openSwipeHandlers = useSidebarSwipeGesture({
    enabled: isMobile && !sidebarOpen,
    direction: 'right',
    startZonePx: EDGE_ZONE_PX,
    onSwipe: handleOpenSwipe,
  });

  return (
    <div
      // `bottom` tracks --keyboard-height, so the virtual keyboard lifts the
      // shell. The transition animates that lift, and the transcript's
      // bottom-edge scroll compensation runs per frame inside the same
      // transition, which is what keeps the chat rows gliding in lockstep
      // with the input rather than snapping. The global reduced-motion rule
      // disables it for those users.
      className="fixed inset-0 flex bg-background transition-[bottom] duration-[250ms] ease-out"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
      onTouchStart={openSwipeHandlers.onTouchStart}
      onTouchMove={openSwipeHandlers.onTouchMove}
      onTouchEnd={openSwipeHandlers.onTouchEnd}
      onTouchCancel={openSwipeHandlers.onTouchCancel}
    >
      <ProjectEffects navigate={navigate} />
      <ProjectSidebarRegion isMobile={isMobile} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ProjectMainRegion
          isMobile={isMobile}
          ws={ws}
          sendMessage={sendMessage}
          navigate={navigate}
        />
      </div>

      <ProjectCommandPalette />
      <QuickSettingsPanel />
    </div>
  );
}

export default memo(ProjectWorkspaceShell);
