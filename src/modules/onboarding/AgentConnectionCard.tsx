import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PROVIDERS_WITH_IN_APP_LOGIN } from '@/shared/constants';
import { LLMProviderLogo } from '@/shared/ui';
import type { LLMProvider, ProviderAuthStatus } from '@/shared/types';

type AgentConnectionCardProps = {
  provider: LLMProvider;
  title: string;
  status: ProviderAuthStatus;
  connectedClassName: string;
  iconContainerClassName: string;
  loginButtonClassName: string;
  onLogin: () => void;
};

/** Rendered by onboarding's AgentConnectionsStep to show one CLI provider's connection state. */
export default function AgentConnectionCard({
  provider,
  title,
  status,
  connectedClassName,
  iconContainerClassName,
  loginButtonClassName,
  onLogin,
}: AgentConnectionCardProps) {
  const { t } = useTranslation('settings');
  // WorkBuddy Desktop manages its CLI auth out-of-band, so its own agent
  // (and the desktop CLIs it provisions, e.g. DeepSeek Harness / Codex)
  // count as available without an in-app login button.
  const externallyManaged = status.authVerified === false
    && status.installed === true
    && status.method === 'workbuddy_desktop';
  const available = status.authenticated || externallyManaged;
  // ZCode, Pi, OMP, OpenClaw and WorkBuddy Desktop authenticate out-of-band (a
  // config file, their own `auth`/`/login` flow, or the desktop app), so a login
  // button would only open a terminal that prints instructions.
  const canLogin = PROVIDERS_WITH_IN_APP_LOGIN.includes(provider) && !available && !status.loading;
  const containerClassName = available ? connectedClassName : 'border-border bg-card';

  // Same rule as the settings account panel: report the state the badge and
  // login button already act on, never the server's raw diagnostic (it is
  // English, and for these providers it only says "nothing configured yet").
  const statusText = status.loading
    ? t('agents.authStatus.checking')
    : externallyManaged
      ? `${t('agents.externalAuth.available')} (${t('agents.externalAuth.managedByDesktop')})`
      : !PROVIDERS_WITH_IN_APP_LOGIN.includes(provider)
        ? t('agents.externalAuth.description', { agent: title })
        : !status.installed
          ? t('agents.authStatus.notInstalled')
          : status.authenticated
            ? status.email || t('agents.authStatus.connected')
            : t('agents.authStatus.notConnected');

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${containerClassName}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${iconContainerClassName}`}>
            <LLMProviderLogo provider={provider} className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {title}
              {available && <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />}
            </div>
            <div className="truncate text-xs text-muted-foreground" title={statusText}>{statusText}</div>
          </div>
        </div>

        {canLogin && (
          <button
            onClick={onLogin}
            className={`${loginButtonClassName} flex-shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium text-n-white transition-colors`}
          >
            {t('agents.login.button')}
          </button>
        )}
      </div>
    </div>
  );
}
