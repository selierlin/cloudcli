import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { SESSION_OWNERSHIP_DRAG_MIME } from '@/shared/constants';
import type { LLMProvider, Project, ProjectSession, SessionAttentionLevel, SessionWithProvider } from '@/shared/types';
import SidebarSessionItem from '@/modules/sidebar/SidebarSessionItem';
import SidebarBatchSessionActions from '@/modules/sidebar/SidebarBatchSessionActions';
import { useSessionParentPicker } from '@/modules/sidebar/context/SessionParentPickerContext';
import { buildProjectSessionTree } from '@/modules/sidebar/utils/projectSessionTree';

const FORK_INDENT_PX = 12;
const MAX_FORK_INDENT_DEPTH = 4;

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  /**
   * Batch-manage mode, owned by `SidebarProjectItem` so the project row can
   * hide its aggregate indicator while the list is being culled (§4 通道 D,
   * D4). Lifting it is what keeps the row and the list in agreement.
   */
  isManaging: boolean;
  onManagingChange: (managing: boolean) => void;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
  attentionSessions: ReadonlyMap<string, SessionAttentionLevel>;
  currentTime: Date;
  /** The session being renamed, when it belongs to this project. */
  sessionRenameId: string | null;
  sessionRenameDraft: string;
  onRenameDraftChange: (draft: string) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onTogglePinned?: (sessionId: string, isPinned: boolean) => void;
  onRequestBatchArchive?: (sessionIds: string[], onCompleted: (archivedSessionIds: string[]) => void) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onForkSession?: (session: SessionWithProvider) => void;
  onLoadMoreSessions: (projectId: string) => void;
  t: TFunction;
};

