import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { api } from '@/shared/api';
import type { ServerEvent,
  AppTab,
  CreatedConversationSignal,
  LLMProvider,
  LoadingProgress,
  Project,
  RecentConversationListItem,
  ProjectSession,IsSessionProcessing,SessionAttentionLevel } from '@/shared/types';
import { mergeProjectSelectionMetadata } from '@/modules/project-workspace/utils/projectSelectionMetadata';
import { readSelectedProvider } from '@/shared/selectedProvider';
import { clearTurnDurations } from '@/modules/chat';
import {
  clearSessionReadState,
  getSessionLastSeenAt,
  isSessionUnread,
  markSessionSeen,
  subscribeToSessionReadState,
} from '@/shared/sessionReadState';
import { getDraftScopesSnapshot, subscribeToChatDrafts } from '@/shared/chatDrafts';
import {
  clearSessionLastViewed,
  getSessionLastViewedAt,
  noteSessionLastViewed,
} from '@/shared/sessionLastViewed';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  /** Subscription to the unified websocket event stream. */
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  isMobile: boolean;
  isSessionProcessing: IsSessionProcessing;
  /**
   * Sessions the running-sessions poll reports as blocked on a tool approval.
   * The only source that survives a refresh, since the websocket event that
   * first announced the approval is not replayed.
   */
  pendingApprovalSessionIds: ReadonlySet<string>;
};

/**
 * How strongly an unread event should be flagged on a session row.
 *
 * Only `permission_request` blocks the run until the user answers, so only it
 * earns `action`; every other kind — plain errors included — carries the
 * passive `notice`. An `error` is not something the user can answer, so
 * flagging it as action (which promises "act and it clears") would mislead.
 * See SessionAttentionLevel.
 */
const getAttentionLevel = (kind: string | undefined): SessionAttentionLevel =>
  kind === 'permission_request' ? 'action' : 'notice';

/**
 * How long an unread notice keeps flagging its row after the user has opened
 * it without handling it.
 *
 * Opening a session does not answer it, so the flag survives being looked at —
 * that is the whole point of the grace period. It covers "I glanced at this,
 * meant to reply, and got distracted": the row is still marked the next time
 * the sidebar is read. It is deliberately *not* a decay on being raised: a
 * notice nobody has opened never expires, so a flag the user has not seen can
 * never quietly disappear.
 */
export const ATTENTION_GRACE_MS = 10 * 60 * 1000;

/**
 * How often the grace period is re-checked. Coarse on purpose: the deadline is
 * minutes away, so one shared sweep is enough and no row needs a timer of its
 * own. A row therefore clears within one tick of its deadline, never before it.
 */
export const ATTENTION_SWEEP_MS = 30 * 1000;

/**
 * What the sidebar keeps per flagged session.
 *
 * `seenAt` is the wall-clock ms of the last time the row was on screen, or
 * `null` while it has never been opened. Only a `notice` reads it: looking at a
 * blocked session must not age out its capsule, which waits for its approval
 * no matter how often the user stares at it.
 */
type SessionAttentionState = {
  level: SessionAttentionLevel;
  seenAt: number | null;
};

/** The `requestId` a permission event names, or null when the wire omits it. */
const readPermissionRequestId = (event: ServerEvent): string | null => {
  const requestId = event.requestId;
  return typeof requestId === 'string' && requestId ? requestId : null;
};

/**
 * Shape of the per-session sidebar delta (`kind: session_upserted`). It carries
 * everything needed to upsert one session row in place — no full project-list
 * snapshot is ever pushed.
 *
 * Produced on the wire by exactly one builder,
 * `server/modules/websocket/services/session-upsert-broadcast.service.ts`,
 * which both the on-disk sessions watcher and the chat run registry go through.
 */
type SessionUpsertedEvent = ServerEvent & {
  sessionId: string;
  providerSessionId?: string | null;
  provider: LLMProvider;
  /**
   * `change` distinguishes a real content advance from a metadata-only refresh
   * (title change, fork, a bare file `touch`). Absent is treated as content, so
   * a server that predates the flag keeps working.
   */
  session: ProjectSession & { change?: 'content' | 'metadata' };
  project: {
    projectId: string;
    path: string;
    fullPath: string;
    displayName: string;
    isStarred: boolean;
  } | null;
};

type FetchProjectsOptions = {
  showLoadingState?: boolean;
};

/** Arguments naming a session this client just created, shared by the optimistic new-chat path and the fork path. */
type RegisterSessionArgs = {
  sessionId: string;
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

/**
 * Shape of `GET /api/providers/sessions/:sessionId` — the authoritative
 * session → owning-project resolution used when a `/session/<id>` URL points
 * at a session that is not present in the paginated project payloads.
 */
type SessionDetailsApiPayload = {
  data?: {
    sessionId?: string;
    provider?: string;
    summary?: string;
    createdAt?: string | null;
    lastActivity?: string | null;
    project?: {
      projectId?: string;
      path?: string;
      fullPath?: string;
      displayName?: string;
      isStarred?: boolean;
    } | null;
  };
};

type ProjectSessionPage = Pick<Project, 'sessions' | 'sessionMeta'>;

const DEFAULT_PROVIDER: LLMProvider = 'claude';

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const getSessionProvider = (session: ProjectSession): LLMProvider => {
  const provider = session.__provider ?? session.provider;
  return typeof provider === 'string' && provider.trim()
    ? provider as LLMProvider
    : DEFAULT_PROVIDER;
};

const normalizeSessionProvider = (session: ProjectSession): ProjectSession => ({
  ...session,
  __provider: getSessionProvider(session),
});

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    return (
      nextProject.projectId !== prevProject.projectId ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      Boolean(nextProject.isStarred) !== Boolean(prevProject.isStarred) ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster)
    );
  });
};

