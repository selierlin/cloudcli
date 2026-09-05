import { memo, useCallback, useRef } from 'react';
import type {
  TouchEvent as ReactTouchEvent,
} from 'react';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { QuickSettingsPanel } from '@/modules/quick-settings-panel';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const { sidebarOpen, setSidebarOpen } = useProjectSidebarState();

  // Edge-swipe to open the mobile sidebar drawer: a touch starting within the
  // left edge and dragging rightward past a threshold opens the menu, mirroring
  // the native drawer gesture. Only active on mobile, and ignored once the
  // drawer is already open (its backdrop handles closing).
  const edgeSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const EDGE_ZONE_PX = 32;
  const OPEN_THRESHOLD_PX = 60;

  const handleEdgeSwipeStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (!isMobile || sidebarOpen) {
        edgeSwipeStart.current = null;
        return;
      }
      const touch = event.touches[0];
      if (touch && touch.clientX <= EDGE_ZONE_PX) {
        edgeSwipeStart.current = { x: touch.clientX, y: touch.clientY };
      } else {
        edgeSwipeStart.current = null;
      }
    },
    [isMobile, sidebarOpen],
  );

  const handleEdgeSwipeMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (!isMobile || sidebarOpen || !edgeSwipeStart.current) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const dx = touch.clientX - edgeSwipeStart.current.x;
      const dy = touch.clientY - edgeSwipeStart.current.y;
      // Only a clearly horizontal rightward drag should open the drawer, so
      // vertical scrolling from the edge keeps working normally.
      if (dx > OPEN_THRESHOLD_PX && Math.abs(dy) < Math.abs(dx)) {
        setSidebarOpen(true);
        edgeSwipeStart.current = null;
      }
    },
    [isMobile, sidebarOpen, setSidebarOpen],
  );

  const handleEdgeSwipeEnd = useCallback(() => {
    edgeSwipeStart.current = null;
  }, []);

  return (
    <div
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
      onTouchStart={handleEdgeSwipeStart}
      onTouchMove={handleEdgeSwipeMove}
      onTouchEnd={handleEdgeSwipeEnd}
      onTouchCancel={handleEdgeSwipeEnd}
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
