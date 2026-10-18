import { Fragment } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n } from '@/modules/i18n';
import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { LLMProviderLogo } from '@/shared/ui';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import { getChatProviderLabel } from '@/modules/chat/utils/chatProviderLabel';
import {
  deriveExecutionProcessProjection,
  type ExecutionProcessGroup,
  type ExecutionProcessProjection,
} from '@/modules/chat/utils/executionProcess';
import {
  buildTranscriptMessageKeys,
  getTranscriptMessageKey,
} from '@/modules/chat/utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';

type TranscriptExportDocumentProps = {
  messages: ChatMessage[];
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  provider: LLMProvider | string;
  selectedProject?: Project | null;
};

/**
 * A Process Run and the rows around it, in transcript order.
 *
 * Reasoning-only runs are left alone: their rows already are their own
 * disclosures, so wrapping them would stack two identical "Thinking process"
 * folds. Every other run gets one wrapper — the fold the reader meets first,
 * which is what the chat pane shows as a single "Execution process" row.
 */
type ExportBlock =
  | { kind: 'process'; group: ExecutionProcessGroup; messages: ChatMessage[] }
  | { kind: 'run'; messages: ChatMessage[] };

function isWrappedProcess(group: ExecutionProcessGroup): boolean {
  return group.labelKind !== 'reasoning';
}

function buildExportBlocks(
  messages: ChatMessage[],
  projection: ExecutionProcessProjection,
  getKey: (message: ChatMessage) => string,
): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  const processBlocks = new Map<string, Extract<ExportBlock, { kind: 'process' }>>();
  let run: ChatMessage[] = [];

  const flushRun = () => {
    if (run.length > 0) {
      blocks.push({ kind: 'run', messages: run });
      run = [];
    }
  };

  for (const message of messages) {
    const groupKey = projection.memberDisclosureKeys.get(getKey(message));
    const group = groupKey ? projection.groups.get(groupKey) : undefined;

    if (!group || !isWrappedProcess(group)) {
      run.push(message);
      continue;
    }

    // A run's members are not necessarily contiguous: the vanguard answer —
    // the newest answer segment, which renders as the turn's visible prose —
    // can sit between the rows before it and the ones that stream after. Reuse
    // the block already opened for the run instead of emitting a second header
    // and summary for the same turn.
    const existing = processBlocks.get(group.disclosureKey);
    if (existing) {
      existing.messages.push(message);
      continue;
    }

    flushRun();
    const block = { kind: 'process' as const, group, messages: [message] };
    processBlocks.set(group.disclosureKey, block);
    blocks.push(block);
  }

  flushRun();
  return blocks;
}

/** The same settled summary the chat's ExecutionProcessSummary renders. */
function processSummary(group: ExecutionProcessGroup): string {
  const t = i18n.getFixedT(null, 'chat');
  const label = group.labelKind === 'narration'
    ? t('transcript.executionProcess.narration', { defaultValue: 'Process record' })
    : t('transcript.executionProcess.execution', { defaultValue: 'Execution process' });
  const details = [
    group.toolCount > 0
      ? t(group.isWindowTruncated
        ? 'transcript.executionProcess.loadedToolCount'
        : 'transcript.executionProcess.toolCount', {
          count: group.toolCount,
          defaultValue: group.isWindowTruncated ? '{{count}} loaded tool calls' : '{{count}} tool calls',
        })
      : null,
    group.hasAttention
      ? t('transcript.executionProcess.attention', { defaultValue: 'needs attention' })
      : null,
    group.isWindowTruncated
      ? t('transcript.executionProcess.truncated', { defaultValue: 'earlier history not loaded' })
      : null,
  ].filter(Boolean);

  return [label, ...details].join(' · ');
}