const mergeTaskMasterCache = (nextProjects: Project[], previousProjects: Project[]): Project[] => {
  if (previousProjects.length === 0) {
    return nextProjects;
  }

  // Keyed by `projectId` (the DB primary key) so caches stay correct across
  // renames and other mutations that might have changed the display name.
  const previousTaskMasterByProject = new Map(
    previousProjects
      .filter((project) => Boolean(project.taskmaster))
      .map((project) => [project.projectId, project.taskmaster]),
  );

  return nextProjects.map((project) => {
    const cachedTaskMasterInfo = previousTaskMasterByProject.get(project.projectId);
    if (!cachedTaskMasterInfo) {
      return project;
    }

    return {
      ...project,
      taskmaster: cachedTaskMasterInfo,
    };
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return project.sessions ?? [];
};

const countLoadedProjectSessions = (project: Project): number => getProjectSessions(project).length;

/** Locates one session across the project list, for the read-watermark writes. */
const findSessionByIdInProjects = (projects: Project[], sessionId: string): ProjectSession | null => {
  for (const project of projects) {
    for (const session of getProjectSessions(project)) {
      if (session.id === sessionId) {
        return session;
      }
    }
  }
  return null;
};

const mergeSessionProviderLists = (baseSessions: ProjectSession[], additionalSessions: ProjectSession[]): ProjectSession[] => {
  const merged = [...baseSessions];
  const seenSessionIds = new Set(baseSessions.map((session) => String(session.id)));

  for (const session of additionalSessions) {
    const sessionId = String(session.id);
    if (seenSessionIds.has(sessionId)) {
      continue;
    }

    merged.push(session);
    seenSessionIds.add(sessionId);
  }

  return merged;
};

const mergeExpandedSessionPages = (previousProjects: Project[], incomingProjects: Project[]): Project[] => {
  if (previousProjects.length === 0) {
    return incomingProjects;
  }

  const previousByProjectId = new Map(previousProjects.map((project) => [project.projectId, project]));

  return incomingProjects.map((incomingProject) => {
    const previousProject = previousByProjectId.get(incomingProject.projectId);
    if (!previousProject) {
      return incomingProject;
    }

    const previousLoadedCount = countLoadedProjectSessions(previousProject);
    const incomingLoadedCount = countLoadedProjectSessions(incomingProject);
    if (previousLoadedCount <= incomingLoadedCount) {
      return incomingProject;
    }

    const mergedProject: Project = {
      ...incomingProject,
      sessions: mergeSessionProviderLists(incomingProject.sessions ?? [], previousProject.sessions ?? []),
    };

    const totalSessions = Number(incomingProject.sessionMeta?.total ?? previousLoadedCount);
    mergedProject.sessionMeta = {
      ...incomingProject.sessionMeta,
      total: totalSessions,
      hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
    };

    return mergedProject;
  });
};

const mergeProjectSessionPage = (
  existingProject: Project,
  sessionsPage: ProjectSessionPage,
): Project => {
  const mergedProject: Project = {
    ...existingProject,
    sessions: mergeSessionProviderLists(existingProject.sessions ?? [], sessionsPage.sessions ?? []),
  };

  const totalSessions = Number(sessionsPage.sessionMeta?.total ?? existingProject.sessionMeta?.total ?? 0);
  mergedProject.sessionMeta = {
    ...existingProject.sessionMeta,
    ...sessionsPage.sessionMeta,
    total: totalSessions,
    hasMore: countLoadedProjectSessions(mergedProject) < totalSessions,
  };

  return mergedProject;
};

const getSessionAliasIds = (event: SessionUpsertedEvent): Set<string> => {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (trimmed) {
      ids.add(trimmed);
    }
  };

  add(event.sessionId);
  add(event.providerSessionId);
  add(event.session?.id);

  return ids;
};

/**
 * Upserts one session into a project's normalized session list.
 *
 * Existing rows are updated in place (summary/lastActivity changes from the
 * watcher); new rows are prepended since the watcher only fires for sessions
 * with fresh activity. `sessionMeta.total` grows only on insert.
 */
const upsertSessionIntoProject = (project: Project, event: SessionUpsertedEvent): Project => {
  const sessions = project.sessions ?? [];
  const aliasIds = getSessionAliasIds(event);
  const normalizedSession: ProjectSession = {
    ...event.session,
    id: event.sessionId,
    __provider: event.provider,
  };
  const existingIndex = sessions.findIndex((session) => aliasIds.has(String(session.id)));

  let nextSessions: ProjectSession[];
  let inserted = false;
  if (existingIndex >= 0) {
    let changed = false;
    nextSessions = [];

    for (const [index, session] of sessions.entries()) {
      if (index === existingIndex) {
        const updated = { ...session, ...normalizedSession };
        // Never let a later upsert that carries an empty summary blank out a
        // title we already have. Fresh sessions momentarily broadcast an empty
        // custom_name before the disk indexer fills it in, which would
        // otherwise flash the row back to the "New session" placeholder.
        if (!normalizedSession.summary?.trim() && session.summary?.trim()) {
          updated.summary = session.summary;
        }
        if (serialize(session) !== serialize(updated)) {
          changed = true;
        }
        nextSessions.push(updated);
        continue;
      }

      if (aliasIds.has(String(session.id))) {
        changed = true;
        continue;
      }

      nextSessions.push(session);
    }

    if (!changed) {
      return project;
    }
  } else {
    nextSessions = [normalizedSession, ...sessions];
    inserted = true;
  }

  const next: Project = { ...project, sessions: nextSessions };
  if (inserted) {
    const total = Number(project.sessionMeta?.total ?? 0) + 1;
    next.sessionMeta = {
      ...project.sessionMeta,
      total,
      hasMore: countLoadedProjectSessions(next) < total,
    };
  }

  return next;
};

const projectFromRegistration = (project: Project): Project => ({
  projectId: project.projectId,
  path: project.path || project.fullPath,
  fullPath: project.fullPath || project.path || '',
  displayName: project.displayName,
  isStarred: project.isStarred,
  sessions: project.sessions ?? [],
  sessionMeta: project.sessionMeta ?? { hasMore: false, total: countLoadedProjectSessions(project) },
  taskmaster: project.taskmaster,
});

/**
 * Builds the Conversations-feed row for a session this client just created, so
 * the sidebar's separate paginated feed can show it without a refetch. The
 * title falls back to the id, matching how the server derives `sessionTitle`
 * for a session that has no custom name yet, and a brand-new session is never
 * pinned.
 */
const buildCreatedConversationRow = (
  sessionId: string,
  provider: LLMProvider,
  project: Project,
  summary: string | null | undefined,
  lastActivity: string,
): RecentConversationListItem => ({
  sessionId,
  provider,
  projectId: project.projectId,
  projectDisplayName: project.displayName,
  sessionTitle: (summary ?? '').trim() || sessionId,
  lastActivity,
  isPinned: false,
});

const removeSessionFromProject = (project: Project, sessionIdToDelete: string): Project => {
  const sessions = project.sessions ?? [];
  const nextSessions = sessions.filter((session) => session.id !== sessionIdToDelete);
  if (nextSessions.length === sessions.length) {
    return project;
  }

  const updatedProject: Project = {
    ...project,
    sessions: nextSessions,
  };

  const totalSessions = Math.max(0, Number(project.sessionMeta?.total ?? 0) - 1);
  updatedProject.sessionMeta = {
    ...project.sessionMeta,
    total: totalSessions,
    hasMore: countLoadedProjectSessions(updatedProject) < totalSessions,
  };

  return updatedProject;
};

// Writes a confirmed rename onto the matching sidebar row. Returns the same
// project when it holds no such row, or the row already carries that title, so
// the sidebar list does not re-render for projects the rename did not touch.
const renameSessionInProject = (project: Project, sessionIdToRename: string, summary: string): Project => {
  const sessions = project.sessions ?? [];
  const existingIndex = sessions.findIndex((session) => session.id === sessionIdToRename);
  if (existingIndex < 0 || sessions[existingIndex].summary === summary) {
    return project;
  }

  const nextSessions = [...sessions];
  nextSessions[existingIndex] = { ...sessions[existingIndex], summary };
  return { ...project, sessions: nextSessions };
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'git', 'tasks', 'browser']);

