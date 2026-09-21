import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

import type { LLMProvider } from '@/shared/types';
import { LLMProviderLogo } from '@/shared/ui';
import { getChatProviderLabel } from '@/modules/chat/utils/chatProviderLabel';

type ExecutionProcessSummaryProps = {
  collapsed: boolean;
  activityLabel?: string;
  hasAttention: boolean;
  isActiveRun: boolean;
  isWindowTruncated: boolean;
  labelKind: 'reasoning' | 'execution' | 'narration';
  /** The process belongs to this harness even after its member rows unmount. */
  provider: LLMProvider;
  /** Matches the inert marker immediately after this process's final member. */
  processEndKey: string;
  toolCount: number;
  onToggle: () => void;
};

const ACTIVITY_LABEL_MAX_LENGTH = 48;
// Deadzone for re-engaging sticky: once the tail has passed the pinned title we
// only re-stick after the user scrolls back past this margin, so tiny scroll
// jitter at the boundary can't pop the pinned title in and out (flicker).
const STICKY_REENGAGE_MARGIN = 24;

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
  provider,
  processEndKey,
  toolCount,
  onToggle,
}: ExecutionProcessSummaryProps) {
  const { t } = useTranslation('chat');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // The summary remains a transcript sibling, so member rows retain their DOM
  // identity as a live run grows. This state turns sticky positioning off once
  // the inert end marker reaches the panel top, limiting it to the process.
  const [isSticky, setIsSticky] = useState(!collapsed);

  useLayoutEffect(() => {
    if (collapsed) {
      return;
    }

    const button = buttonRef.current;
    const scrollContainer = button?.closest<HTMLElement>('.chat-messages-pane');
    if (!button || !scrollContainer) {
      return;
    }

    const endMarker = [...scrollContainer.querySelectorAll<HTMLElement>('[data-execution-process-end]')]
      .find((marker) => marker.dataset.executionProcessEnd === processEndKey);
    if (!endMarker) {
      return;
    }

    const updateSticky = () => {
      const panelRect = scrollContainer.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const endRect = endMarker.getBoundingClientRect();
      const buttonAtOrAbovePanel = buttonRect.top <= panelRect.top;
      const tailClearsPin = endRect.top > panelRect.top + buttonRect.height;
      const tailClearsPlusMargin = endRect.top > panelRect.top + buttonRect.height + STICKY_REENGAGE_MARGIN;

      setIsSticky((current) => {
        if (current) {
          // Stuck: stay pinned until the process tail reaches the pinned title.
          return tailClearsPin;
        }
        // Free: only re-stick once the tail has clearly cleared the pin zone by
        // the margin, so boundary jitter can't make the title pop in and out.
        return buttonAtOrAbovePanel && tailClearsPlusMargin;
      });
    };

    scrollContainer.addEventListener('scroll', updateSticky, { passive: true });
    window.addEventListener('resize', updateSticky);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(updateSticky);
    resizeObserver?.observe(button);
    resizeObserver?.observe(endMarker);
    updateSticky();

    return () => {
      scrollContainer.removeEventListener('scroll', updateSticky);
      window.removeEventListener('resize', updateSticky);
      resizeObserver?.disconnect();
    };
  }, [collapsed, processEndKey]);
  const providerLabel = getChatProviderLabel(provider, t);
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
    <>
      <div className="mb-2 flex items-center space-x-3 px-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-sm text-foreground">
          <LLMProviderLogo provider={provider} className="h-full w-full" />
        </div>
        <div className="text-sm font-medium text-gray-900 dark:text-white">{providerLabel}</div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        className={`group flex min-h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${!collapsed && isSticky ? 'sticky -top-3 sm:-top-4 z-10 bg-background/95 backdrop-blur-sm' : ''}`}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
        />
        <span className="min-w-0 truncate">{[label, ...details].join(' · ')}</span>
      </button>
    </>
  );
}
