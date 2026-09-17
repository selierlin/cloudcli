import { memo, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, LLMProvider,DiffLine,DiffStats,Project,ToolGroupItem,ToolStatus } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';
import { ToolStatusBadge } from '@/modules/chat/tools/ToolStatusBadge';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';
import { TOOL_GROUP_THRESHOLD } from '@/modules/chat/utils/toolGrouping';

type ToolGroupContainerProps = {
  group: ToolGroupItem;
  /** Process runs fold even a one-tool batch so opening the run reveals its outline first. */
  collapseSingleTool?: boolean;
  /** Lets the parent Process Run retain this batch's user-owned disclosure across unmounts. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: LLMProvider | string;
  /** Changes whenever search targets one of this group's tools. */
  revealRequestId?: number;
};

/**
 * Totals the lines a run of file edits added and removed.
 *
 * A collapsed group hides every individual diff behind `x4`, so without this
 * the one thing the row could usefully say about a batch of edits — how big it
 * is — is the one thing it did not. Returns null for groups of tools that do
 * not render a diff at all.
 */
function useGroupDiffStats(
  messages: ChatMessage[],
  createDiff: (oldStr: string, newStr: string) => DiffLine[],
): DiffStats | null {
  return useMemo(() => {
    let added = 0;
    let removed = 0;
    let counted = 0;

    for (const message of messages) {
      const config = getToolConfig(message.toolName || 'UnknownTool').input;
      if (config.contentType !== 'diff' || !config.getContentProps) {
        continue;
      }
      const contentProps = config.getContentProps(parseToolPayload(message.toolInput) ?? {});
      if (typeof contentProps?.oldContent !== 'string' || typeof contentProps?.newContent !== 'string') {
        continue;
      }

      const stats = summarizeDiff(createDiff(contentProps.oldContent, contentProps.newContent));
      added += stats.added;
      removed += stats.removed;
      counted += 1;
    }

    return counted > 0 ? { added, removed } : null;
  }, [createDiff, messages]);
}

function getToolGroupIcon(icon: string | undefined, toolName: string): string {
  if (icon === 'terminal') {
    return '$';
  }

  return icon || toolName.slice(0, 1).toUpperCase();
}

/**
 * Rendered by chat's ChatMessagesPane to collapse a run of consecutive tool
 * calls into a single expandable group in the transcript.
 */
function ToolGroupContainer({
  group,
  collapseSingleTool = false,
  expanded,
  onExpandedChange,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
  revealRequestId,
}: ToolGroupContainerProps) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  const isGrouped = collapseSingleTool || group.messages.length >= TOOL_GROUP_THRESHOLD;
  const toolNames = useMemo(
    () => new Set(group.messages.map((message) => message.toolName || group.toolName)),
    [group.messages, group.toolName],
  );
  const hasMixedTools = toolNames.size > 1;
  // A run that errored, was denied or stopped mid-way is surfaced already
  // expanded: a collapsed row would bury the very thing that ended the run.
  const groupIssueStatus = useMemo<ToolStatus | undefined>(() => {
    for (const message of group.messages) {
      if (message.toolResult?.isError) {
        return 'error';
      }
      if (
        message.toolStatus === 'error'
        || message.toolStatus === 'denied'
        || message.toolStatus === 'stopped'
      ) {
        return message.toolStatus;
      }
    }
    return undefined;
  }, [group.messages]);
  // Standalone batches own their toggle locally; Process Run batches lift it
  // so closing the outer disclosure does not discard the user's reading state.
  const [internalExpanded, setInternalExpanded] = useState(!isGrouped);
  const isExpanded = Boolean(
    groupIssueStatus
    || revealRequestId !== undefined
    || (expanded ?? internalExpanded)
  );
  const toggleExpanded = () => {
    const nextExpanded = !isExpanded;
    if (expanded === undefined) setInternalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };
  const showChildren = !isGrouped || isExpanded || isExporting;
  const config = getToolConfig(group.toolName).input;
  const label = hasMixedTools ? t('messageTypes.tool') : config.label || group.toolName;
  const borderClass = config.colorScheme?.border || 'border-border';
  const iconClass = config.colorScheme?.icon || 'text-muted-foreground';
  const icon = hasMixedTools ? '…' : getToolGroupIcon(config.icon, group.toolName);

  const preview = group.activitySummary || group.preview;
  const groupDiffStats = useGroupDiffStats(group.messages, createDiff);

  return (
    <div>
      <button
        type="button"
        className={`${isGrouped ? 'flex' : 'hidden'} group w-full items-center gap-2 border-l-2 ${borderClass} rounded-r-md bg-muted/25 px-3 py-2 text-left transition-colors hover:bg-muted/40 dark:bg-muted/10 dark:hover:bg-muted/20`}
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        aria-hidden={!isGrouped}
        tabIndex={isGrouped ? 0 : -1}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className={`${iconClass} flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-background/80 text-xs font-medium`}>
          {icon}
        </span>
        <span className="min-w-0 flex-shrink-0 text-xs font-medium text-foreground">{label}</span>
        <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          x{group.messages.length}
        </span>
        {groupIssueStatus && <ToolStatusBadge status={groupIssueStatus} />}
        {preview && (
          <>
            <span className="text-[10px] text-muted-foreground/40">/</span>
            <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{preview}</span>
          </>
        )}
        {groupDiffStats && <DiffStatsBadge stats={groupDiffStats} className="ml-auto pl-2" />}
      </button>

      <div className={isGrouped ? 'mt-2 space-y-3 sm:space-y-4' : ''}>
        {showChildren && (
          <>
          {group.messages.map((message, index) => (
            <MessageComponent
              key={getMessageKey(message)}
              message={message}
              prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              provider={provider}
            />
          ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized for the transcript re-renders that are not message changes — the
 * pane re-renders when isProcessing or the activity indicator flips, and the
 * group is unchanged then.
 *
 * It cannot bail during streaming: groupConsecutiveTools rebuilds every group
 * object from a fresh visibleMessages array on each visible-session publish,
 * so `group` is a new reference even when its contents are identical. Stabilizing it would mean
 * keying a cache on the whole run — first and second message identity, run
 * length and showThinking — because the preview depends on all four.
 */
export default memo(ToolGroupContainer);
