import type { ProjectSession } from '../../../../types/app';

export function shouldShowProviderSelection(
  selectedSession: ProjectSession | null,
  _currentSessionId: string | null,
): boolean {
  // `currentSessionId` is local state and can briefly retain the previous
  // conversation while an explicit New Session action has already cleared the
  // canonical selected session. The canonical selection determines this view.
  return !selectedSession;
}
