import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

type ExecutionProcessSummaryProps = {
  collapsed: boolean;
  hasAttention: boolean;
  isWindowTruncated: boolean;
  labelKind: 'reasoning' | 'execution';
  toolCount: number;
  onToggle: () => void;
};

/** Used by ChatMessagesPane to disclose a turn's earlier execution rows. */
export default function ExecutionProcessSummary({
  collapsed,
  hasAttention,
  isWindowTruncated,
  labelKind,
  toolCount,
  onToggle,
}: ExecutionProcessSummaryProps) {
  const { t } = useTranslation('chat');
  const label = labelKind === 'reasoning'
    ? t('transcript.executionProcess.reasoning', { defaultValue: 'Thinking process' })
    : t('transcript.executionProcess.execution', { defaultValue: 'Execution process' });
  const details = [
    toolCount > 0
      ? t('transcript.executionProcess.toolCount', {
          count: toolCount,
          defaultValue: '{{count}} tool calls',
        })
      : null,
    hasAttention
      ? t('transcript.executionProcess.attention', { defaultValue: 'needs attention' })
      : null,
    isWindowTruncated
      ? t('transcript.executionProcess.truncated', { defaultValue: 'earlier history not loaded' })
      : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className="group inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <ChevronRight
        aria-hidden="true"
        className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
      />
      <span>{[label, ...details].join(' · ')}</span>
    </button>
  );
}
