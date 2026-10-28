import { memo, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, Edit3, Folder, MoreHorizontal, Star, Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { ActionMenu, type ActionMenuItem } from '@/shared/ui';
import { cn, copyTextToClipboard, isImeKeyEvent } from '@/shared/utils';
import type { LLMProvider, MCPServerStatus, Project, ProjectSession, SessionAttentionLevel, SessionWithProvider } from '@/shared/types';
import { getTaskIndicatorStatus } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import TaskIndicator from '@/modules/sidebar/TaskIndicator';
import SidebarProjectSessions from '@/modules/sidebar/SidebarProjectSessions';
import { ProjectAggregateSlot } from '@/modules/sidebar/SessionStatusIndicators';
import { deriveProjectAggregate } from '@/modules/sidebar/utils/projectAggregate';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import { useExpandScrollAnchor } from '@/modules/sidebar/hooks/useExpandScrollAnchor';

type SidebarProjectItemProps = {
  project: Project;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isExpanded: boolean;
  isDeleting: boolean;
  isStarred: boolean;
  /** Resolved for this row: only the project being renamed re-renders on a keystroke. */
  isEditing: boolean;
  renameDraft: string;
  sessions: SessionWithProvider[];
  initialSessionsLoaded: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  /** The session being renamed, when it belongs to this project. */
  sessionRenameId: string | null;
  sessionRenameDraft: string;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  onRenameDraftChange: (name: string) => void;
  onToggleProject: (projectId: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectId: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectId: string, nextName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onTogglePinned?: (sessionId: string, isPinned: boolean) => void;
  onRequestBatchArchive?: (sessionIds: string[], onCompleted: (archivedSessionIds: string[]) => void) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession?: (session: SessionWithProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  attentionSessions: ReadonlyMap<string, SessionAttentionLevel>;
  onNewSession: (project: Project) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

const getSessionCountDisplay = (project: Project, sessions: SessionWithProvider[]): string => {
  const total = Number(project.sessionMeta?.total ?? sessions.length);
  return String(total);
};

/** Rendered by SidebarProjectList for one project row, including its expand, rename, star and delete controls. */
function SidebarProjectItem({
  project,
  selectedProject,
  selectedSession,
  isExpanded,
  isDeleting,
  isStarred,
  isEditing,
  renameDraft,
  sessions,
  initialSessionsLoaded,
  isLoadingMoreSessions,
  currentTime,
  sessionRenameId,
  sessionRenameDraft,
  tasksEnabled,
  mcpServerStatus,
  onRenameDraftChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onTogglePinned,
  onRequestBatchArchive,
  onDeleteSession,
  onForkSession,
  onLoadMoreSessions,
  activeSessions,
  backgroundSessionIds,
  attentionSessions,
  onNewSession,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  t,
}: SidebarProjectItemProps) {
  // Project identity is tracked by the DB-assigned `projectId` everywhere
  // after the projectName → projectId migration.
  const isSelected = selectedProject?.projectId === project.projectId;
  const totalSessionCount = Number(project.sessionMeta?.total ?? sessions.length);
  const sessionCountDisplay = getSessionCountDisplay(project, sessions);
  // Both layouts show the tail of the path rather than its head: the last two
  // segments are what tells two checkouts of the same repo apart.
  const pathLabel = project.fullPath.length > 25 ? `...${project.fullPath.slice(-22)}` : project.fullPath;
  const taskStatus = getTaskIndicatorStatus(project, mcpServerStatus);
  // Batch-manage mode lives here rather than in the session list so the row's
  // aggregate can hide alongside it (D4); the list reads and toggles it through
  // props.
  const [isManagingSessions, setIsManagingSessions] = useState(false);
  // Derived at render, never stored (§6). Suppressed while the list is being
  // culled — a project's status is noise next to the checkboxes.
  const projectAggregate = isManagingSessions
    ? null
    : deriveProjectAggregate(sessions, activeSessions, backgroundSessionIds, attentionSessions);
  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Keeps this row pinned to its clicked viewport offset while the previously
  // expanded project collapses above it.
  const beginAnchor = useExpandScrollAnchor(isExpanded, rootRef);
  // "Copy path" keeps the menu open and flips its own label, the way the
  // session menus report a copy; closing the menu clears it.
  const [pathCopied, setPathCopied] = useState(false);
  // Shared by both layouts: the touch card used to keep rename and delete as
  // two always-visible icons of its own, which is how the phone ended up with a
  // red delete button on every project while desktop had a single "…".
  const projectMenuItems: ActionMenuItem[] = [
    {
      key: 'copy-path',
      // The absolute path, not the shortened label the row shows: this is
      // pasted into a terminal or an editor.
      label: pathCopied ? t('tooltips.projectPathCopied') : t('tooltips.copyProjectPath'),
      icon: pathCopied ? Check : Copy,
      closeOnSelect: false,
      onSelect: () => {
        void copyTextToClipboard(project.fullPath).then(setPathCopied);
      },
    },
    {
      key: 'favorite',
      label: isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites'),
      icon: Star,
      onSelect: () => onToggleStarProject(project.projectId),
    },
    {
      key: 'rename',
      label: t('tooltips.renameProject'),
      icon: Edit3,
      onSelect: () => onStartEditingProject(project),
    },
    {
      key: 'delete',
      label: t('tooltips.deleteProject'),
      icon: Trash2,
      onSelect: () => onDeleteProject(project),
      isDanger: true,
      showDividerBefore: true,
    },
  ];

  useEffect(() => {
    if (!isEditing || !mobileRenameInputRef.current) {
      return;
    }

    let animationFrame = 0;
    const revealInput = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        // `block: 'nearest'` (not 'center') leaves the input in place when it's
        // already visible. `block: 'center'` yanks it to the middle of the
        // viewport — and again on every keyboard resize — so it ends up behind
        // the on-screen keyboard on iOS.
        mobileRenameInputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };

    revealInput();
    window.visualViewport?.addEventListener('resize', revealInput);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.visualViewport?.removeEventListener('resize', revealInput);
    };
  }, [isEditing]);

  const isCompact = useCompactSidebar();

  const toggleProject = () => {
    // Only the expand direction moves this row: the previously expanded project
    // above it collapses at the same time and pulls the row up out of view.
    if (!isExpanded) {
      beginAnchor();
    }
    onToggleProject(project.projectId);
  };
  const toggleStarProject = () => onToggleStarProject(project.projectId);

  const saveProjectName = () => {
    onSaveProjectName(project.projectId, renameDraft);
  };

  const selectAndToggleProject = () => {
    // Selecting a project opens it through the controller's selection effect,
    // so selecting a group that is already open would re-expand it right after
    // this collapse. Only the opening direction moves the selection; collapsing
    // a group leaves the current selection alone, which is also what the
    // preference-off accordion does.
    if (!isExpanded && selectedProject?.projectId !== project.projectId) {
      onProjectSelect(project);
    }

    toggleProject();
  };

  return (
    <div
      ref={rootRef}
      // Marks the block boundary for useRevealPinnedBlockStart, which reads the
      // pinned header and the block's own top edge from the DOM.
      data-sidebar-project-block=""
      className={cn('md:space-y-1', isDeleting && 'opacity-50 pointer-events-none')}
    >
      {/* The opaque background is what makes this row's `hover:bg-accent/50`
          safe: without it a pinned header turns translucent on hover and the
          sessions scrolling underneath it show through the row. */}
      <div className="sticky top-0 z-10 bg-background md:group group">
        {isCompact && (
        <div className="bg-background">
          <div
            className={cn(
              'p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150',
              isSelected && 'bg-primary/5 border-primary/20',
            )}
            onClick={toggleProject}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  // The folder is the touch layout's counterpart to the dense
                  // row's leading glyph, and here it is the one favoriting
                  // target: a phone has no hover to reveal a hidden control, so
                  // the button stays visible. Amber when starred — matching the
                  // dense row — muted otherwise.
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-n-gray-500/10 transition-all duration-150 active:scale-90 dark:bg-n-gray-900/30"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleStarProject();
                  }}
                  aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                  title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
                >
                  <Folder
                    className={cn(
                      'h-4 w-4 transition-colors',
                      isStarred
                        ? 'text-amber-500 fill-amber-500'
                        : 'text-muted-foreground',
                    )}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      ref={mobileRenameInputRef}
                      type="text"
                      value={renameDraft}
                      onChange={(event) => onRenameDraftChange(event.target.value)}
                      className="w-full rounded-lg border-2 border-primary/40 bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-all duration-200 focus:border-primary focus:shadow-md focus:outline-none"
                      placeholder={t('projects.projectNamePlaceholder')}
                      autoFocus
                      autoComplete="off"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !isImeKeyEvent(event)) {
                          saveProjectName();
                        }

                        if (event.key === 'Escape' && !isImeKeyEvent(event)) {
                          // Cancelling the rename must not also close the code editor.
                          event.stopPropagation();
                          onCancelEditingProject();
                        }
                      }}
                      style={{
                        fontSize: '16px',
                        WebkitAppearance: 'none',
                        borderRadius: '8px',
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 items-center justify-between">
                        <h3 className="truncate text-sm font-normal text-foreground">{project.displayName}</h3>
                        {tasksEnabled && (
                          <TaskIndicator
                            status={taskStatus}
                            size="xs"
                            className="ml-2 hidden flex-shrink-0 md:inline-flex"
                          />
                        )}
                      </div>
                      {/* Same second line as the dense row: a bare "9 sessions"
                          was untranslated English that said nothing the count
                          alone does not. */}
                      <p className="truncate text-xs text-muted-foreground">
                        {totalSessionCount > 0 && <span className="opacity-60">{sessionCountDisplay} · </span>}
                        {project.fullPath !== project.displayName && (
                          <span className="opacity-60" title={project.fullPath}>
                            {pathLabel}
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                <ProjectAggregateSlot aggregate={projectAggregate} t={t} />
                {isEditing ? (
                  <>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-green-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveProjectName();
                      }}
                    >
                      <Check className="h-4 w-4 text-n-white" />
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-n-gray-500 shadow-sm transition-all duration-150 active:scale-90 active:shadow-none dark:bg-n-gray-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelEditingProject();
                      }}
                    >
                      <X className="h-4 w-4 text-n-white" />
                    </button>
                  </>
                ) : (
                  <>
                    {/* Same "…" as the dense row, always visible: a touch card
                        has no hover state to reveal a hidden trigger. */}
                    <div onClick={(event) => event.stopPropagation()}>
                      <ActionMenu
                        label={t('search.modeMore', 'More')}
                        ariaLabel={`${project.displayName} · ${t('search.modeMore', 'More')}`}
                        icon={MoreHorizontal}
                        iconOnly
                        portal
                        variant="ghost"
                        size="icon"
                        triggerClassName="h-8 w-8 text-muted-foreground"
                        onOpenChange={(open) => {
                          if (!open) setPathCopied(false);
                        }}
                        items={projectMenuItems}
                      />
                    </div>

                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted/30">
                      <ChevronRight className={cn(
                        'h-3 w-3 text-muted-foreground transition-transform duration-200',
                        isExpanded && 'rotate-90',
                      )} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {!isCompact && (
        // A plain container, not a <Button>: the star and the overflow menu are
        // real controls, and a <button> may not contain them. The whole row
        // still toggles on click; the name area carries its own focusable
        // button so keyboard users can reach it.
        <div
          className={cn(
            'group/project sticky top-0 z-10 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border-b border-border/30 p-2 text-sm font-normal transition-colors hover:bg-accent/50',
            // A starred row used to wash itself yellow, which said the same
            // thing as the filled star and added a third row background next to
            // selected/normal.
            isSelected ? 'bg-accent text-accent-foreground' : 'bg-background',
          )}
          onClick={selectAndToggleProject}
        >
          <div className="flex min-w-0 flex-1 items-center">
            {/* The leading folder is the row's identity glyph, and — like on the
                compact card — here it is the favoriting control too: click it
                to pin/unpin. Amber when starred, muted otherwise. */}
            <button
              type="button"
              aria-label={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
              title={isStarred ? t('tooltips.removeFromFavorites') : t('tooltips.addToFavorites')}
              className="mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
                toggleStarProject();
              }}
            >
              <Folder
                className={cn(
                  'h-4 w-4 transition-colors',
                  isStarred ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground',
                )}
              />
            </button>
            <div className="min-w-0 flex-1 text-left">
              {isEditing ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={renameDraft}
                    onChange={(event) => onRenameDraftChange(event.target.value)}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:ring-2 focus:ring-primary/20"
                    placeholder={t('projects.projectNamePlaceholder')}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !isImeKeyEvent(event)) {
                        saveProjectName();
                      }
                      if (event.key === 'Escape' && !isImeKeyEvent(event)) {
                        // Cancelling the rename must not also close the code editor.
                        event.stopPropagation();
                        onCancelEditingProject();
                      }
                    }}
                  />
                  <div className="truncate text-xs text-muted-foreground" title={project.fullPath}>
                    {project.fullPath}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={project.displayName}
                  className="w-full min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectAndToggleProject();
                  }}
                >
                  <span className="block truncate text-sm font-normal text-foreground" title={project.displayName}>
                    {project.displayName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {/* An empty project has nothing to count, and a leading "0"
                        on nine of the twelve rows reads as broken metadata. */}
                    {totalSessionCount > 0 && <span className="opacity-60">{sessionCountDisplay} · </span>}
                    {project.fullPath !== project.displayName && (
                      <span className="opacity-60" title={project.fullPath}>
                        {pathLabel}
                      </span>
                    )}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            <ProjectAggregateSlot aggregate={projectAggregate} t={t} />
            {isEditing ? (
              <>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-green-500 text-n-white transition-colors hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500"
                  onClick={(event) => {
                    event.stopPropagation();
                    saveProjectName();
                  }}
                >
                  <Check className="!h-3 !w-3" />
                </div>
                <div
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-n-gray-400 text-n-white transition-colors hover:bg-n-gray-500 dark:bg-n-gray-600 dark:hover:bg-n-gray-500"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingProject();
                  }}
                >
                  <X className="!h-3 !w-3" />
                </div>
              </>
            ) : (
              <>
                {/* Rename and delete used to sit here as two always-visible
                    icons — a third of the row, with the destructive one in red
                    for every project. One "…" keeps both reachable and stops
                    the row from advertising its own deletion.
                    The wrapper swallows the click because the row toggles on
                    click and ActionMenu has no onClick for its trigger. */}
                <div onClick={(event) => event.stopPropagation()}>
                  <ActionMenu
                    label={t('search.modeMore', 'More')}
                    // The row is also a button; a generic "More" would give a
                    // screen reader three identical menu triggers per list.
                    ariaLabel={`${project.displayName} · ${t('search.modeMore', 'More')}`}
                    icon={MoreHorizontal}
                    iconOnly
                    portal
                    variant="ghost"
                    size="icon"
                    triggerClassName="h-6 w-6 touch:opacity-100 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
                    onOpenChange={(open) => {
                      if (!open) setPathCopied(false);
                    }}
                    items={projectMenuItems}
                  />
                </div>
                <ChevronRight className={cn(
                  'mr-1.5 h-4 w-4 text-muted-foreground transition-all duration-200 group-hover:text-foreground',
                  isExpanded && 'rotate-90',
                )} />
              </>
            )}
          </div>
        </div>
        )}
      </div>

      <SidebarProjectSessions
        project={project}
        isExpanded={isExpanded}
        isManaging={isManagingSessions}
        onManagingChange={setIsManagingSessions}
        sessions={sessions}
        selectedSession={selectedSession}
        initialSessionsLoaded={initialSessionsLoaded}
        hasMoreSessions={Boolean(project.sessionMeta?.hasMore)}
        isLoadingMoreSessions={isLoadingMoreSessions}
        activeSessions={activeSessions}
        backgroundSessionIds={backgroundSessionIds}
        attentionSessions={attentionSessions}
        currentTime={currentTime}
        sessionRenameId={sessionRenameId}
        sessionRenameDraft={sessionRenameDraft}
        onRenameDraftChange={onRenameDraftChange}
        onStartEditingSession={onStartEditingSession}
        onCancelEditingSession={onCancelEditingSession}
        onSaveEditingSession={onSaveEditingSession}
        onProjectSelect={onProjectSelect}
        onSessionSelect={onSessionSelect}
        onTogglePinned={onTogglePinned}
        onRequestBatchArchive={onRequestBatchArchive}
        onDeleteSession={onDeleteSession}
        onForkSession={onForkSession}
        onLoadMoreSessions={onLoadMoreSessions}
        onNewSession={onNewSession}
        t={t}
      />
    </div>
  );
}

/**
 * Memoized: a websocket session delta re-renders the sidebar roughly every
 * 0.5-2s during a run, and a rename keystroke re-renders it per character.
 *
 * Both renames are resolved to scalars by SidebarProjectList and the sorted
 * session array is cached per project, so a keystroke changes props on exactly
 * one row and every other row's compare succeeds. See sidebarRowProps.test.tsx.
 */
export default memo(SidebarProjectItem);
