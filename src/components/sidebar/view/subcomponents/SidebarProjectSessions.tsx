import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { SessionActivityMap } from '../../../../hooks/useSessionProtection';
import type { Project, ProjectSession, LLMProvider } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';

import SidebarSessionItem from './SidebarSessionItem';
import SidebarBatchSessionActions from './SidebarBatchSessionActions';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  activeSessions: SessionActivityMap;
  attentionSessionIds: ReadonlySet<string>;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onTogglePinned: (sessionId: string, isPinned: boolean) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onRequestBatchArchive: (sessionIds: string[], onCompleted: (archivedSessionIds: string[]) => void) => void;
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

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

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  activeSessions,
  attentionSessionIds,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onTogglePinned,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onRequestBatchArchive,
  onLoadMoreSessions,
  onNewSession,
  t,
}: SidebarProjectSessionsProps) {
  const hasSessions = sessions.length > 0;
  const [isManaging, setIsManaging] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedSessionIds((current) => {
      const availableSessionIds = new Set(
        sessions
          .filter((session) => !activeSessions.has(session.id))
          .map((session) => session.id),
      );
      return new Set([...current].filter((sessionId) => availableSessionIds.has(sessionId)));
    });
  }, [activeSessions, sessions]);

  const selectableSessionIds = sessions
    .filter((session) => !activeSessions.has(session.id))
    .map((session) => session.id);
  const areAllSelectableSessionsSelected = selectableSessionIds.length > 0
    && selectableSessionIds.every((sessionId) => selectedSessionIds.has(sessionId));

  const toggleBatchSelection = (sessionId: string) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedSessionIds(
      areAllSelectableSessionsSelected ? new Set() : new Set(selectableSessionIds),
    );
  };

  const exitManaging = () => {
    setIsManaging(false);
    setSelectedSessionIds(new Set());
  };

  const requestBatchArchive = () => {
    onRequestBatchArchive([...selectedSessionIds], (archivedSessionIds) => {
      const archivedSessionIdSet = new Set(archivedSessionIds);
      setSelectedSessionIds((current) => new Set(
        [...current].filter((sessionId) => !archivedSessionIdSet.has(sessionId)),
      ));
      if (archivedSessionIds.length === selectedSessionIds.size) {
        setIsManaging(false);
      }
    });
  };

  if (!isExpanded) {
    return null;
  }

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="grid grid-cols-2 gap-1 px-3 pb-1 pt-1 md:hidden">
        {!isManaging && <button
          className="flex h-8 items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          onClick={() => {
            onProjectSelect(project);
            onNewSession(project);
          }}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </button>}
        <Button
          variant="ghost"
          size="sm"
          className={isManaging ? 'col-span-2 h-8 text-xs' : 'h-8 text-xs'}
          onClick={() => (isManaging ? exitManaging() : setIsManaging(true))}
          disabled={!hasSessions && !isManaging}
        >
          {isManaging ? t('actions.cancel') : t('sessions.manageSessions')}
        </Button>
      </div>

      <div className="hidden gap-1 md:flex">
        {!isManaging && <Button
          variant="default"
          size="sm"
          className="h-8 flex-1 justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={() => onNewSession(project)}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </Button>}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => (isManaging ? exitManaging() : setIsManaging(true))}
          disabled={!hasSessions && !isManaging}
        >
          {isManaging ? t('actions.cancel') : t('sessions.manageSessions')}
        </Button>
      </div>

      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          {sessions.map((session) => (
            <SidebarSessionItem
              key={session.id}
              project={project}
              session={session}
              selectedSession={selectedSession}
              isProcessing={activeSessions.has(session.id)}
              isManaging={isManaging}
              isBatchSelected={selectedSessionIds.has(session.id)}
              needsAttention={attentionSessionIds.has(session.id)}
              currentTime={currentTime}
              editingSession={editingSession}
              editingSessionName={editingSessionName}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              onTogglePinned={onTogglePinned}
              onToggleBatchSelection={toggleBatchSelection}
              onProjectSelect={onProjectSelect}
              onSessionSelect={onSessionSelect}
              onDeleteSession={onDeleteSession}
              t={t}
            />
          ))}

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : t('sessions.showMore')}
            </Button>
          )}

          {isManaging && (
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
      )}
    </div>
  );
}