// Stable stand-in for a missing onTogglePinned so every row is handed the same
// callback identity and its memo boundary can bail (see sidebarRowProps.test.tsx).
const NOOP_TOGGLE_PINNED = () => {};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/** Rendered by SidebarProjectItem to show an expanded project's sessions, delegating each row to SidebarSessionItem. */
export default function SidebarProjectSessions({
  project,
  isExpanded,
  isManaging,
  onManagingChange,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  backgroundSessionIds,
  attentionSessions,
  currentTime,
  sessionRenameId,
  sessionRenameDraft,
  onRenameDraftChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onTogglePinned,
  onRequestBatchArchive,
  onArchiveSession,
  onDeleteSession,
  onForkSession,
  onLoadMoreSessions,
  t,
}: SidebarProjectSessionsProps) {
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const treeRows = useMemo(() => buildProjectSessionTree(sessions, project.projectId), [sessions, project.projectId]);
  const selectedSessionId = selectedSession?.id ?? null;
  const targetAncestors = useMemo(() => {
    const parents = new Map(treeRows.map((row) => [row.session.id, row.parentId]));
    const reveal = new Set<string>();
    for (const target of [selectedSessionId, sessionRenameId]) {
      let parentId = target ? parents.get(target) : null;
      while (parentId && !reveal.has(parentId)) {
        reveal.add(parentId);
        parentId = parents.get(parentId);
      }
    }
    return reveal;
  }, [treeRows, selectedSessionId, sessionRenameId]);
  // Retain explicit branch collapses, while revealing a newly selected or renamed descendant.
  const [forkTreeState, setForkTreeState] = useState(() => ({
    targetAncestors, selectedSessionId, sessionRenameId, collapsedForks: new Set<string>(),
  }));
  const { collapsedForks } = forkTreeState;

  // Reveal a newly selected/renamed fork before committing a hidden row. Later
  // title/activity updates must not undo an explicit collapse by the user.
  if (forkTreeState.selectedSessionId !== selectedSessionId
    || forkTreeState.sessionRenameId !== sessionRenameId
    || forkTreeState.targetAncestors.size !== targetAncestors.size
    || [...targetAncestors].some((id) => !forkTreeState.targetAncestors.has(id))) {
    setForkTreeState({
      targetAncestors, selectedSessionId, sessionRenameId,
      collapsedForks: new Set([...collapsedForks].filter((id) => !targetAncestors.has(id))),
    });
  }

  const visibleRows = useMemo(() => {
    let hiddenBelowDepth = Infinity;
    const visible: (typeof treeRows[number] & { continuationDepths: number[] })[] = [];
    const continuingAncestors = new Set<number>();
    for (const row of treeRows) {
      if (row.depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = row.hasChildren && collapsedForks.has(row.session.id) ? row.depth : Infinity;
      // Keep sibling rails running through an expanded child's descendants.
      // Only visible columns are retained, so a deep chain stays linear in size.
      for (const depth of continuingAncestors) {
        if (depth >= row.depth) continuingAncestors.delete(depth);
      }
      visible.push({ ...row, continuationDepths: [...continuingAncestors] });
      if (row.depth > 0 && row.depth < MAX_FORK_INDENT_DEPTH && !row.isLastSibling) {
        continuingAncestors.add(row.depth);
      }
    }
    return visible;
  }, [treeRows, collapsedForks]);
  const hasForks = treeRows.some((row) => row.hasChildren);

  // Sessions that started a response can no longer be archived in bulk, so
  // prune the selection as sessions come and go (e.g. a session starts a run
  // while manage mode is open). A session only running background work is
  // still deletable, so it stays selected. Returning `current` untouched when
  // nothing changed lets React skip the re-render, keeping the row render count
  // stable (see sidebarRowProps.test.tsx).
  useEffect(() => {
    setSelectedSessionIds((current) => {
      if (current.size === 0) {
        return current;
      }
      const availableSessionIds = new Set(
        sessions
          .filter((session) => !(activeSessions.has(session.id) && !backgroundSessionIds.has(session.id)))
          .map((session) => session.id),
      );
      const next = new Set([...current].filter((sessionId) => availableSessionIds.has(sessionId)));
      return next.size === current.size ? current : next;
    });
  }, [activeSessions, backgroundSessionIds, sessions]);

  const hasSessions = sessions.length > 0;
  // A session with a response in flight cannot be archived in bulk — the same
  // rule the row's options menu applies — so it is not selectable either.
  // Sessions only running background work stay deletable, and so selectable.
  const isSessionRunning = (session: SessionWithProvider) =>
    activeSessions.has(session.id) && !backgroundSessionIds.has(session.id);
  const selectableSessionIds = sessions
    .filter((session) => !isSessionRunning(session))
    .map((session) => session.id);
  const areAllSelectableSessionsSelected = selectableSessionIds.length > 0
    && selectableSessionIds.every((sessionId) => selectedSessionIds.has(sessionId));

  const toggleBatchSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    setSelectedSessionIds(
      areAllSelectableSessionsSelected ? new Set() : new Set(selectableSessionIds),
    );
  };

  // The parent picker provider owns the persistence; a drag here is only another
  // way to trigger the same move. Absent outside the sidebar (and in tests that
  // render this list bare), in which case rows offer no drag handle.
  const parentPicker = useSessionParentPicker();
  const setSessionParent = parentPicker?.setSessionParent;

  // Which session of this project is being dragged. Deliberately local to the
  // list rather than global: a drag can then never be picked up by another
  // project's rows, which is the same-project rule enforced structurally instead
  // of by a check that could be forgotten.
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  // The row under the pointer, highlighted as the drop target. Also the list's
  // state rather than the row's: a cancelled drag fires no dragleave, so a row
  // that owned the flag could keep a ring forever (see the row's drag handler).
  const [dropTargetSessionId, setDropTargetSessionId] = useState<string | null>(null);

  const beginSessionDrag = useCallback((sessionId: string) => {
    setDraggingSessionId(sessionId);
    setDropTargetSessionId(null);
  }, []);

  const endSessionDrag = useCallback(() => {
    setDraggingSessionId(null);
    setDropTargetSessionId(null);
  }, []);

  const dropSessionOnRow = useCallback((targetSessionId: string) => {
    if (draggingSessionId && draggingSessionId !== targetSessionId) {
      setSessionParent?.(draggingSessionId, targetSessionId);
    }
    setDraggingSessionId(null);
    setDropTargetSessionId(null);
  }, [draggingSessionId, setSessionParent]);

  // Blank space between the rows is the "move out" drop zone: a row stops the
  // event on its way down (it is either a target itself or deliberately inert),
  // so whatever reaches here is not over a session — which also means no row
  // should be highlighted.
  const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingSessionId || !event.dataTransfer?.types.includes(SESSION_OWNERSHIP_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetSessionId(null);
  };

  // Leaving the list entirely (for the project header above it, say) stops the
  // dragover stream, so this is what drops the highlight. Moves inside the list
  // reach this too and are ignored, so the highlight does not flicker.
  const handleListDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setDropTargetSessionId(null);
  };

  const handleListDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingSessionId || !event.dataTransfer?.types.includes(SESSION_OWNERSHIP_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
    setSessionParent?.(draggingSessionId, null);
    setDraggingSessionId(null);
    setDropTargetSessionId(null);
  };

  const renderSessionRow = (session: SessionWithProvider) => (
    <SidebarSessionItem
      project={project}
      session={session}
      selectedSession={selectedSession}
      isProcessing={isSessionRunning(session)}
      isManaging={isManaging}
      isBatchSelected={selectedSessionIds.has(session.id)}
      hasBackgroundWork={backgroundSessionIds.has(session.id)}
      attentionLevel={attentionSessions.get(session.id)}
      currentTime={currentTime}
      onRenameDraftChange={onRenameDraftChange}
      isEditing={session.id === sessionRenameId}
      renameDraft={session.id === sessionRenameId ? sessionRenameDraft : ''}
      onStartEditingSession={onStartEditingSession}
      onCancelEditingSession={onCancelEditingSession}
      onSaveEditingSession={onSaveEditingSession}
      onProjectSelect={onProjectSelect}
      onSessionSelect={onSessionSelect}
      onTogglePinned={onTogglePinned ?? NOOP_TOGGLE_PINNED}
      onArchiveSession={onArchiveSession}
      onToggleBatchSelection={toggleBatchSelection}
      onDeleteSession={onDeleteSession}
      onForkSession={onForkSession}
      draggingSessionId={draggingSessionId}
      isDropHighlighted={dropTargetSessionId === session.id}
      onSessionDragStart={beginSessionDrag}
      onSessionDragEnd={endSessionDrag}
      onSessionDragOver={setDropTargetSessionId}
      onSessionDropOnRow={dropSessionOnRow}
      t={t}
    />
  );

  const exitManaging = () => {
    onManagingChange(false);
    setSelectedSessionIds(new Set());
  };

  const requestBatchArchive = () => {
    onRequestBatchArchive?.([...selectedSessionIds], (archivedSessionIds) => {
      const archivedSessionIdSet = new Set(archivedSessionIds);
      setSelectedSessionIds((current) => new Set(
        [...current].filter((sessionId) => !archivedSessionIdSet.has(sessionId)),
      ));
      if (archivedSessionIds.length === selectedSessionIds.size) {
        onManagingChange(false);
      }
    });
  };

  return (
    <>
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out',
        isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
    >
    <div className="overflow-hidden">
    <div
      className="ml-3 space-y-1 border-l border-border pl-3"
      data-testid="project-session-list"
      onDragOver={handleListDragOver}
      onDragLeave={handleListDragLeave}
      onDrop={handleListDrop}
    >
      {/* A page emptied by deleting every loaded row still has sessions behind
          it on the server, so it keeps its "Load more" instead of "No sessions". */}
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions && !hasMoreSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          {/* Spacing lives inside each row (its `py-0.5`) rather than between
              siblings, so the fork rails are not cut into 4px segments. */}
          <div data-testid="project-session-tree">
            {visibleRows.map(({ session, parentId, depth, hasChildren, isLastSibling, continuationDepths }) => (
              <div
                key={session.id}
                data-session-id={session.id}
                data-parent-session-id={parentId ?? undefined}
                data-fork-depth={depth}
                data-fork-branch={hasChildren || undefined}
                className="relative flex min-w-0 items-stretch py-0.5"
                style={depth > 0 ? { paddingLeft: `${Math.min(depth, MAX_FORK_INDENT_DEPTH) * FORK_INDENT_PX}px` } : undefined}
              >
                {parentId && (
                  <span
                    aria-hidden="true"
                    data-fork-connector={isLastSibling ? 'last' : 'branch'}
                    className="pointer-events-none absolute inset-y-0"
                    style={{ left: `${(Math.min(depth, MAX_FORK_INDENT_DEPTH) - 1) * FORK_INDENT_PX + FORK_INDENT_PX / 2}px`, width: `${FORK_INDENT_PX}px` }}
                  >
                    <span className={cn('absolute left-0 top-0 border-l border-muted-foreground/50', isLastSibling ? 'bottom-1/2' : 'bottom-0')} />
                    <span className="absolute left-0 top-1/2 border-t border-muted-foreground/50" style={{ width: hasChildren ? '6px' : '12px' }} />
                  </span>
                )}
                {continuationDepths.map((ancestorDepth) => (
                  <span
                    key={ancestorDepth}
                    aria-hidden="true"
                    data-fork-continuation={ancestorDepth}
                    className="pointer-events-none absolute inset-y-0 border-l border-muted-foreground/50"
                    style={{ left: `${(ancestorDepth - 1) * FORK_INDENT_PX + FORK_INDENT_PX / 2}px` }}
                  />
                ))}
                {hasChildren && !collapsedForks.has(session.id) && (
                  <span
                    aria-hidden="true"
                    data-fork-stem=""
                    className="pointer-events-none absolute bottom-0 border-l border-muted-foreground/50"
                    style={{ left: `${Math.min(depth, MAX_FORK_INDENT_DEPTH - 1) * FORK_INDENT_PX + FORK_INDENT_PX / 2}px`, top: 'calc(50% + 7px)' }}
                  />
                )}
                {hasForks && (
                  hasChildren ? (
                    <button
                      type="button"
                      className="relative flex w-3 flex-shrink-0 items-center justify-center rounded text-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={!collapsedForks.has(session.id)}
                      aria-label={collapsedForks.has(session.id)
                        ? t('sessions.expandForks', { session: session.summary || session.name || t('projects.newSession') })
                        : t('sessions.collapseForks', { session: session.summary || session.name || t('projects.newSession') })}
                      onClick={() => setForkTreeState((previous) => {
                        const next = new Set(previous.collapsedForks);
                        if (next.has(session.id)) next.delete(session.id);
                        else next.add(session.id);
                        return { ...previous, collapsedForks: next };
                      })}
                    >
                      <ChevronRight className={cn('h-3 w-3 transition-transform', !collapsedForks.has(session.id) && 'rotate-90')} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  ) : <span className="w-3 flex-shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  {renderSessionRow(session)}
                </div>
              </div>
            ))}
          </div>

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load more sessions'}
            </Button>
          )}
        </>
      )}
    </div>
    </div>
    </div>

    {isManaging && isExpanded && hasSessions && (
      // Outside the collapse-animation wrapper above: that wrapper's
      // `overflow-hidden` is itself a scroll container, so `sticky bottom-0`
      // would stick within it and strand the bar at the end of the session
      // list instead of the sidebar's bottom edge. `isExpanded` hides the bar
      // if the project is collapsed while manage mode is open.
      <SidebarBatchSessionActions
        selectedCount={selectedSessionIds.size}
        selectableCount={selectableSessionIds.length}
        areAllSelected={areAllSelectableSessionsSelected}
        onToggleSelectAll={toggleSelectAll}
        onArchive={requestBatchArchive}
        onCancel={exitManaging}
        t={t}
      />
    )}
    </>
  );
}