const isValidTab = (tab: string): tab is AppTab => {
  return VALID_TABS.has(tab) || tab.startsWith('plugin:');
};

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && isValidTab(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  subscribe,
  isMobile,
  isSessionProcessing,
  pendingApprovalSessionIds,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  // The most recently created local session, surfaced to the sidebar so its
  // Conversations feed can show the row without waiting for a refetch. Reuses
  // the workspace's own optimistic row, so both lists agree on identity.
  const [createdConversation, setCreatedConversation] = useState<CreatedConversationSignal | null>(null);
  // Sessions flagged as waiting on the user, each with how strongly to flag it
  // and when the user last had its row on screen. A flag survives being opened
  // and is cleared by handling the session or by the grace period — see
  // markSessionAttention, noteSessionViewed and ATTENTION_GRACE_MS.
  const [attentionStates, setAttentionStates] = useState<Map<string, SessionAttentionState>>(new Map());
  /**
   * The levels alone, which is all a row draws. `seenAt` stays internal, but it
   * is what splits a notice in two for the row: never opened reads as a solid
   * dot, and one that has been on screen — the grace period's whole subject —
   * reads as a hollow one. The row still draws a marker either way; only "have
   * you looked at this yet" differs, which is exactly what the shape encodes.
   */
  const attentionSessions = useMemo<ReadonlyMap<string, SessionAttentionLevel>>(() => {
    const levels = new Map<string, SessionAttentionLevel>();
    for (const [targetSessionId, state] of attentionStates) {
      levels.set(
        targetSessionId,
        state.level === 'notice' && state.seenAt !== null ? 'notice-seen' : state.level,
      );
    }
    return levels;
  }, [attentionStates]);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('appearance');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  /**
   * `newSessionTrigger` is an explicit, monotonic intent signal for user-driven
   * New Session actions.
   *
   * It exists because `handleNewSession` can be invoked while the app is already in
   * the same visible state (`selectedSession === null`, `activeTab === 'chat'`,
   * route already `/`). In that case, React/router updates are idempotent and no
   * downstream reset logic runs.
   *
   * Usage across the codebase:
   * 1) Produced here in `handleNewSession` via increment (always changes).
   * 2) Returned from this hook and threaded through:
   *    useProjectsState -> ProjectWorkspaceRoute -> WorkspaceMain -> ChatInterface.
   * 3) Consumed in `useChatSessionState` as an effect dependency to forcibly clear
   *    chat-local state (`currentSessionId`, pending draft message, streaming flags,
   *    pending session storage keys, pagination/scroll artifacts).
   *
   * Keeping this signal dedicated avoids coupling resets to unrelated counters/events
   * (for example websocket/project refresh updates) that could cause accidental resets.
   */
  const [newSessionTrigger, setNewSessionTrigger] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Guards the one-time mount fetch below. `fetchProjects` is stable, so the
   * effect only ever re-runs because StrictMode remounts the tree in
   * development — and each extra run costs a full `/api/projects`, which
   * re-scans every provider transcript on the server and re-broadcasts the
   * sidebar's loading progress. Two overlapping scans finish far enough apart
   * that the progress bar replayed from zero, showing the loading screen twice
   * on every refresh.
   */
  const mountFetchStartedRef = useRef(false);
  /**
   * Ref mirrors for state the websocket subscription handler needs.
   *
   * The subscription is registered once (per `subscribe` identity) and events
   * are dispatched synchronously outside React's render cycle, so the handler
   * must read the latest values through refs instead of stale closures —
   * re-subscribing on every state change would risk missing events.
   */
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  // Read inside `noteSessionViewed`, which runs from an effect and must know
  // whether the session it is looking at actually carries a dot before it
  // remembers the view — seeing an unflagged session must not invent one.
  // Synced from an effect rather than during render so the read always sees the
  // committed map, and declared before its only reader.
  const attentionStatesRef = useRef(attentionStates);
  useEffect(() => {
    attentionStatesRef.current = attentionStates;
  }, [attentionStates]);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  /** URL session id whose backend lookup already ran (or is in flight) — one attempt per id. */
  const sessionLookupRef = useRef<string | null>(null);
  /**
   * Generation of the newest `/api/projects` request. Several independent
   * triggers call refreshProjectsSilently (a rename, a service-worker
   * notification, the worktrees view), and the server re-synchronizes sessions
   * before responding, so an older response can land last. Applying it would
   * revert the project list and — since the selected copy is derived from the
   * same payload — the workspace header and document title.
   */
  const projectsRequestIdRef = useRef(0);
  /**
   * Outstanding `permission_request` ids per session, keyed by session id.
   *
   * A session can have several permission requests in flight and each
   * `permission_resolved` / `permission_cancelled` clears only the request it
   * names, so the row's amber capsule must stay until the *last* one is gone.
   * The set — not the single event — decides whether to clear.
   */
  const pendingPermissionRequestIdsRef = useRef<Map<string, Set<string>>>(new Map());
  /**
   * Permission requests that arrived for the session on screen, keyed by session
   * id, and were therefore never flagged (the viewed-session gate in
   * `markSessionAttention` drops them). Leaving that session flags it at once, so
   * its row is not blank until the next 5s poll.
   *
   * Kept apart from `pendingPermissionRequestIdsRef` on purpose: that map tracks
   * every request but only clears a session we are *not* viewing, so a resolve
   * or cancel for the session on screen leaves a stale entry there. This map
   * removes on resolve/cancel whatever is on screen, so re-entering and leaving a
   * session never resurrects an already-answered approval as a false capsule.
   */
  const suppressedPendingRef = useRef<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    sessionLookupRef.current = null;
  }, [sessionId]);

  const markSessionAttention = useCallback((
    targetSessionId: string | null | undefined,
    level: SessionAttentionLevel,
    /**
     * The content timestamp the signal itself carries, when it knows one. An
     * upsert does; a bare transcript frame does not and falls back to the
     * project list (see the guard below).
     */
    contentUpdatedAt?: string | null,
  ) => {
    if (!targetSessionId) {
      return;
    }

    const viewedSessionId = selectedSessionRef.current?.id ?? sessionId ?? null;
    if (targetSessionId === viewedSessionId) {
      return;
    }

    setAttentionStates((previous) => {
      const current = previous.get(targetSessionId);
      // Never downgrade an unread permission/error back to a passive notice.
      if (current?.level === 'action') {
        return previous;
      }

      // A notice the user has already read must not be knocked back to unseen by
      // a signal that carries no newer content — a replayed transcript frame
      // when the session is re-opened, or a late upsert for the reply that was
      // on screen when they left. The read watermark is the same arbiter
      // `applyPersistedUnread` uses: a signal only counts as new when its
      // content actually moved past it.
      if (level === 'notice' && current && current.seenAt !== null) {
        const signalContent = contentUpdatedAt
          ?? findSessionByIdInProjects(projectsRef.current, targetSessionId)?.contentUpdatedAt;
        if (
          signalContent
          && getSessionLastSeenAt(targetSessionId)
          && !isSessionUnread(targetSessionId, signalContent)
        ) {
          return previous;
        }
      }

      // A fresh signal is newer than anything the user has looked at, so it
      // re-raises the flag even on a row that was opened a moment ago.
      if (current?.level === level && current.seenAt === null) {
        return previous;
      }

      const next = new Map(previous);
      next.set(targetSessionId, { level, seenAt: null });
      return next;
    });
  }, [sessionId]);

  const clearSessionAttention = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    // The mirrored view goes with the flag: a row the user has dealt with, or
    // that no longer exists, must not come back hollow after a reload.
    clearSessionLastViewed(targetSessionId);

    setAttentionStates((previous) => {
      if (!previous.has(targetSessionId)) {
        return previous;
      }

      const next = new Map(previous);
      next.delete(targetSessionId);
      return next;
    });
  }, []);

  /**
   * Starts — or restarts — the grace period for a row the user just had on
   * screen.
   *
   * This replaces the old "opening clears the flag" rule. Opening a session
   * only proves it was read, not that it was dealt with, and the whole point of
   * the grace period is the session the user looked at and did not answer. Only
   * a `notice` is touched: a blocked session's capsule is not cleared by
   * looking at it, the answer is what clears it.
   *
   * The moment is also mirrored to localStorage, so a reload restores the
   * hollow dot the grace period had drawn instead of losing it to a refreshed
   * tab — the case the grace period is most likely to be interrupted by.
   */
  const noteSessionViewed = useCallback((targetSessionId?: string | null) => {
    if (!targetSessionId) {
      return;
    }

    const seenAt = Date.now();
    // A view is persisted only when it is what makes the row's dot hollow. A
    // session opened while it carried no dot must not gain one on the next
    // reload, so the mirror tracks the flagged rows, not everything opened.
    if (attentionStatesRef.current.get(targetSessionId)?.level === 'notice') {
      noteSessionLastViewed(targetSessionId, seenAt);
    }

    setAttentionStates((previous) => {
      const current = previous.get(targetSessionId);
      if (!current || current.level !== 'notice') {
        return previous;
      }

      const next = new Map(previous);
      next.set(targetSessionId, { level: current.level, seenAt });
      return next;
    });
  }, []);

  /**
   * An unsent draft answers the session just as well as a sent message does.
   *
   * Replying always passes through this state — the composer persists every
   * keystroke as a draft — so the two rules together mean "you dealt with it".
   * The pen the row then draws is a louder and more specific claim than the
   * unread dot, which would only repeat it.
   *
   * A blocked session keeps its capsule: an approval still needs answering,
   * whatever is half-written in the composer.
   */
  useEffect(() => {
    const clearSessionsWithDrafts = () => {
      const draftScopes = getDraftScopesSnapshot();
      if (draftScopes.size === 0) {
        return;
      }

      // The pen answers the session, so the mirrored view is dropped with the
      // dot — otherwise a reload would restore the dot beside the pen.
      for (const scope of draftScopes) {
        clearSessionLastViewed(scope);
      }

      setAttentionStates((previous) => {
        let next: Map<string, SessionAttentionState> | null = null;
        for (const scope of draftScopes) {
          if (previous.get(scope)?.level === 'notice') {
            next ??= new Map(previous);
            next.delete(scope);
          }
        }
        return next ?? previous;
      });
    };

    clearSessionsWithDrafts();
    return subscribeToChatDrafts(clearSessionsWithDrafts);
  }, []);

  /**
   * Ages out notices the user has already seen.
   *
   * A `notice` is raised by an event and cleared by the user acting on it; this
   * is the backstop for the ones they only looked at, so a session they meant
   * to come back to stops nagging after the grace period. A notice nobody has
   * opened carries no `seenAt` and is left alone, and a blocked `action` waits
   * for its approval however long that takes.
   */
  useEffect(() => {
    const sweep = () => {
      const deadline = Date.now() - ATTENTION_GRACE_MS;
      setAttentionStates((previous) => {
        let next: Map<string, SessionAttentionState> | null = null;
        for (const [targetSessionId, state] of previous) {
          if (state.level === 'notice' && state.seenAt !== null && state.seenAt <= deadline) {
            next ??= new Map(previous);
            next.delete(targetSessionId);
          }
        }
        return next ?? previous;
      });
    };

    const timer = setInterval(sweep, ATTENTION_SWEEP_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * The previous poll's blocked sessions.
   *
   * The poll is authoritative for a session blocked on a tool approval: it is
   * the only channel a refreshed page has, and it is how an approval answered
   * on another device reaches this one. Comparing it with the current report
   * lets this channel clear exactly the sessions it flagged, without touching a
   * `notice` the websocket set.
   */
  const previousPendingApprovalSessionIdsRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const answeredSessionIds = previousPendingApprovalSessionIdsRef.current;
    previousPendingApprovalSessionIdsRef.current = pendingApprovalSessionIds;

    setAttentionStates((previous) => {
      const next = new Map(previous);
      let changed = false;

      // Rebuild: the poll is authoritative even for the session on screen — the
      // row hides the indicator for the selected session on its own.
      for (const targetSessionId of pendingApprovalSessionIds) {
        if (next.get(targetSessionId)?.level !== 'action') {
          next.set(targetSessionId, { level: 'action', seenAt: null });
          changed = true;
        }
      }

      // Clear: a session this channel had flagged and the poll no longer lists
      // has had its approval answered.
      for (const targetSessionId of answeredSessionIds) {
        if (!pendingApprovalSessionIds.has(targetSessionId) && next.get(targetSessionId)?.level === 'action') {
          next.delete(targetSessionId);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [pendingApprovalSessionIds]);

  /**
   * Rebuilds the persisted unread flags from the server's answer, and restores
   * the hollow dot for a row this device looked at just before the reload.
   *
   * This is the only channel that survives a reload: the websocket notice that
   * originally raised a flag is not replayed, so on load the sidebar reads
   * `isUnread` off each session — computed by the server from the session's
   * content timestamp and this user's stored watermark — instead of re-deriving
   * it. It only ever *raises* a flag and never clears one, so it cannot fight
   * the other channels (see the channel-merge rules).
   *
   * Two local corrections are still needed. A watermark written on this device
   * after the row was fetched makes the server's snapshot stale, so a session
   * the user has just read must not be flagged from that stale `isUnread`. And
   * a session the server reports as read may still have been on screen moments
   * before the reload, so the mirrored view restores the dot the grace period
   * had drawn — hollow, since the user has looked at it.
   */
  const applyPersistedUnread = useCallback(() => {
    const viewedSessionId = selectedSessionRef.current?.id ?? sessionIdRef.current ?? null;
    const now = Date.now();

    setAttentionStates((previous) => {
      let next: Map<string, SessionAttentionState> | null = null;

      for (const project of projectsRef.current) {
        for (const session of project.sessions ?? []) {
          // The row hides the indicator for the session on screen, and a flag
          // already in the map is this channel's own work rather than news.
          if (session.id === viewedSessionId || previous.get(session.id)) {
            continue;
          }

          if (session.isUnread === true) {
            // The user read it on this device after the row was fetched: the
            // local watermark already covers the content, so the server's flag
            // is stale until the next projection.
            if (getSessionLastSeenAt(session.id) && !isSessionUnread(session.id, session.contentUpdatedAt)) {
              continue;
            }
            next ??= new Map(previous);
            next.set(session.id, { level: 'notice', seenAt: null });
            continue;
          }

          // Not unread on the server, but this device had the row on screen
          // within the grace period before the reload: restore it hollow. A
          // null `seenAt` would wrongly claim it had never been opened.
          const viewedAt = getSessionLastViewedAt(session.id);
          if (viewedAt !== null && now - viewedAt <= ATTENTION_GRACE_MS) {
            next ??= new Map(previous);
            next.set(session.id, { level: 'notice', seenAt: viewedAt });
          }
        }
      }

      return next ?? previous;
    });
  }, []);

  // Fire after the project list lands, and again once the watermark hydration
  // resolves, so the flags appear either way round.
  useEffect(() => {
    applyPersistedUnread();
  }, [applyPersistedUnread, projects]);

  useEffect(() => subscribeToSessionReadState(applyPersistedUnread), [applyPersistedUnread]);

  const fetchProjects = useCallback(async ({ showLoadingState = true }: FetchProjectsOptions = {}) => {
    // Claimed before the request starts and read again in `finally`, so the
    // loading flag is only ever cleared by the response that actually wrote
    // `projects`.
    const requestId = (projectsRequestIdRef.current += 1);

    try {
      if (showLoadingState) {
        setIsLoadingProjects(true);
      }
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      if (projectsRequestIdRef.current !== requestId) {
        return;
      }

      setProjects((prevProjects) => {
        const projectsWithTaskMaster = mergeTaskMasterCache(projectData, prevProjects);
        const mergedProjects = mergeExpandedSessionPages(prevProjects, projectsWithTaskMaster);

        if (prevProjects.length === 0) {
          return mergedProjects;
        }

        return projectsHaveChanges(prevProjects, mergedProjects)
          ? mergedProjects
          : prevProjects;
      });

      // `selectedProject` is a denormalized copy of one row of `projects`, so a
      // refresh that only writes `projects` leaves the workspace header and the
      // document title showing stale metadata — visible after a project rename,
      // which reaches this path via paletteOps.refreshProjects. Re-merging here
      // keeps the copy in step; mergeProjectSelectionMetadata returns the same
      // object when nothing workspace-visible changed, so the main region does
      // not re-render on unrelated refreshes.
      setSelectedProject((previousProject) => {
        if (!previousProject) {
          return previousProject;
        }

        const refreshedProject = projectData.find(
          (project) => project.projectId === previousProject.projectId,
        );
        return refreshedProject
          ? mergeProjectSelectionMetadata(previousProject, refreshedProject)
          : previousProject;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      // Only the newest request clears the flag, and it clears it whether or not
      // it asked for the spinner, because by now it has written the list.
      //
      // A superseded response must leave the spinner up: it returned above
      // without touching `projects`, so clearing here would render the sidebar's
      // "No projects found" empty state over the still-empty initial list until
      // the newest response lands. Anything that refreshes during the first load
      // — the websocket's reconnect re-sync, a command-palette refresh, React's
      // StrictMode double-mount — supersedes the initial fetch and used to
      // trigger exactly that flash.
      if (projectsRequestIdRef.current === requestId) {
        setIsLoadingProjects(false);
      }
    }
  }, []);

  const refreshProjectsSilently = useCallback(async () => {
    // Keep chat view stable while still syncing sidebar/session metadata in background.
    await fetchProjects({ showLoadingState: false });
  }, [fetchProjects]);

  const registerOptimisticSession = useCallback(({
    sessionId: newSessionId,
    provider,
    project,
    summary,
  }: RegisterSessionArgs) => {
    if (!newSessionId || !project?.projectId) {
      return;
    }

    const now = new Date().toISOString();
    const optimisticSession: ProjectSession = {
      id: newSessionId,
      summary: summary ?? '',
      messageCount: 0,
      createdAt: now,
      created_at: now,
      updated_at: now,
      lastActivity: now,
      __provider: provider,
      __projectId: project.projectId,
    };
    // A purely local record that reuses the wire shape to feed
    // `upsertSessionIntoProject`; it is never dispatched onto the socket. It
    // deliberately carries no `providerSessionId` — the row was created moments
    // ago by `POST /api/providers/sessions` and the provider has not reported
    // an id yet, so there is nothing truthful to put there.
    const upsert: SessionUpsertedEvent = {
      kind: 'session_upserted',
      sessionId: newSessionId,
      provider,
      session: optimisticSession,
      project: {
        projectId: project.projectId,
        path: project.path || project.fullPath,
        fullPath: project.fullPath || project.path || '',
        displayName: project.displayName,
        isStarred: Boolean(project.isStarred),
      },
      timestamp: now,
    };

    setProjects((previousProjects) => {
      const existingProject = previousProjects.find((candidate) => candidate.projectId === project.projectId);
      if (!existingProject) {
        return [upsertSessionIntoProject(projectFromRegistration(project), upsert), ...previousProjects];
      }

      const updatedProject = upsertSessionIntoProject(existingProject, upsert);
      if (updatedProject === existingProject) {
        return previousProjects;
      }

      return previousProjects.map((candidate) =>
        candidate.projectId === existingProject.projectId ? updatedProject : candidate,
      );
    });

    setSelectedSession((previousSession) => (
      previousSession?.id === newSessionId
        ? { ...previousSession, ...optimisticSession }
        : optimisticSession
    ));

    // Hand the sidebar the same row so its separate Conversations feed can show
    // it immediately.
    setCreatedConversation((previous) => ({
      row: buildCreatedConversationRow(newSessionId, provider, project, summary, now),
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);

  /**
   * Hands the sidebar a Conversations row for a session created by a fork.
   *
   * The fork's tree row already reaches `projects` through the server's
   * `session_upserted` broadcast, but that broadcast never feeds the separate
   * paginated Conversations list, so without this the new row would wait for a
   * refetch. Unlike `registerOptimisticSession` this deliberately touches
   * neither `projects` nor the selected session — it only bridges the feed, so
   * it cannot overwrite the fields the broadcast already delivered.
   */
  const registerForkedSession = useCallback(({
    sessionId: forkedSessionId,
    provider,
    project,
    summary,
  }: RegisterSessionArgs) => {
    if (!forkedSessionId || !project?.projectId) {
      return;
    }

    const now = new Date().toISOString();
    setCreatedConversation((previous) => ({
      row: buildCreatedConversationRow(forkedSessionId, provider, project, summary, now),
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  }, []);

  // Hydrates TaskMaster details for the given `projectId`. The project
  // identifier comes directly from the DB-driven /api/projects response.
  const hydrateProjectTaskMaster = useCallback(async (projectId: string) => {
    if (!projectId) {
      return;
    }

    try {
      const response = await api.projectTaskmaster(projectId);
      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { taskmaster?: Project['taskmaster'] };
      const taskMasterInfo = data.taskmaster;
      if (!taskMasterInfo) {
        return;
      }

      setProjects((previousProjects) =>
        previousProjects.map((project) =>
          project.projectId === projectId
            ? { ...project, taskmaster: taskMasterInfo }
            : project,
        ),
      );

      setSelectedProject((previousProject) => {
        if (!previousProject || previousProject.projectId !== projectId) {
          return previousProject;
        }

        return {
          ...previousProject,
          taskmaster: taskMasterInfo,
        };
      });
    } catch (error) {
      console.error(`Error fetching TaskMaster info for project ${projectId}:`, error);
    }
  }, []);

  const openSettings = useCallback((tab = 'appearance') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    if (mountFetchStartedRef.current) {
      return;
    }

    mountFetchStartedRef.current = true;
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!selectedProject?.projectId) {
      return;
    }

    void hydrateProjectTaskMaster(selectedProject.projectId);
  }, [hydrateProjectTaskMaster, selectedProject?.projectId]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  // Realtime sidebar updates. The backend pushes per-session deltas
  // (`session_upserted`) instead of full project snapshots, so each event is
  // a keyed upsert that can never clobber unrelated client state — no
  // "suppress updates while a run is active" protection is needed anymore.
  useEffect(() => {
    const handleEvent = (event: ServerEvent) => {
      // The project list is maintained purely by incremental `session_upserted`
      // deltas, so anything that happened while the socket was down is missing
      // from it until something else forces a refresh. Chat re-syncs itself on
      // this event; the sidebar has to as well.
      if (event.kind === 'websocket_reconnected') {
        void refreshProjectsSilently();
        return;
      }

      if (event.kind === 'loading_progress') {
        if (loadingProgressTimeoutRef.current) {
          clearTimeout(loadingProgressTimeoutRef.current);
          loadingProgressTimeoutRef.current = null;
        }

        setLoadingProgress(event as unknown as LoadingProgress);

        if (event.phase === 'complete') {
          loadingProgressTimeoutRef.current = setTimeout(() => {
            setLoadingProgress(null);
            loadingProgressTimeoutRef.current = null;
          }, 500);
        }

        return;
      }

      const eventSessionId = typeof event.sessionId === 'string' && event.sessionId
        ? event.sessionId
        : null;
      const viewedSessionId = selectedSessionRef.current?.id ?? sessionId ?? null;

      // A deleted session carries no new activity to mark: drop whatever
      // attention flag it left behind instead of letting the generic mark below
      // raise a notice for a row — an aside copy — that can never be reopened.
      if (event.kind === 'session_deleted') {
        clearSessionAttention(eventSessionId);
        return;
      }

      // Remember which permission requests are still open before the mark
      // below, so a later resolve/cancel can tell whether it was the last one.
      if (event.kind === 'permission_request' && eventSessionId) {
        const requestId = readPermissionRequestId(event);
        if (requestId) {
          const pending = pendingPermissionRequestIdsRef.current.get(eventSessionId) ?? new Set<string>();
          pending.add(requestId);
          pendingPermissionRequestIdsRef.current.set(eventSessionId, pending);

          // The request is for the session on screen, so the mark below is
          // suppressed. Remember it here instead, for the leave-the-session path
          // to flag at once without waiting up to 5s for the poll.
          if (eventSessionId === viewedSessionId) {
            const suppressed = suppressedPendingRef.current.get(eventSessionId) ?? new Set<string>();
            suppressed.add(requestId);
            suppressedPendingRef.current.set(eventSessionId, suppressed);
          }
        }
      }

      // Drop a settled request from the suppressed map whatever is on screen, so
      // leaving the session never re-flags an approval that was already answered.
      if (
        eventSessionId
        && (event.kind === 'permission_resolved' || event.kind === 'permission_cancelled')
      ) {
        const suppressed = suppressedPendingRef.current.get(eventSessionId);
        if (suppressed) {
          const requestId = readPermissionRequestId(event);
          if (requestId) {
            suppressed.delete(requestId);
          }

          if (!requestId || suppressed.size === 0) {
            suppressedPendingRef.current.delete(eventSessionId);
          }
        }
      }

      // A permission answered or cancelled elsewhere ends the wait: clear the
      // row once its last outstanding request is gone. Sessions we never
      // tracked are left alone — their attention may be a plain notice this
      // event has nothing to say about.
      if (
        eventSessionId
        && eventSessionId !== viewedSessionId
        && (event.kind === 'permission_resolved' || event.kind === 'permission_cancelled')
      ) {
        const pending = pendingPermissionRequestIdsRef.current.get(eventSessionId);
        if (pending) {
          const requestId = readPermissionRequestId(event);
          if (requestId) {
            pending.delete(requestId);
          }

          if (!requestId || pending.size === 0) {
            pendingPermissionRequestIdsRef.current.delete(eventSessionId);
            clearSessionAttention(eventSessionId);
          }
        }
      }

      if (
        eventSessionId
        && eventSessionId !== viewedSessionId
        && event.kind !== 'chat_subscribed'
        && event.kind !== 'loading_progress'
        && event.kind !== 'session_upserted'
        // A change to the session's scheduled messages is not new activity in it.
        && event.kind !== 'scheduled_messages_changed'
        && event.kind !== 'status'
        && event.kind !== 'stream_end'
        && event.kind !== 'permission_resolved'
        && event.kind !== 'permission_cancelled'
        && event.kind !== 'websocket_reconnected'
      ) {
        markSessionAttention(eventSessionId, getAttentionLevel(event.kind));
      }

      if (event.kind !== 'session_upserted') {
        return;
      }

      const upsert = event as SessionUpsertedEvent;
      if (!upsert.sessionId || !upsert.session) {
        return;
      }

      // The transcript of the currently viewed session changed on disk while
      // no run is active here (e.g. edited from another client or the CLI):
      // signal the chat view to reload its messages.
      const currentSelectedSession = selectedSessionRef.current;
      if (
        currentSelectedSession
        && upsert.sessionId === currentSelectedSession.id
        && !isSessionProcessing(upsert.sessionId)
      ) {
        setExternalMessageUpdate((prev) => prev + 1);
      } else if (upsert.session.change !== 'metadata') {
        // A metadata-only refresh — a title change, a fork, or a bare file
        // `touch` — carries no new conversation, so it must not raise the
        // unread capsule. That distinction is the whole point of the flag.
        // The upsert names the content it advances to, which is what tells a
        // genuinely new reply apart from a re-announcement of one already read.
        markSessionAttention(upsert.sessionId, 'notice', upsert.session.contentUpdatedAt);
      }

      setProjects((previousProjects) => {
        const targetProjectId = upsert.project?.projectId;
        const existingProject = previousProjects.find((project) =>
          targetProjectId ? project.projectId === targetProjectId : getProjectSessions(project).some((session) => session.id === upsert.sessionId),
        );

        if (!existingProject) {
          // First session of a project this client has never seen: create the
          // project entry from the event payload.
          if (!upsert.project) {
            return previousProjects;
          }

          const newProject: Project = {
            projectId: upsert.project.projectId,
            path: upsert.project.path,
            fullPath: upsert.project.fullPath,
            displayName: upsert.project.displayName,
            isStarred: upsert.project.isStarred,
            sessions: [],
            sessionMeta: { hasMore: false, total: 0 },
          } as Project;

          return [...previousProjects, upsertSessionIntoProject(newProject, upsert)];
        }

        const updatedProject = upsertSessionIntoProject(existingProject, upsert);
        if (updatedProject === existingProject) {
          return previousProjects;
        }

        return previousProjects.map((project) =>
          project.projectId === existingProject.projectId ? updatedProject : project,
        );
      });

      // Session-list changes belong to the sidebar's `projects` collection.
      // Only propagate workspace metadata changes to the selected project so
      // a background session upsert does not wake the main content tree.
      setSelectedProject((previousProject) => {
        if (!previousProject || !upsert.project) {
          return previousProject;
        }
        if (previousProject.projectId !== upsert.project.projectId) {
          return previousProject;
        }
        return mergeProjectSelectionMetadata(previousProject, upsert.project);
      });

      const aliasedSelectedSessionId =
        typeof upsert.providerSessionId === 'string' && upsert.providerSessionId !== upsert.sessionId
          ? upsert.providerSessionId
          : null;
      if (!aliasedSelectedSessionId) {
        return;
      }

      const normalizedSelectedSession: ProjectSession = {
        ...upsert.session,
        id: upsert.sessionId,
        __provider: upsert.provider,
        __projectId: upsert.project?.projectId ?? currentSelectedSession?.__projectId,
      };

      setSelectedSession((previousSession) => {
        if (previousSession?.id !== aliasedSelectedSessionId) {
          return previousSession;
        }

        return {
          ...previousSession,
          ...normalizedSelectedSession,
        };
      });

      if (sessionId === aliasedSelectedSessionId) {
        navigate(`/session/${upsert.sessionId}`);
      }
    };

    return subscribe(handleEvent);
  }, [clearSessionAttention, isSessionProcessing, markSessionAttention, navigate, refreshProjectsSilently, sessionId, subscribe]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  /**
   * The session that was on screen the last time the effect below ran. Leaving a
   * session that is still blocked on a suppressed approval flags its row here,
   * with no wait on the poll.
   */
  const previousViewedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const viewedSessionId = selectedSession?.id ?? sessionId ?? null;
    const previousViewedSessionId = previousViewedSessionIdRef.current;
    previousViewedSessionIdRef.current = viewedSessionId;

    // Leaving a session that is still blocked flags it at once. Reading the
    // suppressed map — which drops answered requests in real time — is what keeps
    // an already-answered approval from coming back as a false capsule.
    if (
      previousViewedSessionId
      && previousViewedSessionId !== viewedSessionId
      && suppressedPendingRef.current.has(previousViewedSessionId)
    ) {
      setAttentionStates((previous) => {
        if (previous.get(previousViewedSessionId)?.level === 'action') {
          return previous;
        }

        const next = new Map(previous);
        next.set(previousViewedSessionId, { level: 'action', seenAt: null });
        return next;
      });
    }

    // Persist the read watermark for both the session being left and the one
    // being entered, using each one's *current* content timestamp (read from the
    // freshest project list, not a snapshot taken on open). Writing on leave is
    // what covers the main path — "a message arrived while I was watching, then
    // I switched away" — and writing on enter covers an app closed while a
    // session was on screen. The content timestamp, never the file mtime, is
    // what makes a bare `touch` a no-op here.
    for (const targetSessionId of [previousViewedSessionId, viewedSessionId]) {
      if (!targetSessionId) {
        continue;
      }
      const targetSession = findSessionByIdInProjects(projectsRef.current, targetSessionId);
      if (targetSession) {
        markSessionSeen(targetSessionId, targetSession.contentUpdatedAt);
      }
    }

    // Looking at a session does not answer it. This used to drop the flag for
    // the session being watched; now it only starts the grace period, so a
    // session the user glanced at and did not deal with is still flagged when
    // they look back at the sidebar. Handling it — sending, or leaving a draft
    // — is what clears the flag, plus the grace period as the backstop.
    noteSessionViewed(viewedSessionId);
  }, [noteSessionViewed, selectedSession?.id, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      // The root route represents a new/empty chat. Clear the denormalized
      // selection as soon as the URL no longer carries a session id; otherwise
      // the previous URL value can win one render before navigate('/') lands
      // and leave ChatInterface in the "continue" state.
      setSelectedSession(null);
      return;
    }

    // Project membership is resolved through `projectId` after the migration.
    for (const project of projects) {
      const match = project.sessions?.find((session) => session.id === sessionId);
      if (match) {
        const normalizedSession = normalizeSessionProvider(match);
        const shouldUpdateProject = selectedProject?.projectId !== project.projectId;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== normalizedSession.__provider;

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession(normalizedSession);
        }
        return;
      }
    }

    if (selectedSession?.id === sessionId) {
      return;
    }

    // Session id is in the URL but not present on any loaded project payload.
    // The payloads are paginated (only each project's first session page is
    // loaded), so this is normal for deep links to older sessions. Never guess
    // the owning project from local state — that used to bind the session to
    // whatever project happened to be selected. Ask the backend instead; one
    // lookup per URL id.
    if (sessionLookupRef.current === sessionId) {
      return;
    }
    sessionLookupRef.current = sessionId;

    void (async () => {
      let details: SessionDetailsApiPayload['data'] | null = null;
      try {
        const response = await api.sessionDetails(sessionId);
        if (response.ok) {
          const payload = (await response.json()) as SessionDetailsApiPayload;
          details = payload.data ?? null;
        }
      } catch (error) {
        console.error(`Error resolving session ${sessionId}:`, error);
      }

      // The user navigated elsewhere while the lookup was in flight.
      if (sessionIdRef.current !== sessionId) {
        return;
      }

      if (!details) {
        // Unknown session id (or lookup failed). Fall back to the legacy
        // behavior: host a placeholder under the currently selected project so
        // chat state stays alive (without a `selectedSession`, chat clears
        // `currentSessionId` and stops reading the session store).
        const fallbackProject = selectedProjectRef.current;
        if (!fallbackProject || selectedSessionRef.current?.id === sessionId) {
          return;
        }

        setSelectedSession({
          id: sessionId,
          __provider: readSelectedProvider(),
          __projectId: fallbackProject.projectId,
          summary: '',
        });
        return;
      }

      // The URL carried a provider-native alias id: swap it for the canonical
      // app-facing id and let this effect re-run against the new URL.
      if (typeof details.sessionId === 'string' && details.sessionId && details.sessionId !== sessionId) {
        navigate(`/session/${details.sessionId}`, { replace: true });
        return;
      }

      const resolvedProjectId = details.project?.projectId;
      if (resolvedProjectId) {
        setSelectedProject((previousProject) => {
          if (previousProject?.projectId === resolvedProjectId) {
            return previousProject;
          }

          const loadedProject = projectsRef.current.find(
            (candidate) => candidate.projectId === resolvedProjectId,
          );
          if (loadedProject) {
            return loadedProject;
          }

          // Owning project is not in the active project list (e.g. archived):
          // synthesize a minimal entry so the chat view still gets its paths.
          return {
            projectId: resolvedProjectId,
            path: details.project?.path ?? details.project?.fullPath ?? '',
            fullPath: details.project?.fullPath ?? details.project?.path ?? '',
            displayName: details.project?.displayName ?? '',
            isStarred: Boolean(details.project?.isStarred),
            sessions: [],
            sessionMeta: { hasMore: false, total: 0 },
          };
        });
      }

      const resolvedSession: ProjectSession = {
        id: sessionId,
        summary: details.summary ?? '',
        createdAt: details.createdAt ?? undefined,
        lastActivity: details.lastActivity ?? undefined,
        __provider:
          typeof details.provider === 'string' && details.provider.trim()
            ? (details.provider as LLMProvider)
            : readSelectedProvider(),
        __projectId: resolvedProjectId,
      };

      setSelectedSession((previousSession) =>
        previousSession?.id === sessionId
          ? { ...previousSession, ...resolvedSession }
          : resolvedSession,
      );
    })();
  }, [navigate, sessionId, projects, selectedProject, selectedSession?.id, selectedSession?.__provider]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      // Selecting deliberately no longer clears the session's flag: the view
      // effect below starts its grace period instead, so leaving without
      // replying keeps the row marked.
      setSelectedSession(session);

      if (activeTab === 'tasks' || activeTab === 'browser') {
        setActiveTab('chat');
      }

      if (isMobile) {
        // Sessions are tagged with the owning project's DB `projectId` when
        // picked from the sidebar (see useSidebarController); compare against
        // the current selection's `projectId` so we know whether to collapse
        // the sidebar after navigation.
        const sessionProjectId = session.__projectId;
        const currentProjectId = selectedProject?.projectId;

        if (sessionProjectId !== currentProjectId) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, selectedProject?.projectId],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      setNewSessionTrigger((previous) => previous + 1);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      clearSessionAttention(sessionIdToDelete);
      // The server drops every read-state row for a deleted session; mirror that
      // here so a reused id cannot inherit the old watermark.
      clearSessionReadState(sessionIdToDelete);
      // The in-memory turn timings are keyed by session too, so a churned-through
      // session would otherwise keep every turn it ever timed for this context's
      // whole lifetime.
      clearTurnDurations(sessionIdToDelete);

      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => removeSessionFromProject(project, sessionIdToDelete)),
      );
    },
    [clearSessionAttention, navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async (
    { skipSynchronization = false }: { skipSynchronization?: boolean } = {},
  ) => {
    try {
      const response = await api.projects({ skipSynchronization });
      const freshProjects = (await response.json()) as Project[];
      const projectsWithTaskMaster = mergeTaskMasterCache(freshProjects, projects);
      const mergedProjects = mergeExpandedSessionPages(projects, projectsWithTaskMaster);

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, mergedProjects) ? mergedProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = mergedProjects.find((project) => project.projectId === selectedProject.projectId);
      if (!refreshedProject) {
        return;
      }

      setSelectedProject((previousProject) => (
        previousProject?.projectId === refreshedProject.projectId
          ? mergeProjectSelectionMetadata(previousProject, refreshedProject)
          : previousProject
      ));

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [projects, selectedProject, selectedSession]);

  /**
   * Persists a new title for one session and writes it onto both local copies
   * — the sidebar row in `projects` and the workspace header's `selectedSession`
   * — the moment the backend confirms. The rename route only updates the DB; it
   * does not broadcast a `session_upserted`, so nothing else would refresh the
   * header. Patching in place rather than refetching also keeps every session
   * page the sidebar has loaded past the first. The sidebar's Conversations
   * list folds the new title in from `projects` itself.
   *
   * Resolves `false` when the backend refused the rename; transport errors
   * propagate so the caller can tell the two apart, as the sidebar does.
   */
  const renameSession = useCallback(async (sessionIdToRename: string, summary: string): Promise<boolean> => {
    const trimmed = summary.trim();
    if (!trimmed) {
      return false;
    }

    const response = await api.renameSession(sessionIdToRename, trimmed);
    if (!response.ok) {
      console.error('[Workspace] Failed to rename session:', response.status);
      return false;
    }

    setProjects((previousProjects) => {
      let changed = false;
      const nextProjects = previousProjects.map((project) => {
        const renamedProject = renameSessionInProject(project, sessionIdToRename, trimmed);
        if (renamedProject !== project) {
          changed = true;
        }
        return renamedProject;
      });
      return changed ? nextProjects : previousProjects;
    });

    setSelectedSession((previousSession) => {
      if (previousSession?.id !== sessionIdToRename || previousSession.summary === trimmed) {
        return previousSession;
      }
      // A session opened from a Conversations search hit carries the one-shot
      // jump target the chat reads off every new `selectedSession` identity.
      // Leave it behind, or the rename would scroll the transcript back to the
      // matched message and flash the search highlight again.
      const { __searchTargetSnippet: _snippet, __searchTargetTimestamp: _timestamp, ...session } = previousSession;
      return { ...session, summary: trimmed };
    });

    return true;
  }, []);

  const loadMoreProjectSessions = useCallback(async (projectId: string) => {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project) {
      return;
    }

    const loadedCount = countLoadedProjectSessions(project);
    const totalCount = Number(project.sessionMeta?.total ?? 0);
    if (totalCount > 0 && loadedCount >= totalCount) {
      return;
    }

    const response = await api.projectSessions(projectId, {
      limit: 20,
      offset: loadedCount,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string | { message?: string } };
      const errorPayload = payload.error;
      const message =
        typeof errorPayload === 'string'
          ? errorPayload
          : errorPayload && typeof errorPayload === 'object' && errorPayload.message
            ? errorPayload.message
            : `Failed to load more sessions for project ${projectId}`;
      throw new Error(message);
    }

    const sessionsPage = (await response.json()) as ProjectSessionPage;

    setProjects((previousProjects) =>
      previousProjects.map((candidate) => {
        if (candidate.projectId !== projectId) {
          return candidate;
        }

        return mergeProjectSessionPage(candidate, sessionsPage);
      }),
    );
  }, [projects]);

  // `projectId` is the DB identifier passed from the sidebar's delete flow
  // after the migration away from folder-derived project names.
  const handleProjectDelete = useCallback(
    (projectId: string) => {
      if (selectedProject?.projectId === projectId) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.projectId !== projectId));
    },
    [navigate, selectedProject?.projectId],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      attentionSessions,
      createdConversation,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onLoadMoreSessions: loadMoreProjectSessions,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => openSettings(),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      attentionSessions,
      createdConversation,
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      loadMoreProjectSessions,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      openSettings,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setShowSettings,
    openSettings,
    fetchProjects,
    refreshProjectsSilently,
    registerOptimisticSession,
    registerForkedSession,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    loadMoreProjectSessions,
    handleProjectDelete,
    handleSidebarRefresh,
    renameSession,
  };
}
