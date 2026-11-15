import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { GitStatusResponse } from '@/shared/types';
import { getChangedFileCount } from '@/modules/git-panel';

/** How long a fetched summary stays fresh before a focus/visibility event refetches it. */
const REFRESH_AFTER_MS = 30_000;

/** The branch and change count the workspace header badges the project with. */
export type ProjectGitSummary = {
  branch: string;
  /** Files the working tree differs from HEAD by, cast the way the git panel counts them. */
  changedFileCount: number;
};

/** The last read, tagged with the project it belongs to so a project switch never shows the previous project's badge. */
type LoadedSummary = {
  projectId: string;
  summary: ProjectGitSummary | null;
};

/**
 * Reads the project's branch and changed-file count for the workspace header's
 * metadata line. The git panel owns the full status; this fetch only feeds a
 * two-field badge, so it stays silent on failure (an unreachable repo or a
 * non-repository project just renders without the badge).
 *
 * Freshness is deliberately cheap: once per project, then again on focus or
 * visibility change only when the last read is older than `REFRESH_AFTER_MS`.
 * No polling is needed — the header is a label, not a live monitor, and a
 * commit made from the git tab is picked up the next time the window regains
 * focus.
 */
export function useProjectGitSummary(projectId: string | null): ProjectGitSummary | null {
  const [loaded, setLoaded] = useState<LoadedSummary | null>(null);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    // Scoped to this effect: a project switch starts a fresh read without
    // needing state or a ref merely to clear the previous project's value.
    let lastReadAt = 0;
    let disposed = false;
    let controller: AbortController | null = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;

      try {
        const response = await api.git.status(projectId, { signal });
        const data = (await response.json()) as GitStatusResponse;
        if (disposed || signal.aborted) {
          return;
        }

        lastReadAt = Date.now();
        // A folder that is not a repository, or a status the server refused to
        // answer, has nothing to badge: dropping the summary is the whole
        // fallback, the project name still renders.
        const summary = data.error || data.notGitRepository || !data.branch
          ? null
          : { branch: data.branch, changedFileCount: getChangedFileCount(data) };
        setLoaded({ projectId, summary });
      } catch {
        if (!disposed && !signal.aborted) {
          lastReadAt = Date.now();
          setLoaded({ projectId, summary: null });
        }
      }
    };

    const refreshIfStale = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      if (Date.now() - lastReadAt < REFRESH_AFTER_MS) {
        return;
      }
      void load();
    };

    void load();
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);

    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [projectId]);

  // Reading through the project tag keeps a switch from rendering the previous
  // project's branch while the new read is in flight.
  return loaded && loaded.projectId === projectId ? loaded.summary : null;
}
