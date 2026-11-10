import type { ProjectSortOrder, SidebarSearchMode } from '@/shared/types';
import { readUserPreference } from '@/shared/userSettings';

export const readProjectSortOrder = (): ProjectSortOrder => (
  readUserPreference<ProjectSortOrder>('projectSortOrder', 'date') === 'name' ? 'name' : 'date'
);

const SIDEBAR_SEARCH_MODES: SidebarSearchMode[] = [
  'projects',
  'conversations',
  'running',
  'archived',
  'scheduledTasks',
];

/**
 * The sidebar section the user was last on, so a reload lands back on it
 * instead of resetting to Projects.
 *
 * Only the chosen section is stored. Anything else in the preference — a
 * section this build no longer has, or a value written by a newer one — falls
 * back to Projects rather than rendering an empty sidebar.
 */
export const readSidebarSearchMode = (): SidebarSearchMode => {
  const stored = readUserPreference<SidebarSearchMode>('sidebarSearchMode', 'projects');
  return SIDEBAR_SEARCH_MODES.includes(stored) ? stored : 'projects';
};

const LEGACY_STARRED_PROJECTS_STORAGE_KEY = 'starredProjects';

/**
 * Reads legacy project stars from localStorage (used only for one-time migration to backend).
 */
export const readLegacyStarredProjectIds = (): string[] => {
  try {
    const saved = localStorage.getItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
};

/**
 * Clears the legacy localStorage stars key after migration to backend completes.
 */
export const clearLegacyStarredProjectIds = () => {
  try {
    localStorage.removeItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
  } catch {
    // Keep UI responsive even if storage is unavailable.
  }
};
