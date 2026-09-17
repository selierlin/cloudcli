import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

type ExecutionProcessSummaryProps = {
  collapsed: boolean;
  activityLabel?: string;
  hasAttention: boolean;
  isActiveRun: boolean;
  isWindowTruncated: boolean;
  labelKind: 'reasoning' | 'execution' | 'narration';
  toolCount: number;
  onToggle: () => void;
};

const ACTIVITY_LABEL_MAX_LENGTH = 48;

function compactActivityLabel(value: string | undefined): string {
  const firstLine = String(value || '').split(/\r?\n/, 1)[0] ?? '';
  const plainText = firstLine
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[\s#>*_`~-]+|[\s*_`~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plainText.length <= ACTIVITY_LABEL_MAX_LENGTH) return plainText;
  return `${plainText.slice(0, ACTIVITY_LABEL_MAX_LENGTH - 1).trimEnd()}…`;
}

/** Used by ChatMessagesPane to disclose a turn's earlier execution rows. */
export default function ExecutionProcessSummary({
  collapsed,
  activityLabel,
  hasAttention,
  isActiveRun,
  isWindowTruncated,
  labelKind,
  toolCount,
  onToggle,
}: ExecutionProcessSummaryProps) {
  const { t } = useTranslation('chat');
  const settledLabel = labelKind === 'reasoning'
    ? t('transcript.executionProcess.reasoning', { defaultValue: 'Thinking process' })
    : labelKind === 'narration'
      ? t('transcript.executionProcess.narration', { defaultValue: 'Process record' })
      : t('transcript.executionProcess.execution', { defaultValue: 'Execution process' });
  const liveActivityLabel = compactActivityLabel(activityLabel);
  const label = isActiveRun
    ? liveActivityLabel || t('transcript.executionProcess.inProgress', { defaultValue: 'Running' })
    : settledLabel;
  const details = [
    toolCount > 0
      ? t(isWindowTruncated
        ? 'transcript.executionProcess.loadedToolCount'
        : 'transcript.executionProcess.toolCount', {
          count: toolCount,
          defaultValue: isWindowTruncated ? '{{count}} loaded tool calls' : '{{count}} tool calls',
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
      className="group flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <ChevronRight
        aria-hidden="true"
        className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
      />
      <span className="min-w-0 truncate">{[label, ...details].join(' · ')}</span>
    </button>
  );
}
