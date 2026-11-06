import { Activity, Archive, Folder, FolderPlus, MessageSquare, Plus, RefreshCw, Search, X, PanelLeftClose, ChevronsDownUp, ChevronsUpDown, LocateFixed } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '@/shared/ui';
import { CLOUDCLI_WORDMARK_FONT_FAMILY } from '@/shared/constants';
import { IS_PLATFORM, cn } from '@/shared/utils';
import type { SidebarSearchMode } from '@/shared/types';
import SidebarServerMenu from '@/modules/sidebar/SidebarServerMenu';
import SidebarModeTabs from '@/modules/sidebar/SidebarModeTabs';

/** Platform modifier for the command-palette hint, matching the palette's own handler. */
const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projectsCount: number;
  runningSessionsCount: number;
  archivedSessionsCount: number;
  isArchivedSessionsLoading: boolean;
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SidebarSearchMode;
  onSearchModeChange: (mode: SidebarSearchMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  /** Whether any project group is open, so the expand/collapse button knows which way to point. */
  anyProjectExpanded: boolean;
  /** Whether the open session's project is in the active list and can be scrolled to. */
  canLocateSelectedProject: boolean;
  onToggleAllProjects: () => void;
  onLocateSelectedProject: () => void;
  onShowSettings: () => void;
  t: TFunction;
};

/** Module-level, not a nested render function, so the wordmark menu is not remounted on every SidebarHeader render. */
function LogoBlock({
  t,
  onShowSettings,
}: {
  t: TFunction;
  onShowSettings: () => void;
}) {
  // 自制的品牌终端图（/cloud-terminal-mark-flat.svg），平台端外包 dashboard 链接。
  const mark = <img src="/cloud-terminal-mark-flat.svg" alt="CloudCLI" className="h-7 w-7 flex-shrink-0" />;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {IS_PLATFORM ? (
        <a
          href="https://cloudcli.ai/dashboard"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-opacity hover:opacity-80"
          title={t('tooltips.viewEnvironments')}
        >
          {mark}
        </a>
      ) : (
        mark
      )}
      <div className="min-w-0" style={{ fontFamily: CLOUDCLI_WORDMARK_FONT_FAMILY }}>
        <SidebarServerMenu onShowSettings={onShowSettings} />
      </div>
    </div>
  );
}

/** Rendered by SidebarContent at the top of the panel for the search box, search-mode tabs, refresh and new-project actions. */
export default function SidebarHeader({
  isPWA,
  isMobile,
  isLoading,
  projectsCount,
  runningSessionsCount,
  archivedSessionsCount,
  isArchivedSessionsLoading,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  anyProjectExpanded,
  canLocateSelectedProject,
  onToggleAllProjects,
  onLocateSelectedProject,
  onShowSettings,
  t,
}: SidebarHeaderProps) {
  const showSearchTools = (projectsCount > 0 || runningSessionsCount > 0 || archivedSessionsCount > 0 || isArchivedSessionsLoading) && !isLoading;
  // Group actions belong next to the search box, and only where the list they
  // act on is the one on screen.
  const showProjectTools = searchMode === 'projects' && projectsCount > 0;
  const searchPlaceholder = searchMode === 'conversations'
    ? t('search.conversationsPlaceholder')
    : searchMode === 'archived'
      ? t('search.archivedPlaceholder', 'Search archived sessions...')
      : searchMode === 'running'
        ? t('search.runningPlaceholder', 'Search running sessions...')
        : t('projects.searchPlaceholder');

  return (
    <div className="flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden px-3 pb-2 pt-3 md:block"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          <LogoBlock t={t} onShowSettings={onShowSettings} />

          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCreateProject}
              title={t('tooltips.createProject')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Section strip and search. The strip is not gated on having content to
            search: a machine with no projects yet still has scheduled tasks. */}
        {!isLoading && (
          <div className="mt-2.5 space-y-2">
            <SidebarModeTabs
              searchMode={searchMode}
              onSearchModeChange={onSearchModeChange}
              runningSessionsCount={runningSessionsCount}
              t={t}
            />
            {/* The task list is not searchable, so the box would only be noise. */}
            {showSearchTools && searchMode !== 'scheduledTasks' && (
              <div className="flex items-center gap-1">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    type="text"
                    placeholder={searchPlaceholder}
                    value={searchFilter}
                    onChange={(event) => onSearchFilterChange(event.target.value)}
                    className="nav-search-input h-9 rounded-xl border border-border/60 pl-9 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-primary/35"
                  />
                  {searchFilter ? (
                    <button
                      onClick={onClearSearchFilter}
                      aria-label={t('tooltips.clearSearch')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 hover:bg-accent"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  ) : (
                    // Shares the slot with the clear button: an empty box is
                    // exactly when the shortcut is worth advertising.
                    <kbd
                      aria-hidden="true"
                      title={t('tooltips.openCommandPalette')}
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/60"
                    >
                      {MOD_KEY}K
                    </kbd>
                  )}
                </div>
                {showProjectTools && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 flex-none rounded-xl p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                      onClick={onLocateSelectedProject}
                      disabled={!canLocateSelectedProject}
                      title={t('tooltips.locateSelectedProject')}
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 flex-none rounded-xl p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
                      onClick={onToggleAllProjects}
                      title={t(anyProjectExpanded ? 'tooltips.collapseAllProjects' : 'tooltips.expandAllProjects')}
                    >
                      {anyProjectExpanded
                        ? <ChevronsDownUp className="h-3.5 w-3.5" />
                        : <ChevronsUpDown className="h-3.5 w-3.5" />}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop divider */}
      <div className="nav-divider hidden md:block" />

      {/* Mobile header */}
      <div
        className="p-3 pb-2 md:hidden"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          <LogoBlock t={t} onShowSettings={onShowSettings} />

          <div className="flex flex-shrink-0 gap-1.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/50 transition-all active:scale-95"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-primary-foreground transition-all active:scale-95"
              onClick={onCreateProject}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile section strip and search */}
        {!isLoading && (
          <div className="mt-2.5 space-y-2">
            <SidebarModeTabs
              searchMode={searchMode}
              onSearchModeChange={onSearchModeChange}
              runningSessionsCount={runningSessionsCount}
              t={t}
            />
            {showSearchTools && searchMode !== 'scheduledTasks' && (
              <div className="flex items-center gap-1">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    type="text"
                    placeholder={searchPlaceholder}
                    value={searchFilter}
                    onChange={(event) => onSearchFilterChange(event.target.value)}
                    className="nav-search-input h-10 rounded-xl border border-border/60 pl-10 pr-9 text-sm transition-all duration-200 placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-primary/35"
                  />
                  {searchFilter && (
                    <button
                      onClick={onClearSearchFilter}
                      aria-label={t('tooltips.clearSearch')}
                      className="absolute inset-y-0 right-1 my-auto flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
                {showProjectTools && (
                  <>
                    <button
                      className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-muted/50 transition-all active:scale-95 disabled:opacity-40"
                      onClick={onLocateSelectedProject}
                      disabled={!canLocateSelectedProject}
                      aria-label={t('tooltips.locateSelectedProject')}
                    >
                      <LocateFixed className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button
                      className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-muted/50 transition-all active:scale-95"
                      onClick={onToggleAllProjects}
                      aria-label={t(anyProjectExpanded ? 'tooltips.collapseAllProjects' : 'tooltips.expandAllProjects')}
                    >
                      {anyProjectExpanded
                        ? <ChevronsDownUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile divider */}
      <div className="nav-divider md:hidden" />
    </div>
  );
}
