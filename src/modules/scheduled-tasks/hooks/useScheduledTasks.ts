import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { ScheduledTask, ScheduledTaskInput } from '@/shared/types';

/** Reads the server's `{ success: false, error: { message } }` shape, falling back to the status code. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    const message = payload?.error?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
  } catch {
    // A non-JSON body (proxy error page, empty response) falls through.
  }
  return `HTTP ${response.status}`;
}

/**
 * The user's scheduled tasks and the mutations the settings tab performs.
 *
 * Loaded when the tab mounts. Every mutation re-reads the list instead of
 * patching it locally: the server recomputes `nextRunAt` from the rule and can
 * disable a one-shot that has fired, so its answer is the only correct one.
 */
export function useScheduledTasks() {
  // The task definitions, as last reported by the server.
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  // Kept apart from an empty list: the first paint shows a spinner, not "no tasks".
  const [isLoading, setIsLoading] = useState(true);
  // The last load or mutation failure, shown above the list.
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.scheduledTasks.list();
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const payload = await response.json();
      setTasks(Array.isArray(payload?.data) ? payload.data : []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs a mutation, re-reads the list on success, and rethrows so the form can show the reason. */
  const mutate = useCallback(async (request: () => Promise<Response>) => {
    try {
      const response = await request();
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      setError(null);
      await refresh();
      return response;
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : String(mutationError);
      setError(message);
      throw mutationError;
    }
  }, [refresh]);

  const createTask = useCallback(
    (input: ScheduledTaskInput) => mutate(() => api.scheduledTasks.create(input)),
    [mutate],
  );

  const updateTask = useCallback(
    (id: string, patch: Partial<ScheduledTaskInput>) => mutate(() => api.scheduledTasks.update(id, patch)),
    [mutate],
  );

  const removeTask = useCallback(
    (id: string) => mutate(() => api.scheduledTasks.remove(id)),
    [mutate],
  );

  const setEnabled = useCallback(
    (id: string, enabled: boolean) => mutate(() => api.scheduledTasks.setEnabled(id, enabled)),
    [mutate],
  );

  const runNow = useCallback(
    (id: string) => mutate(() => api.scheduledTasks.run(id)),
    [mutate],
  );

  return {
    tasks,
    isLoading,
    error,
    refresh,
    createTask,
    updateTask,
    removeTask,
    setEnabled,
    runNow,
  };
}
