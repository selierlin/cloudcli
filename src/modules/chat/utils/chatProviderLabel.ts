type ChatProviderTranslator = (key: string, options?: { defaultValue?: string }) => string;

/** Resolves the provider name shown in chat empty states and composer hints. */
export function getChatProviderLabel(provider: string, t: ChatProviderTranslator): string {
  switch (provider) {
    case 'cursor':
      return t('messageTypes.cursor');
    case 'codex':
      return t('messageTypes.codex');
    case 'opencode':
      return t('messageTypes.opencode', { defaultValue: 'OpenCode' });
    case 'dsh':
      return t('messageTypes.dsh', { defaultValue: 'DeepSeek Harness' });
    case 'workbuddy':
      return t('messageTypes.workbuddy', { defaultValue: 'WorkBuddy' });
    default:
      return t('messageTypes.claude');
  }
}
