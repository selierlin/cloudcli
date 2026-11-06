import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ScheduledTaskRun } from '@/shared/types';

/** How many runs the history shows; the sidebar row has room for even fewer. */
export const RUN_HISTORY_LIMIT = 5;

/** How often a task's history is re-read while one of its runs is still going. */
const RUNNING_REFRESH_MS = 3_000;

/**
 * Loads one task's recent runs, re-reading them while any run is still in flight.
 *
 * The run is executed by the server after the HTTP response, so polling the
 * history is how the caller learns it finished. The history is read whether or
 * not the card is expanded: the row's "running" dot is driven by these runs, and
 * a collapsed card that skipped the read never showed one.
 */
export function useTaskRuns(taskId: string | null) {
  // Newest first; empty until the history is first read.
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  // Which task the loaded history belongs to, so switching cards never shows
  // the previous task's runs for a frame.
  const [renderedTaskId, setRenderedTaskId] = useState(taskId);
  if (renderedTaskId !== taskId) {
    setRenderedTaskId(taskId);
    setRuns([]);
  }

  const refresh = useCallback(async () => {
    if (!taskId) {
      return;
    }
    try {
      const response = await api.scheduledTasks.runs(taskId, RUN_HISTORY_LIMIT);
      const payload = await response.json();
      setRuns(Array.isArray(payload?.data) ? payload.data : []);
    } catch (error) {
      console.error('Failed to load scheduled task runs:', error);
    }
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Only an in-flight run is worth polling for; a finished history is static
    // until something triggers a run, which reloads the row anyway.
    if (!runs.some((run) => run.status === 'running')) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), RUNNING_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh, runs]);

  return { runs, refresh };
}
