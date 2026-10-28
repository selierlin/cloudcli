import { AlertTriangle, Bot, ClipboardList, EyeOff, Hand, ShieldQuestion, Smile, type LucideIcon } from 'lucide-react';

import type { PermissionMode } from '@/shared/types';

/**
 * How a permission mode looks, independent of where it is drawn.
 *
 * Two surfaces pick a permission mode: chat's composer menu (which also has to
 * colour the trigger button) and settings' per-provider permission panel. They
 * had grown separate icon and colour sets, so the same mode looked different
 * depending on where the user met it. Both now read this record and only map
 * the accent onto their own container classes.
 */
type PermissionModeAppearance = {
  icon: LucideIcon;
  accent: 'neutral' | 'info' | 'success' | 'warning' | 'primary';
  /** English name, used when the active locale has no `permissions.<provider>.modes.<mode>.title`. */
  fallbackLabel: string;
};

const APPEARANCE: Record<PermissionMode, PermissionModeAppearance> = {
  default: { icon: Hand, accent: 'neutral', fallbackLabel: 'Default' },
  auto: { icon: Bot, accent: 'info', fallbackLabel: 'Auto' },
  acceptEdits: { icon: Smile, accent: 'success', fallbackLabel: 'Allow edits' },
  bypassPermissions: { icon: AlertTriangle, accent: 'warning', fallbackLabel: 'Full access' },
  plan: { icon: ClipboardList, accent: 'primary', fallbackLabel: 'Plan only' },
  // Primary as well, matching plan mode: read-only is the "no side effects"
  // sibling of planning.
  readonly: { icon: EyeOff, accent: 'primary', fallbackLabel: 'Read-only' },
};

const UNKNOWN: PermissionModeAppearance = { icon: ShieldQuestion, accent: 'neutral', fallbackLabel: '' };

/**
 * Used by chat's ComposerPermissionMenu and settings' permissions panel. A mode
 * the backend reports but this build has no appearance for still renders,
 * through the unknown fallback, instead of crashing or rendering nothing.
 */
export const getPermissionModeAppearance = (mode: PermissionMode | string): PermissionModeAppearance =>
  APPEARANCE[mode as PermissionMode] ?? UNKNOWN;
