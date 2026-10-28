import { useTranslation } from 'react-i18next';

import { getPermissionModeAppearance } from '@/shared/permissionModeAppearance';
import type { LLMProvider, PermissionMode } from '@/shared/types';

/**
 * How a permission mode is named and explained.
 *
 * Used by chat's composer permission menu and settings' per-provider permission
 * panel. They used to keep separate strings — the composer had one generic name
 * per mode while settings had a provider-specific one — so the same mode was
 * "默认模式" in one place and "只读" in the other, and each surface carried its
 * own description of what that mode does.
 *
 * Settings is the authority: it is the surface that has to explain a mode in
 * the provider's own terms (pi's `default` is "runs autonomously", not the
 * Claude-style allowlist). Chat's `codex.*` strings remain the fallback for
 * providers settings has no panel text for, and for the tests that render the
 * menu without a provider.
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
    || t(`codex.modes.${mode}`, { ns: 'chat', defaultValue: '' })
    || appearance.fallbackLabel
    || String(mode);

  const providerDescription = provider
    ? t(`permissions.${provider}.modes.${mode}.description`, { ns: 'settings', defaultValue: '' })
    : '';
  const providerScopedChatDescription = provider
    ? t(`codex.descriptions.${provider}.${mode}`, { ns: 'chat', defaultValue: '' })
    : '';
  const description = providerDescription
    || providerScopedChatDescription
    || t(`codex.descriptions.${mode}`, { ns: 'chat', defaultValue: '' });

  return { label, description };
}
