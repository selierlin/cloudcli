import { useTranslation } from 'react-i18next';

import { getPermissionModeAppearance } from '@/shared/permissionModeAppearance';
import { hasProviderSpecificModeName } from '@/shared/permissionModes';
import type { LLMProvider, PermissionMode } from '@/shared/types';

/**
 * How a permission mode is named and explained.
 *
 * Used by chat's composer permission menu, the side-ask header and settings'
 * per-provider permission panel, so all three say the same thing.
 *
 * Two layers:
 *
 * 1. `permissions.modes.<mode>` — the canonical name and description. Every
 *    provider reads this, so `bypassPermissions` is called the same thing in
 *    every harness. That is only right when the mechanism is the same.
 * 2. `permissions.<provider>.modes.<mode>` — an override. A description is
 *    always allowed: provider-specific nuance belongs there. A *title* is only
 *    read for the (provider, mode) pairs declared in
 *    `PROVIDER_SPECIFIC_MODE_NAMES`, i.e. where the shared name would describe
 *    a different mechanism — `auto` is a classifier in Claude, in-process
 *    approval in WorkBuddy and an ACP "allow once" answer in DSH/OpenClaw.
 *    Without that gate, every provider would drift back into its own word for
 *    the same switch; with it, a second name is a deliberate, reviewed choice.
 */
export function usePermissionModeCopy(
  provider: LLMProvider | string | undefined,
  mode: PermissionMode | string,
): { label: string; description: string } {
  const { t } = useTranslation();
  const appearance = getPermissionModeAppearance(mode);
  const namedPerProvider = hasProviderSpecificModeName(provider, mode);

  const providerLabel = provider && namedPerProvider
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
