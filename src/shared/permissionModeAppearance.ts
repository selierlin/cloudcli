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
 * The composer's trigger, the composer's menu rows and settings' mode cards draw
 * the same mode, so they must not keep separate palettes: that is how plan mode
 * came to be primary-tinted in chat and blue in settings. Colour values live
 * here; each surface takes the slice it needs — the trigger fills a pill
 * (`surface` + `foreground` + `hover`), a menu row or a card's title takes
 * `label`. Settings does not tint a selected card with the mode's hue: the hue
 * already names the mode, so selection stays neutral.
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
    // Plan and read-only are primary in light mode (a deliberate, low-risk
    // sibling to auto's blue). In dark mode `--primary` is still the brand hue,
    // which would paint them blue and blur the line with auto — so they drop to
    // a neutral grey there instead. Settings' mode cards and the composer menu
    // both read this `label`, so the two surfaces cannot drift.
    foreground: 'text-primary dark:text-n-gray-400',
    label: 'text-primary dark:text-n-gray-400',
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
