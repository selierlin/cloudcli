import { useTranslation } from 'react-i18next';

import type { LLMProvider, ProviderAuthStatusMap } from '@/shared/types';
import AgentConnectionCard from '@/modules/onboarding/AgentConnectionCard';

type AgentConnectionsStepProps = {
  providerStatuses: ProviderAuthStatusMap;
  onOpenProviderLogin: (provider: LLMProvider) => void;
};

const providerCards = [
  {
    provider: 'claude' as const,
    title: 'Claude Code',
    connectedClassName: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    iconContainerClassName: 'bg-blue-100 dark:bg-blue-900/30',
    loginButtonClassName: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    provider: 'cursor' as const,
    title: 'Cursor',
    connectedClassName: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
    iconContainerClassName: 'bg-purple-100 dark:bg-purple-900/30',
    loginButtonClassName: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    provider: 'codex' as const,
    title: 'OpenAI Codex',
    connectedClassName: 'bg-muted dark:bg-muted/50 border-input',
    iconContainerClassName: 'bg-muted',
    loginButtonClassName: 'bg-n-gray-800 hover:bg-n-gray-900 dark:bg-n-gray-700 dark:hover:bg-n-gray-600',
  },
  {
    provider: 'opencode' as const,
    title: 'OpenCode',
    connectedClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800/50 border-n-zinc-300 dark:border-n-zinc-600',
    iconContainerClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800',
    loginButtonClassName: 'bg-n-zinc-800 hover:bg-n-zinc-900 dark:bg-n-zinc-700 dark:hover:bg-n-zinc-600',
  },
  {
    provider: 'workbuddy' as const,
    title: 'WorkBuddy',
    connectedClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800/50 border-n-zinc-300 dark:border-n-zinc-600',
    iconContainerClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800',
    loginButtonClassName: 'bg-n-zinc-800 hover:bg-n-zinc-900 dark:bg-n-zinc-700 dark:hover:bg-n-zinc-600',
  },
  {
    provider: 'pi' as const,
    title: 'Pi',
    connectedClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800/50 border-n-zinc-300 dark:border-n-zinc-600',
    iconContainerClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800',
    loginButtonClassName: 'bg-n-zinc-800 hover:bg-n-zinc-900 dark:bg-n-zinc-700 dark:hover:bg-n-zinc-600',
  },
  {
    provider: 'zcode' as const,
    title: 'ZCode',
    connectedClassName: 'bg-n-neutral-100 dark:bg-n-neutral-800/50 border-n-neutral-300 dark:border-n-neutral-600',
    iconContainerClassName: 'bg-n-neutral-100 dark:bg-n-neutral-800',
    loginButtonClassName: 'bg-n-neutral-800 hover:bg-n-neutral-900 dark:bg-n-neutral-700 dark:hover:bg-n-neutral-600',
  },
  {
    provider: 'omp' as const,
    title: 'OMP',
    connectedClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800/50 border-n-zinc-300 dark:border-n-zinc-600',
    iconContainerClassName: 'bg-n-zinc-100 dark:bg-n-zinc-800',
    loginButtonClassName: 'bg-n-zinc-800 hover:bg-n-zinc-900 dark:bg-n-zinc-700 dark:hover:bg-n-zinc-600',
  },
];

/** Rendered by Onboarding as its second step, listing every CLI provider the user can log into. */
export default function AgentConnectionsStep({
  providerStatuses,
  onOpenProviderLogin,
}: AgentConnectionsStepProps) {
  const { t } = useTranslation('auth');
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="font-serif text-xl font-bold tracking-tight text-foreground">{t('onboarding.agentsStepTitle')}</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t('onboarding.agentsStepDescription')}
        </p>
      </div>

      <div className="-mr-1 max-h-[38vh] space-y-2 overflow-y-auto pr-1">
        {providerCards.map((providerCard) => (
          <AgentConnectionCard
            key={providerCard.provider}
            provider={providerCard.provider}
            title={providerCard.title}
            status={providerStatuses[providerCard.provider]}
            connectedClassName={providerCard.connectedClassName}
            iconContainerClassName={providerCard.iconContainerClassName}
            loginButtonClassName={providerCard.loginButtonClassName}
            onLogin={() => onOpenProviderLogin(providerCard.provider)}
          />
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">{t('onboarding.agentsLaterHint')}</p>
    </div>
  );
}
