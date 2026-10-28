import { useTranslation } from 'react-i18next';

import { getPermissionModeAppearance } from '@/shared/permissionModeAppearance';
import type { LLMProvider, PermissionMode } from '@/shared/types';

/**
 * How a permission mode is named and explained.
 *
 * Used by chat's composer permission menu, the side-ask header and settings'
 * per-provider permission panel, so all three say the same thing.
 *
 * Two layers, and only two:
 *
 * 1. `permissions.modes.<mode>` — the canonical name and description of the
 *    mode itself. Every provider reads this, so `bypassPermissions` is called
 *    the same thing in every harness.
 * 2. `permissions.<provider>.modes.<mode>` — an override, used *only* where the
 *    same enum value means something else for that provider. `default` is the
 *    one that really differs: Claude's is an allowlist, Pi's runs autonomously,
 *    ZCode's build mode is read-only. Overrides stay out of the naming layer
 *    otherwise; a second name for a shared mode is what let "无限制" and
 *    "无限制模式" describe the same thing in two panels.
 */
export function usePermissionModeCopy(
  provider: LLMProvider | string | undefined,
  mode: PermissionMode | string,
): { label: string; description: string } {
  const { t } = useTranslation();
  const appearance = getPermissionModeAppearance(mode);

  const providerLabel = provider
    ? t(`permissions.${provider}.modes.${mode}.title`, { ns: 'settings', defaultValue: '' })
    : '';
  const label = providerLabel
    || t(`permissions.modes.${mode}.title`, { ns: 'settings', defaultValue: '' })
    || appearance.fallbackLabel
    || String(mode);

  const providerDescription = provider
    ? t(`permissions.${provider}.modes.${mode}.description`, { ns: 'settings', defaultValue: '' })
    : '';
  const description = providerDescription
    || t(`permissions.modes.${mode}.description`, { ns: 'settings', defaultValue: '' });

  return { label, description };
}