/**
 * The transcript, rendered for a document instead of a screen.
 *
 * It deliberately mounts the same `MessageComponent` / `ToolGroupContainer`
 * tree the chat pane uses. Every previous export was a second formatter that
 * only knew about `msg.type`, which is why tool calls — the bulk of an agent
 * transcript — came out as empty sections. Rendering the real components means
 * the export cannot fall behind the UI: a new tool renderer appears in it for
 * free.
 *
 * Rendered by `buildTranscriptHtml` through `renderToStaticMarkup`, so there
 * are no effects and no interactivity — anything the components hide behind
 * open state is force-shown via `TranscriptRenderContext`. The exception is a
 * Process Run: the export wraps it in a native `<details>`, so a turn's
 * reasoning, narration and tool calls start folded the way the chat shows
 * them, and one click reveals the whole record without any script.
 */
export function TranscriptExportDocument({
  messages,
  createDiff,
  provider,
  selectedProject,
}: TranscriptExportDocumentProps) {
  // Thinking blocks are included: an export is a record of what happened, and
  // the on-screen toggle is about noise in a live conversation.
  const messageKeys = buildTranscriptMessageKeys(messages);
  const getKey = (message: ChatMessage) =>
    messageKeys.get(message) ?? getTranscriptMessageKey(message);
  const projection = deriveExecutionProcessProjection(messages, getKey, {
    isProcessing: false,
  });
  const blocks = buildExportBlocks(messages, projection, getKey);

  // `MessageComponent` suppresses a row's avatar while its predecessor has the
  // same type, so a block's first row must see the transcript's real previous
  // row — not null just because the block starts there.
  const previousOf = new Map<ChatMessage, ChatMessage>();
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    if (previous) previousOf.set(message, previous);
  });

  const renderRun = (runMessages: ChatMessage[], isProcessRunMember = false) => {
    const items = groupConsecutiveTools(runMessages, true);
    let previous: ChatMessage | null = runMessages[0] ? previousOf.get(runMessages[0]) ?? null : null;

    return items.map((item, index) => {
      if (isToolGroupItem(item)) {
        const blockPrevious = previous;
        previous = item.messages[item.messages.length - 1] || previous;
        return (
          <ToolGroupContainer
            key={`group-${index}`}
            group={item}
            prevMessage={blockPrevious}
            createDiff={createDiff}
            getMessageKey={getKey}
            showRawParameters={false}
            showThinking
            selectedProject={selectedProject}
            provider={provider}
          />
        );
      }

      const messagePrevious = previous;
      previous = item;
      return (
        <MessageComponent
          key={`message-${index}`}
          message={item}
          prevMessage={messagePrevious}
          createDiff={createDiff}
          showRawParameters={false}
          showThinking
          selectedProject={selectedProject}
          provider={provider}
          isProcessRunMember={isProcessRunMember}
          hidesProcessIdentity={isProcessRunMember}
        />
      );
    });
  };

  return (
    <I18nextProvider i18n={i18n}>
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        <div className="chat-export-transcript">
          {blocks.map((block, index) => {
            if (block.kind === 'process') {
              return (
                <Fragment key={`process-${index}`}>
                  {/* The run's own header, exactly as the chat paints it above
                      its collapsed row — otherwise the turn would lose the
                      harness identity once its first row moves into the fold. */}
                  <div className="mb-2 flex items-center space-x-3 px-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-sm text-foreground">
                      <LLMProviderLogo provider={provider} className="h-full w-full" />
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      {getChatProviderLabel(provider, i18n.getFixedT(null, 'chat'))}
                    </div>
                  </div>
                  <details
                    className="chat-export-disclosure chat-export-process"
                    // The chat surfaces a run that needs attention already open;
                    // a static document has no other way to flag it.
                    open={block.group.hasAttention || undefined}
                  >
                    <summary className="chat-export-disclosure-summary">
                      <span className="chat-export-disclosure-chevron" aria-hidden="true">
                        ›
                      </span>
                      {processSummary(block.group)}
                    </summary>
                    <div className="chat-export-disclosure-body">
                      {renderRun(block.messages, true)}
                    </div>
                  </details>
                </Fragment>
              );
            }

            return <Fragment key={`run-${index}`}>{renderRun(block.messages)}</Fragment>;
          })}
        </div>
      </TranscriptRenderContext.Provider>
    </I18nextProvider>
  );
}
