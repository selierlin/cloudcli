import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LLMProviderLogo } from '@/shared/ui';
import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { usePlugins } from '@/modules/plugins';
import { formatCompactAge, getSessionTitle } from '@/shared/utils';
import { useProjectGitSummary } from '@/modules/project-workspace/hooks/useProjectGitSummary';
import type { ProjectGitSummary } from '@/modules/project-workspace/hooks/useProjectGitSummary';
import { useSessionTitleRename } from '@/modules/project-workspace/hooks/useSessionTitleRename';

type WorkspaceTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Persists a new title for a session; resolves false when the backend refuses it. */
  onRenameSession: (sessionId: string, summary: string) => Promise<boolean>;
};

type ProjectMetadataLineProps = {
  project: Project;
  /** The branch badge, or null when the project is not a repository or the read failed. */
  gitSummary: ProjectGitSummary | null;
  /** Compact age of the session's last activity; '' hides the timestamp. */
  sessionAge: string;
  /** Raw timestamp behind `sessionAge`, used for the `<time>` tooltip. */
  sessionTimestamp: string;
};

/**
 * The header's second line: the project, where its working tree sits, and how
 * old the open conversation is. Everything after the project name is optional —
 * a non-repository project or a session-less tab still renders the name alone,
 * and the timestamp never shrinks so a narrow phone truncates the branch first.
 */
function ProjectMetadataLine({
  project,
  gitSummary,
  sessionAge,
  sessionTimestamp,
}: ProjectMetadataLineProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
      <span className="min-w-0 truncate">{project.displayName}</span>

      {gitSummary && (
        <>
          <span aria-hidden className="shrink-0 text-muted-foreground/40">
            ·
          </span>
          <span className="flex min-w-0 items-center gap-1" title={gitSummary.branch}>
            <GitBranch aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
            <span className="truncate">{gitSummary.branch}</span>
          </span>
          {gitSummary.changedFileCount > 0 && (
            <span className="flex shrink-0 items-center gap-1 tabular-nums text-foreground/70">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {/* A bare count needs a name a screen reader will actually read;
                  aria-label on a generic span is dropped by several engines. */}
              <span aria-hidden>{gitSummary.changedFileCount}</span>
              <span className="sr-only">
                {t('mainContent.changedFiles', { count: gitSummary.changedFileCount })}
              </span>
            </span>
          )}
        </>
      )}

      {sessionAge && (
        <time
          className="ml-auto shrink-0 tabular-nums"
          dateTime={sessionTimestamp}
          title={new Date(sessionTimestamp).toLocaleString()}
        >
          {sessionAge}
        </time>
      )}
    </div>
  );
}

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return t('misc.projectFallback');
}

/**
 * Rendered by WorkspaceHeader to label the workspace with the active session or
 * tab name. On the chat tab the session title can be double-clicked to rename
 * the session in place, as a second way in beside the sidebar's rename.
 */
export default function WorkspaceTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  onRenameSession,
}: WorkspaceTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const gitSummary = useProjectGitSummary(selectedProject.projectId);

  // The sidebar ticks its ages once a minute; the header has to move with it or
  // a workspace left idle shows "2hr" beside the sidebar's "3hr".
  const [now, setNow] = useState(() => new Date());
  const selectedSessionId = selectedSession?.id;
  useEffect(() => {
    if (activeTab !== 'chat' || !selectedSessionId) {
      return;
    }
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [activeTab, selectedSessionId]);

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;
  const sessionTitle = selectedSession ? getSessionTitle(selectedSession) : '';

  // The chat tab is the only one whose subject is the conversation, so the
  // conversation's age belongs there; files/git/tasks show the branch only.
  const sessionTimestamp = String(
    selectedSession?.lastActivity || selectedSession?.createdAt || selectedSession?.created_at || '',
  );
  const sessionAge = activeTab === 'chat'
    ? formatCompactAge(sessionTimestamp, now)
    : '';

  const {
    isEditing: isRenaming,
    draft: renameDraft,
    isSaving: isSavingRename,
    inputRef: renameInputRef,
    startEditing: startRenaming,
    updateDraft: updateRenameDraft,
    cancelEditing: cancelRenaming,
    handleInputKeyDown: handleRenameKeyDown,
  } = useSessionTitleRename({
    sessionId: selectedSession?.id ?? null,
    currentTitle: sessionTitle,
    onRenameSession,
  });

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <LLMProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameDraft}
                onChange={(event) => updateRenameDraft(event.target.value)}
                onKeyDown={handleRenameKeyDown}
                // Clicking anywhere else cancels, as the sidebar's rename does.
                onBlur={cancelRenaming}
                readOnly={isSavingRename}
                aria-busy={isSavingRename}
                aria-label={t('mainContent.renameSessionLabel')}
                // Blur cancels, so a touch keyboard needs a key that commits.
                enterKeyHint="done"
                className="w-full max-w-md rounded border border-border bg-background px-1.5 py-0.5 text-sm font-semibold leading-tight text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <h2
                title={t('mainContent.renameSessionHint', { title: sessionTitle })}
                onDoubleClick={startRenaming}
                className="cursor-text truncate text-sm font-semibold leading-tight text-foreground"
              >
                {sessionTitle}
              </h2>
            )}
            <ProjectMetadataLine
              project={selectedProject}
              gitSummary={gitSummary}
              sessionAge={sessionAge}
              sessionTimestamp={sessionTimestamp}
            />
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <ProjectMetadataLine
              project={selectedProject}
              gitSummary={gitSummary}
              sessionAge=""
              sessionTimestamp=""
            />
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <ProjectMetadataLine
              project={selectedProject}
              gitSummary={gitSummary}
              sessionAge=""
              sessionTimestamp=""
            />
          </div>
        )}
      </div>
    </div>
  );
}
