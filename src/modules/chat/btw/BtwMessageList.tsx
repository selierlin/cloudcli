import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import {
  buildTailAnchoredMessageKeys,
  getIntrinsicMessageKey,
} from '@/modules/chat/utils/messageKeys';
import type { ExecutionProcessGroup } from '@/modules/chat/utils/executionProcess';
import { deriveExecutionProcessProjection } from '@/modules/chat/utils/executionProcess';
import ExecutionProcessSummary from '@/modules/chat/transcript/ExecutionProcessSummary';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';

type BtwMessageListProps = {
  messages: ChatMessage[];
  provider: LLMProvider;
  selectedProject: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  isProcessing: boolean;
  /** Rendered in place of the transcript until the first question is answered. */
  emptyState: ReactNode;
};

type BtwRow =
  | { kind: 'summary'; key: string; group: ExecutionProcessGroup; collapsed: boolean }
  | { kind: 'message'; key: string; message: ChatMessage; prevMessage: ChatMessage | null; group?: ExecutionProcessGroup }
  | { kind: 'end'; key: string; group: ExecutionProcessGroup };

/** Renders the side-question transcript; used only by BtwDrawer. */
export default function BtwMessageList({
  messages,
  provider,
  selectedProject,
  createDiff,
  onFileOpen,
  showRawParameters,
  showThinking,
  isProcessing,
  emptyState,
}: BtwMessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is parked at the tail. Read before the DOM grows, so a
  // reader who scrolled up to compare with the main conversation is not yanked
  // down by the next streamed row.
  const stickToBottomRef = useRef(true);
  // A run starts folded and the reader's own toggle wins afterwards. Keyed by
  // the group's disclosure key, so the state survives streaming and pagination
  // instead of resetting each time a new segment joins the run.
  const [groupCollapsed, setGroupCollapsed] = useState<Map<string, boolean>>(() => new Map());

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !stickToBottomRef.current) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages]);

  const messageKeyMap = useMemo(() => buildTailAnchoredMessageKeys(messages), [messages]);
  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );
  // The same projection the main transcript uses: each turn keeps its newest
  // answer segment as visible prose and folds the reasoning, tool calls and
  // absorbed narration that led there into one row. Sharing the pure function
  // is what makes the drawer fold like the conversation rather than like a
  // separate approximation of it.
  const executionProjection = useMemo(
    () => deriveExecutionProcessProjection(messages, getMessageKey, { isProcessing }),
    [getMessageKey, isProcessing, messages],
  );

  const isGroupCollapsed = useCallback(
    (group: ExecutionProcessGroup) => groupCollapsed.get(group.disclosureKey) ?? group.defaultCollapsed,
    [groupCollapsed],
  );

  const toggleGroup = useCallback((group: ExecutionProcessGroup, collapsed: boolean) => {
    setGroupCollapsed((previous) => {
      const next = new Map(previous);
      next.set(group.disclosureKey, !collapsed);
      return next;
    });
  }, []);

  // Flattened once so folded members can be skipped without losing the
  // "previous visible row" the message component groups on. A row hidden by the
  // fold must not become the previous neighbour of the row after it.
  const rows = useMemo<BtwRow[]>(() => {
    const flat: BtwRow[] = [];
    let prevVisible: ChatMessage | null = null;

    messages.forEach((message) => {
      const key = getMessageKey(message);
      const disclosureKey = executionProjection.memberDisclosureKeys.get(key);
      const group = disclosureKey ? executionProjection.groups.get(disclosureKey) : undefined;
      if (!group) {
        flat.push({ kind: 'message', key: `row:${key}`, message, prevMessage: prevVisible });
        prevVisible = message;
        return;
      }

      const collapsed = isGroupCollapsed(group);
      // Approval requests live inside the run too. Folding them away would hide
      // the card the turn is waiting on, so an attention member stays visible
      // while the rest of the run is closed — the same exemption the main
      // transcript makes.
      const staysVisible = !collapsed || group.attentionKeys.has(key);

      if (group.firstMemberKey === key) {
        flat.push({
          kind: 'summary',
          key: `summary:${group.disclosureKey}`,
          group,
          collapsed,
        });
      }
      if (staysVisible) {
        flat.push({
          kind: 'message',
          key: `row:${key}`,
          message,
          prevMessage: prevVisible,
          group,
        });
        prevVisible = message;
      }
      if ([...group.memberKeys].at(-1) === key) {
        // The summary stops pinning once this marker reaches the panel top;
        // without it the title would stay pinned for the whole run.
        flat.push({ kind: 'end', key: `end:${group.disclosureKey}`, group });
      }
    });

    return flat;
  }, [executionProjection, getMessageKey, isGroupCollapsed, messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const container = event.currentTarget;
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
        stickToBottomRef.current = distance < 48;
      }}
      // `chat-messages-pane` is what makes the transcript's font settings apply
      // here, and what the summary looks up to pin itself while a run streams.
      className="chat-messages-pane min-h-0 flex-1 overflow-y-auto overscroll-contain py-3"
    >
      {messages.length === 0 ? (
        emptyState
      ) : (
        <div className="mx-auto w-full space-y-3 px-4">
          {rows.map((row) => {
            if (row.kind === 'summary') {
              return (
                <ExecutionProcessSummary
                  key={row.key}
                  collapsed={row.collapsed}
                  activityLabel={row.group.activityLabel}
                  hasAttention={row.group.hasAttention}
                  isActiveRun={row.group.isActiveRun}
                  isWindowTruncated={row.group.isWindowTruncated}
                  labelKind={row.group.labelKind}
                  provider={provider}
                  processEndKey={row.group.disclosureKey}
                  toolCount={row.group.toolCount}
                  onToggle={() => toggleGroup(row.group, row.collapsed)}
                />
              );
            }
            if (row.kind === 'end') {
              return (
                <div
                  key={row.key}
                  data-execution-process-end={row.group.disclosureKey}
                  aria-hidden="true"
                />
              );
            }
            return (
              <MessageComponent
                key={row.key}
                message={row.message}
                prevMessage={row.prevMessage}
                createDiff={createDiff}
                onFileOpen={onFileOpen}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                selectedProject={selectedProject}
                provider={provider}
                isProcessRunMember={Boolean(row.group)}
                hidesProcessIdentity={Boolean(row.group && row.message.type === 'assistant')}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
