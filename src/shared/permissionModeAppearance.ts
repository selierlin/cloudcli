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
export type PermissionModeAccent = 'neutral' | 'info' | 'success' | 'warning' | 'primary';

type PermissionModeAppearance = {
  icon: LucideIcon;
  accent: PermissionModeAccent;
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
 * The one accent palette per mode.
 *
 * The composer's trigger and settings' mode card draw the same mode, so they
 * must not keep two palettes: that is how plan mode came to be primary-tinted
 * in chat and blue in settings. Colour values live here; each surface decides
 * how much of the palette to use (the trigger fills a pill, the card tints a
 * selected row).
 */
export const PERMISSION_MODE_ACCENT_CLASSES: Record<
  PermissionModeAccent,
  { foreground: string; label: string; surface: string; hover: string }
> = {
  neutral: {
    // The trigger is a subdued control, so its neutral state reads muted; a
    // menu row or card title is body text and stays at full contrast.
    foreground: 'text-muted-foreground',
    label: 'text-foreground',
    surface: 'border-border/60 bg-muted/50',
    hover: 'hover:bg-muted',
  },
  info: {
    foreground: 'text-blue-700 dark:text-blue-300',
    label: 'text-blue-700 dark:text-blue-300',
    surface: 'border-blue-300/60 bg-blue-50 dark:border-blue-600/40 dark:bg-blue-900/15',
    hover: 'hover:bg-blue-100 dark:hover:bg-blue-900/25',
  },
  success: {
    foreground: 'text-green-700 dark:text-green-300',
    label: 'text-green-700 dark:text-green-300',
    surface: 'border-green-300/60 bg-green-50 dark:border-green-600/40 dark:bg-green-900/15',
    hover: 'hover:bg-green-100 dark:hover:bg-green-900/25',
  },
  warning: {
    foreground: 'text-orange-600 dark:text-orange-400',
    label: 'text-orange-600 dark:text-orange-400',
    surface: 'border-orange-300/60 bg-orange-50 dark:border-orange-600/40 dark:bg-orange-900/15',
    hover: 'hover:bg-orange-100 dark:hover:bg-orange-900/25',
  },
  primary: {
    foreground: 'text-primary',
    label: 'text-primary',
    surface: 'border-primary/20 bg-primary/5',
    hover: 'hover:bg-primary/10',
  },
};

/**
 * Used by chat's ComposerPermissionMenu and settings' permissions panel. A mode
 * the backend reports but this build has no appearance for still renders,
 * through the unknown fallback, instead of crashing or rendering nothing.
 */
export const getPermissionModeAppearance = (mode: PermissionMode | string): PermissionModeAppearance =>
  APPEARANCE[mode as PermissionMode] ?? UNKNOWN;
