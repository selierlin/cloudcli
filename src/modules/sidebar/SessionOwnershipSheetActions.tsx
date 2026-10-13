import { CornerDownRight, CornerUpLeft } from 'lucide-react';
import type { TFunction } from 'i18next';

/**
 * The ownership rows for a mobile session options bottom sheet.
 *
 * Mirrors `buildSessionOwnershipMenuItems` for the sheets, which hand-write
 * their rows as buttons instead of `ActionMenu` items. Renders nothing when
 * neither row applies, so a sheet without ownership controls keeps its spacing.
 */
type SessionOwnershipSheetActionsProps = {
  /** The session's current parent, or null when it is top-level. */
  parentSessionId: string | null;
  /** Withheld when the session owns children (one-level rule) or no picker is mounted. */
  canAssignParent: boolean;
  onRequestAssignParent?: () => void;
  onClearParent?: () => void;
  /** Runs before the chosen action, so the sheet can close itself first. */
  onBeforeAction?: () => void;
  t: TFunction;
};

const ROW_CLASS =
  'flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted';

export default function SessionOwnershipSheetActions({
  parentSessionId,
  canAssignParent,
  onRequestAssignParent,
  onClearParent,
  onBeforeAction,
  t,
}: SessionOwnershipSheetActionsProps) {
  const showAssign = canAssignParent && Boolean(onRequestAssignParent);
  const showClear = Boolean(parentSessionId) && Boolean(onClearParent);
  if (!showAssign && !showClear) {
    return null;
  }

  return (
    <>
      {showAssign && (
        <button
          type="button"
          onClick={() => {
            onBeforeAction?.();
            onRequestAssignParent?.();
          }}
          className={ROW_CLASS}
        >
          <CornerDownRight className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm font-medium">{t('sessions.fileUnderSession')}</span>
        </button>
      )}

      {showClear && (
        <button
          type="button"
          onClick={() => {
            onBeforeAction?.();
            onClearParent?.();
          }}
          className={ROW_CLASS}
        >
          <CornerUpLeft className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm font-medium">{t('sessions.moveSessionToTopLevel')}</span>
        </button>
      )}
    </>
  );
}
