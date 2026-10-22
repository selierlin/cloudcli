import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import type { LLMProvider, PermissionMode, ProjectSession, QueuedSendOptions } from '@/shared/types';
import { readUserPreference } from '@/shared/userSettings';

/**
 * The notification summary a sent turn carries, derived from the conversation
 * title and falling back to the message itself.
 *
 * Used by `buildChatSendOptions` and by the background-task confirmation,
 * which shows the same title a notification would.
 */
export const getNotificationSessionSummary = (
  selectedSession: ProjectSession | null,
  fallbackInput: string,
): string | null => {
  const sessionSummary = selectedSession?.summary || selectedSession?.name || selectedSession?.title;
  if (typeof sessionSummary === 'string' && sessionSummary.trim()) {
    const normalized = sessionSummary.replace(/\s+/g, ' ').trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  }

  const normalizedFallback = fallbackInput.replace(/\s+/g, ' ').trim();
  if (!normalizedFallback) {
    return null;
  }

  return normalizedFallback.length > 80 ? `${normalizedFallback.slice(0, 77)}...` : normalizedFallback;
};

type ChatSendOptionsArgs = {
  provider: LLMProvider;
  model: string;
  effort: string;
  /** The composer's UI permission mode, before provider-specific resolution. */
  permissionMode: PermissionMode | string;
  resolvePermissionModeForProvider: (provider: LLMProvider, requestedMode: PermissionMode | string) => PermissionMode;
  selectedSession: ProjectSession | null;
};

/**
 * Builds everything `chat.send` needs beyond its text.
 *
 * Both composers — the conversation's main one and the side-question drawer's —
 * call this, so a turn sent from the drawer cannot drift from the same turn
 * sent in the main input: the permission mode (including the provider's
 * `skipPermissions` override), the model, the effort and the tool settings all
 * come from one definition. Hand-building this object in a second place is how
 * the drawer would silently run under different permissions.
 */
export function buildChatSendOptions({
  provider,
  model,
  effort,
  permissionMode,
  resolvePermissionModeForProvider,
  selectedSession,
}: ChatSendOptionsArgs, currentInput: string): QueuedSendOptions {
  const toolsSettings = readUserPreference(
    PROVIDER_PERMISSION_PREFERENCE_KEYS[provider],
    {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
    },
  );

  return {
    model,
    effort,
    permissionMode: resolvePermissionModeForProvider(provider, permissionMode),
    toolsSettings,
    skipPermissions: toolsSettings?.skipPermissions || false,
    sessionSummary: getNotificationSessionSummary(selectedSession, currentInput),
  };
}
