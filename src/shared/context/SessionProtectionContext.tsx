import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import type { ReactNode } from 'react';

import {
  useSessionProtection,
} from '@/shared/hooks/useSessionProtection';
import type { BackgroundTaskSummary, GetSessionActivity, IsSessionProcessing, MarkSessionBackground, MarkSessionIdle, MarkSessionProcessing, SessionActivity, SessionActivityMap, SessionPendingPermission, SyncProcessingSessions } from '@/shared/types';
import { api } from '@/shared/api';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
  background?: unknown;
  tasks?: unknown;
  pendingPermissions?: unknown;
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

type SessionProtectionActions = {
  markSessionProcessing: MarkSessionProcessing;
  markSessionIdle: MarkSessionIdle;
  markSessionBackground: MarkSessionBackground;
  syncProcessingSessions: SyncProcessingSessions;
  isSessionProcessing: IsSessionProcessing;
  getSessionActivity: GetSessionActivity;
};

const SessionProtectionStateContext = createContext<SessionActivityMap | null>(null);
const SessionProtectionActionsContext = createContext<SessionProtectionActions | null>(null);
const BusySessionIdsContext = createContext<ReadonlySet<string> | null>(null);
const BackgroundSessionIdsContext = createContext<ReadonlySet<string> | null>(null);
const PendingApprovalSessionIdsContext = createContext<ReadonlySet<string> | null>(null);

/**
 * The set of session ids whose activity passes `include`, with a stable
 * identity while membership is unchanged.
 *
 * Every provider `status` frame rewrites an entry's `statusText`, which
 * allocates a new activity map several times a second during a run. Consumers
 * that only need membership — the sidebar renders a dot per row and a running
 * count — would re-render on all of it.
 */
function useSessionIdSet(
  processingSessions: SessionActivityMap,
  include: (activity: SessionActivity) => boolean,
): ReadonlySet<string> {
  // Deriving the set from a membership key, rather than from the map, keeps its
  // identity stable across the `statusText` rewrites without reading a ref
  // during render. Session ids never contain a NUL, so it is a safe separator.
  const membershipKey = [...processingSessions]
    .filter(([, activity]) => include(activity))
    .map(([sessionId]) => sessionId)
    .sort()
    .join('\u0000');

  return useMemo(
    () => new Set(membershipKey ? membershipKey.split('\u0000') : []),
    [membershipKey],
  );
}

const isAnyActivity = () => true;
const isBackgroundOnly = (activity: SessionActivity) => Boolean(activity.background);
const isPendingApproval = (activity: SessionActivity) => (activity.pendingPermissions?.length ?? 0) > 0;

const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The poll's task list, kept only when every entry has the shape the indicator reads. */
const parseBackgroundTasks = (value: unknown): BackgroundTaskSummary[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tasks: BackgroundTaskSummary[] = [];
  for (const item of value) {
    const task = item as Partial<Record<keyof BackgroundTaskSummary, unknown>> | null;
    if (
      !task
      || typeof task.taskId !== 'string'
      || typeof task.toolUseId !== 'string'
      || typeof task.taskType !== 'string'
      || typeof task.description !== 'string'
      || typeof task.startedAt !== 'number'
    ) {
      // One entry the server wrote in a shape this client does not read
      // should not hide the rest of the session's work.
      continue;
    }
    tasks.push({
      taskId: task.taskId,
      toolUseId: task.toolUseId,
      taskType: task.taskType,
      description: task.description,
      ...(typeof task.workflowName === 'string' ? { workflowName: task.workflowName } : {}),
      startedAt: task.startedAt,
      ...(task.nested === true ? { nested: true } : {}),
    });
  }
  return tasks;
};

/**
 * The poll's pending approvals, kept only when every entry carries a request id.
 * Absent means the provider cannot report pending approvals — distinct from an
 * empty list, which says it can and nothing is waiting.
 */
const parsePendingPermissions = (value: unknown): SessionPendingPermission[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const pending: SessionPendingPermission[] = [];
  for (const item of value) {
    const entry = item as Partial<Record<'requestId' | 'toolName', unknown>> | null;
    if (!entry || typeof entry.requestId !== 'string' || entry.requestId.length === 0) {
      continue;
    }
    pending.push({
      requestId: entry.requestId,
      toolName: typeof entry.toolName === 'string' ? entry.toolName : '',
    });
  }
  return pending;
};

