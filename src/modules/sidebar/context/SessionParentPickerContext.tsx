import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

import type { Project } from '@/shared/types';
import { createSessionViewModel, getAllSessions } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import SessionParentPicker from '@/modules/sidebar/modals/SessionParentPicker';
import type { SessionParentCandidate } from '@/modules/sidebar/modals/SessionParentPicker';

/**
 * One session the picker can be opened for. Deliberately a plain descriptor
 * rather than a `SessionWithProvider`: the conversations feed renders rows that
 * never hold a full session, and both call sites already know these four fields.
 */
export type SessionParentTarget = {
  sessionId: string;
  /** Owning project, used to resolve same-project candidates. */
  projectId: string | null;
  /** Display name shown in the picker heading. */
  name: string;
  /** Current parent, so the picker can offer "move to top level". */
  parentSessionId: string | null;
};

type SessionParentPickerContextValue = {
  /** Opens the parent picker for one session. */
  requestAssignParent: (target: SessionParentTarget) => void;
  /**
   * Persists one session's parent, or detaches it with null. Backs both the
   * picker's choice and the sidebar's drag & drop, which is why it is exposed
   * rather than kept behind `requestAssignParent`.
   */
  setSessionParent: (sessionId: string, parentSessionId: string | null) => void;
};

const SessionParentPickerContext = createContext<SessionParentPickerContextValue | null>(null);

/**
 * Reads the sidebar's ownership controls. Returns null where no provider is
 * mounted, which is how a row knows to hide the ownership menu items (and to
 * refuse to start a drag) instead of offering something that cannot work.
 */
export function useSessionParentPicker(): SessionParentPickerContextValue | null {
  return useContext(SessionParentPickerContext);
}

type SessionParentPickerProviderProps = {
  /** The loaded project list, used to resolve a session's same-project siblings. */
  projects: Project[];
  /** Persists one ownership change. */
  setSessionParent: (sessionId: string, parentSessionId: string | null) => void;
  children: ReactNode;
  t: TFunction;
};

/**
 * Owns the sidebar's session-ownership interactions: the "file this session
 * under…" picker and the callback that persists a relationship.
 *
 * Mounted once by the Sidebar so a deeply nested session row can open the
 * picker without threading a callback down through SidebarContent → project
 * list → project item → sessions → row. Candidate resolution lives here because
 * this is the only level that holds the loaded project sessions.
 */
export function SessionParentPickerProvider({
  projects,
  setSessionParent,
  children,
  t,
}: SessionParentPickerProviderProps) {
  const [pendingTarget, setPendingTarget] = useState<SessionParentTarget | null>(null);

  const requestAssignParent = useCallback((target: SessionParentTarget) => {
    setPendingTarget(target);
  }, []);

  // Candidates are same-project, loaded, top-level sessions other than the
  // target itself. Excluding sessions that already have a parent follows from
  // the one-level rule — it also rules out the target's own children, so a
  // session that owns children simply gets an empty list.
  const candidates = useMemo<SessionParentCandidate[]>(() => {
    if (!pendingTarget) {
      return [];
    }

    const project = projects.find((candidate) => candidate.projectId === pendingTarget.projectId)
      ?? projects.find((candidate) => (candidate.sessions ?? []).some((session) => session.id === pendingTarget.sessionId));
    if (!project) {
      return [];
    }

    return getAllSessions(project)
      .filter((session) => session.id !== pendingTarget.sessionId && !session.parentSessionId)
      .map((session) => ({ id: session.id, name: createSessionViewModel(session, t).sessionName }));
  }, [pendingTarget, projects, t]);

  const value = useMemo(
    () => ({ requestAssignParent, setSessionParent }),
    [requestAssignParent, setSessionParent],
  );

  return (
    <SessionParentPickerContext.Provider value={value}>
      {children}
      {pendingTarget && (
        <SessionParentPicker
          sessionName={pendingTarget.name}
          candidates={candidates}
          currentParentId={pendingTarget.parentSessionId}
          onSelect={(parentSessionId) => {
            setSessionParent(pendingTarget.sessionId, parentSessionId);
            setPendingTarget(null);
          }}
          onClose={() => setPendingTarget(null)}
          t={t}
        />
      )}
    </SessionParentPickerContext.Provider>
  );
}
