import { useMemo } from 'react';
import { FileClock, Folder, FolderOpen, GitBranch, List, MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Project } from '@/shared/types';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';

// On mobile the sidebar (project list) lives in a drawer, so the empty state
// surfaces a few projects directly instead of forcing users to find the menu.
const QUICK_PROJECT_LIMIT = 4;

const FEATURE_PILLS = [
  { icon: MessagesSquare, labelKey: 'featureSessions' },
  { icon: FileClock, labelKey: 'featureFiles' },
  { icon: GitBranch, labelKey: 'featureGit' },
] as const;

type WorkspaceStateViewProps = {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
  projects: Project[];
  onProjectSelect: (project: Project) => void;
};

/** Rendered by WorkspaceMain instead of the workspace while projects load or when none is selected. */
export default function WorkspaceStateView({
  mode,
  isMobile,
  onMenuClick,
  projects,
  onProjectSelect,
}: WorkspaceStateViewProps) {
  const { t } = useTranslation();

  const isLoading = mode === 'loading';
  // Surface projects with the most recent session activity first. The server
  // already returns each project's `sessions` newest-first, so `sessions[0]`
  // holds the latest touch. Projects without sessions sort to the end. A copy
  // is sorted so the shared `projects` array (used by the sidebar) is untouched.
  const quickProjects = useMemo(
    () =>
      [...projects]
        .sort((a, b) => {
          const timeA = Date.parse(a.sessions?.[0]?.lastActivity ?? '');
          const timeB = Date.parse(b.sessions?.[0]?.lastActivity ?? '');
          return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
        })
        .slice(0, QUICK_PROJECT_LIMIT),
    [projects],
  );

  return (
    <div className="flex h-full flex-col">
      {isMobile && (
        <div className="pwa-header-safe flex-shrink-0 border-b border-border/50 bg-background/80 p-2 backdrop-blur-sm sm:p-3">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="mx-auto mb-4 h-10 w-10">
              <div
                className="h-full w-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-foreground">{t('mainContent.loading')}</h2>
            <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : isMobile ? (
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-8">
          <div className="w-full max-w-md">
            {/* Hero visual */}
            <div className="text-center">
              <div className="relative mx-auto mb-5 flex h-20 w-20 items-center justify-center">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/25 via-primary/10 to-transparent blur-md" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/20">
                  <Folder className="h-8 w-8 text-primary-foreground" />
                </div>
              </div>

              <h2 className="mb-2 text-2xl font-semibold text-foreground">{t('mainContent.chooseProject')}</h2>
              <p className="mx-auto mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {t('mainContent.selectProjectDescription')}
              </p>

              <button
                type="button"
                onClick={onMenuClick}
                className="mb-6 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform active:scale-95"
              >
                <List className="h-4 w-4" />
                {t('mainContent.openProjectList')}
              </button>
            </div>

            {/* Feature highlight pills */}
            <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
              {FEATURE_PILLS.map(({ icon: Icon, labelKey }) => (
                <span
                  key={labelKey}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <Icon className="h-3.5 w-3.5 text-primary/70" />
                  {t(`mainContent.${labelKey}`)}
                </span>
              ))}
            </div>

            {/* Quick-access project cards */}
            <div className="rounded-2xl border border-border/60 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{t('mainContent.quickStart')}</h3>
                {projects.length > QUICK_PROJECT_LIMIT && (
                  <button
                    type="button"
                    onClick={onMenuClick}
                    className="text-xs font-medium text-primary"
                  >
                    {t('mainContent.viewAll')}
                  </button>
                )}
              </div>

              {quickProjects.length > 0 ? (
                <ul className="space-y-2">
                  {quickProjects.map((project) => (
                    <li key={project.projectId}>
                      <button
                        type="button"
                        onClick={() => onProjectSelect(project)}
                        className="flex w-full items-center gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 active:bg-accent"
                      >
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted/60">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{project.displayName}</span>
                          <span className="block truncate text-xs text-muted-foreground">{project.fullPath}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">{t('mainContent.noProjectsYet')}</p>
                  <button
                    type="button"
                    onClick={onMenuClick}
                    className="mt-3 text-sm font-medium text-primary"
                  >
                    {t('mainContent.createProjectHint')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-md px-6 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <Folder className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-foreground">{t('mainContent.chooseProject')}</h2>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{t('mainContent.selectProjectDescription')}</p>
            <div className="rounded-xl border border-primary/10 bg-primary/5 p-3.5">
              <p className="text-sm text-primary">
                <strong>{t('mainContent.tip')}:</strong> {t('mainContent.createProjectDesktop')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
