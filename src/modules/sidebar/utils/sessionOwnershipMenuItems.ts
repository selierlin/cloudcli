import { CornerDownRight, CornerUpLeft } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { ActionMenuItem } from '@/shared/ui';

/**
 * Inputs for the two ownership rows a session's options menu may carry.
 *
 * The sidebar hand-writes its session options in several places (project rows,
 * the conversations feed, and their mobile sheets), so the two ownership rows
 * are built here once rather than copied into each menu — the same drift the
 * sidebar has been bitten by before.
 */
export type SessionOwnershipMenuInput = {
  /** The session's current parent, or null when it is top-level. */
  parentSessionId: string | null;
  /** Withheld when the session owns children (one-level rule) or no picker is mounted. */
  canAssignParent: boolean;
  /** Opens the parent picker for this session. */
  onRequestAssignParent?: () => void;
  /** Offered only when the session already has a parent it can be moved out of. */
  onClearParent?: () => void;
  t: TFunction;
};

/** Builds the "file under…" / "move to top level" rows for an `ActionMenu`. */
export const buildSessionOwnershipMenuItems = ({
  parentSessionId,
  canAssignParent,
  onRequestAssignParent,
  onClearParent,
  t,
}: SessionOwnershipMenuInput): ActionMenuItem[] => [
  ...(canAssignParent && onRequestAssignParent
    ? [{
        key: 'assign-parent',
        label: t('sessions.fileUnderSession'),
        description: t('sessions.fileUnderSessionDescription'),
        icon: CornerDownRight,
        onSelect: onRequestAssignParent,
      }]
    : []),
  ...(parentSessionId && onClearParent
    ? [{
        key: 'clear-parent',
        label: t('sessions.moveSessionToTopLevel'),
        icon: CornerUpLeft,
        onSelect: onClearParent,
      }]
    : []),
];