/** Mounted by the project-workspace route; tracks which sessions are busy — producing a response or running background tasks — so chat, sidebar and project-workspace agree on session activity. */
export function SessionProtectionProvider({ children }: { children: ReactNode }) {
  const {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    markSessionBackground,
    syncProcessingSessions,
    isSessionProcessing,
    getSessionActivity,
  } = useSessionProtection();

  const refreshRunningSessions = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

      syncProcessingSessions(
        sessions
          .map((session) => {
            if (typeof session.sessionId !== 'string' || !session.sessionId) {
              return null;
            }

            return {
              sessionId: session.sessionId,
              startedAt: parseStartedAt(session.startedAt),
              statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
              canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
              background: session.background === true,
              tasks: parseBackgroundTasks(session.tasks),
              pendingPermissions: parsePendingPermissions(session.pendingPermissions),
            };
          })
          .filter((session): session is NonNullable<typeof session> => Boolean(session)),
      );
    } catch (error) {
      console.error('[SessionProtection] Failed to sync running sessions:', error);
    }
  }, [syncProcessingSessions]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshRunningSessions]);

  const actions = useMemo<SessionProtectionActions>(
    () => ({
      markSessionProcessing,
      markSessionIdle,
      markSessionBackground,
      syncProcessingSessions,
      isSessionProcessing,
      getSessionActivity,
    }),
    [
      getSessionActivity,
      isSessionProcessing,
      markSessionBackground,
      markSessionIdle,
      markSessionProcessing,
      syncProcessingSessions,
    ],
  );

  const busySessionIds = useSessionIdSet(processingSessions, isAnyActivity);
  const backgroundSessionIds = useSessionIdSet(processingSessions, isBackgroundOnly);
  const pendingApprovalSessionIds = useSessionIdSet(processingSessions, isPendingApproval);

  return (
    <SessionProtectionActionsContext.Provider value={actions}>
      <BusySessionIdsContext.Provider value={busySessionIds}>
        <BackgroundSessionIdsContext.Provider value={backgroundSessionIds}>
          <PendingApprovalSessionIdsContext.Provider value={pendingApprovalSessionIds}>
            <SessionProtectionStateContext.Provider value={processingSessions}>
              {children}
            </SessionProtectionStateContext.Provider>
          </PendingApprovalSessionIdsContext.Provider>
        </BackgroundSessionIdsContext.Provider>
      </BusySessionIdsContext.Provider>
    </SessionProtectionActionsContext.Provider>
  );
}

/**
 * Membership-only view of the busy sessions, background work included. Prefer
 * this over useProcessingSessions wherever the activity details are not
 * rendered.
 */
export function useBusySessionIdSet(): ReadonlySet<string> {
  const busySessionIds = useContext(BusySessionIdsContext);
  if (!busySessionIds) {
    throw new Error('useBusySessionIdSet must be used within SessionProtectionProvider');
  }
  return busySessionIds;
}

/**
 * The busy sessions that are only running background tasks — no response in
 * flight. A subset of useBusySessionIdSet, with the same stable identity, for
 * the sidebar to draw those rows differently.
 */
export function useBackgroundSessionIdSet(): ReadonlySet<string> {
  const backgroundSessionIds = useContext(BackgroundSessionIdsContext);
  if (!backgroundSessionIds) {
    throw new Error('useBackgroundSessionIdSet must be used within SessionProtectionProvider');
  }
  return backgroundSessionIds;
}

/**
 * The busy sessions the running-sessions poll reports as blocked on a tool
 * approval. A membership-only view with a stable identity, for the sidebar to
 * rebuild a blocked indicator after a refresh, when the websocket event that
 * would have set it has long passed.
 */
export function usePendingApprovalSessionIds(): ReadonlySet<string> {
  const pendingApprovalSessionIds = useContext(PendingApprovalSessionIdsContext);
  if (!pendingApprovalSessionIds) {
    throw new Error('usePendingApprovalSessionIds must be used within SessionProtectionProvider');
  }
  return pendingApprovalSessionIds;
}

export function useProcessingSessions(): SessionActivityMap {
  const processingSessions = useContext(SessionProtectionStateContext);
  if (!processingSessions) {
    throw new Error('useProcessingSessions must be used within SessionProtectionProvider');
  }
  return processingSessions;
}

export function useSessionProtectionActions(): SessionProtectionActions {
  const actions = useContext(SessionProtectionActionsContext);
  if (!actions) {
    throw new Error('useSessionProtectionActions must be used within SessionProtectionProvider');
  }
  return actions;
}
