import { useTranslation } from 'react-i18next';
import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { ChatMessage,
  Project,
  ProjectSession,
  LLMProvider,
  ProviderModelActions,
  ProviderModelsDefinition } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import { deriveExecutionProcessProjection } from '@/modules/chat/utils/executionProcess';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import { deriveReasoningPresentations } from '@/modules/chat/utils/reasoningDisclosure';
import {
  disclosureRegistryReducer,
  resolveReasoningDisclosureState,
} from '@/modules/chat/utils/reasoningDisclosureRegistry';
import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import LoadAllMessagesOverlay from '@/modules/chat/transcript/LoadAllMessagesOverlay';
import ExecutionProcessSummary from '@/modules/chat/transcript/ExecutionProcessSummary';

/**
 * How many of the newest rows mount with real content on the first commit,
 * before the lazy-row observer has had a chance to report what is actually
 * near the viewport. Covers a bit more than one screen of typical rows.
 */
const INITIAL_MOUNTED_TAIL_ROWS = 30;

type ExecutionDisclosure = 'user_open' | 'user_closed';
type ExecutionDisclosureAction =
  | { type: 'reset' }
  | { type: 'toggle'; turnKey: string; open: boolean };

function executionDisclosureReducer(
  state: Record<string, ExecutionDisclosure>,
  action: ExecutionDisclosureAction,
): Record<string, ExecutionDisclosure> {
  if (action.type === 'reset') return {};
  if (state[action.turnKey] === (action.open ? 'user_open' : 'user_closed')) return state;
  return { ...state, [action.turnKey]: action.open ? 'user_open' : 'user_closed' };
}

type ChatMessagesPaneProps = {
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  /** Prevents disclosure layout changes while the user reads above the tail. */
  isUserScrolledUp?: boolean;
  /** Asks the chat-owned scroll writer to follow an automatic reasoning collapse. */
  onReasoningAutoCollapseStart?: () => void;
  /** True while ChatComposer's floating activity/stop tab is rendered above the input. */
  hasActivityIndicator?: boolean;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  provider: LLMProvider;
  setProvider: (provider: LLMProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  providerModels: Record<LLMProvider, string>;
  setProviderModel: (provider: LLMProvider, model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadEarlierMessages: () => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  /** Loads an already-sent message back into the composer; absent when the provider cannot re-run from a point. */
  onEditMessage?: (message: ChatMessage) => void;
  /** Branches the conversation into a new session ending at a message. */
  onForkFromMessage?: (message: ChatMessage) => void;
};

/**
 * Rendered by chat's ChatInterface as the scrolling transcript: the message
 * list and tool groups, the provider empty state and the load-all-history
 * overlay.
 */
function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  isProcessing = false,
  isUserScrolledUp = false,
  onReasoningAutoCollapseStart,
  hasActivityIndicator = false,
  chatMessages,
  selectedSession,
  provider,
  setProvider,
  textareaRef,
  providerModels,
  setProviderModel,
  providerModelCatalog,
  providerModelActions,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  loadEarlierMessages,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onEditMessage,
  onForkFromMessage,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  const sessionId = selectedSession?.id ?? null;
  // Retains user ownership and visible duration across lazy row unmounts.
  const [disclosureRegistry, dispatchDisclosure] = useReducer(disclosureRegistryReducer, {
    sessionId,
    entries: {},
  });
  // Keeps a user's process disclosure choice while stream updates recompute the projection.
  const [executionDisclosure, dispatchExecutionDisclosure] = useReducer(executionDisclosureReducer, {});
  const reasoningPresentations = useMemo(
    () => deriveReasoningPresentations(visibleMessages, sessionId ?? 'no-session', isProcessing),
    [isProcessing, sessionId, visibleMessages],
  );

  useLayoutEffect(() => {
    dispatchDisclosure({ type: 'reset', sessionId });
    dispatchExecutionDisclosure({ type: 'reset' });
  }, [sessionId]);

  useLayoutEffect(() => {
    dispatchDisclosure({
      type: 'sync',
      rows: [...reasoningPresentations.entries()].map(([message, presentation]) => ({
        key: presentation.disclosureKey,
        content: String(message.content || ''),
        isStreaming: Boolean(message.isStreaming),
        timestamp: message.timestamp,
      })),
      now: Date.now(),
    });
  }, [reasoningPresentations]);

  const handleReasoningUserOpenChange = useCallback((key: string, open: boolean) => {
    dispatchDisclosure({ type: 'user', key, open });
  }, []);
  const handleReasoningProgramOpen = useCallback((key: string) => {
    dispatchDisclosure({ type: 'program_open', key, now: Date.now() });
  }, []);
  const handleReasoningProgramCollapse = useCallback((key: string) => {
    onReasoningAutoCollapseStart?.();
    dispatchDisclosure({ type: 'program_collapse', key });
  }, [onReasoningAutoCollapseStart]);
  // Stable, deterministic keys for the messages rendered this pass.
  //
  // A server refresh can replace source records with equivalent new objects, so
  // object identity is not a durable React key across pagination or hydration.
  // Deriving keys from this render's ordered messages (intrinsic key,
  // disambiguated by occurrence index on collision) preserves existing DOM
  // nodes and component state when older history is prepended.
  const messageKeyMap = useMemo(() => {
    const keys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const assign = (message: ChatMessage) => {
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
    };
    visibleMessages.forEach(assign);
    return keys;
  }, [visibleMessages]);

  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );
  const executionProjection = useMemo(
    () => deriveExecutionProcessProjection(
      visibleMessages,
      getMessageKey,
      isProcessing,
      (turnKey) => !isUserScrolledUp && executionDisclosure[turnKey] !== 'user_open',
    ),
    [executionDisclosure, getMessageKey, isProcessing, isUserScrolledUp, visibleMessages],
  );
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveTools(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
  );
  const collapsedProcessSignature = useMemo(() => (
    [...executionProjection.groups.values()]
      .filter((group) => executionDisclosure[group.turnKey] === 'user_closed'
        || (!group.hasAttention && executionDisclosure[group.turnKey] !== 'user_open'))
      .map((group) => `${group.turnKey}:${[...group.memberKeys].join(',')}`)
      .join('|')
  ), [executionDisclosure, executionProjection]);
  const previousCollapsedProcessSignature = useRef('');

  useLayoutEffect(() => {
    const changed = previousCollapsedProcessSignature.current !== collapsedProcessSignature;
    previousCollapsedProcessSignature.current = collapsedProcessSignature;
    if (changed && collapsedProcessSignature && !isUserScrolledUp) {
      // ChatInterface coalesces this with reasoning disclosure changes in one frame.
      onReasoningAutoCollapseStart?.();
    }
  }, [collapsedProcessSignature, isUserScrolledUp, onReasoningAutoCollapseStart]);

  const toggleExecutionProcess = useCallback((turnKey: string, currentlyCollapsed: boolean) => {
    dispatchExecutionDisclosure({ type: 'toggle', turnKey, open: currentlyCollapsed });
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      className={`chat-messages-pane relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-3 sm:pt-4 ${
        hasActivityIndicator ? 'pb-12 sm:pb-14' : 'pb-3 sm:pb-4'
      }`}
    >
      <div className="mx-auto w-full max-w-[54.25rem] space-y-3 px-4 sm:space-y-4">
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
          providerModels={providerModels}
          setProviderModel={setProviderModel}
          providerModelCatalog={providerModelCatalog}
          providerModelActions={providerModelActions}
          providerModelsLoading={providerModelsLoading}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-gray-500 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {totalMessages > 0 && (
                <span>
                  {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          <LoadAllMessagesOverlay
            showLoadAllOverlay={showLoadAllOverlay}
            isLoadingAllMessages={isLoadingAllMessages}
            loadAllJustFinished={loadAllJustFinished}
            totalMessages={totalMessages}
            onLoadAllMessages={loadAllMessages}
          />

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-blue-600 underline hover:text-blue-700" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {(() => {
            let prevMessage: ChatMessage | null = null;
            const rowCount = groupedVisibleMessages.length;

            return groupedVisibleMessages.map((item, index) => {
              // Rows near the tail mount their content on first commit so the
              // initial scroll-to-bottom measures real heights; older rows
              // start as placeholders and mount when scrolled toward.
              const initiallyNearViewport = index >= rowCount - INITIAL_MOUNTED_TAIL_ROWS;

              if (isToolGroupItem(item)) {
                const groupPrevMessage = prevMessage;
                prevMessage = item.messages[item.messages.length - 1] || prevMessage;
                const itemMessageKeys = item.messages.map(getMessageKey);
                const executionTurnKey = itemMessageKeys
                  .map((key) => executionProjection.memberTurnKeys.get(key))
                  .find(Boolean);
                const executionGroup = executionTurnKey
                  ? executionProjection.groups.get(executionTurnKey)
                  : undefined;
                const isProcessCollapsed = Boolean(executionGroup && (
                  executionDisclosure[executionGroup.turnKey] === 'user_closed'
                  || (!executionGroup.hasAttention && executionDisclosure[executionGroup.turnKey] !== 'user_open')
                ));
                const shouldRenderSummary = Boolean(
                  executionGroup && executionGroup.firstMemberKey === itemMessageKeys[0],
                );

                return (
                  <Fragment key={`tool-group-${getMessageKey(item.messages[0])}`}>
                    {shouldRenderSummary && executionGroup && (
                      <ExecutionProcessSummary
                        collapsed={isProcessCollapsed}
                        hasAttention={executionGroup.hasAttention}
                        onToggle={() => toggleExecutionProcess(executionGroup.turnKey, isProcessCollapsed)}
                      />
                    )}
                    <LazyMessageRow
                      lazyRows={lazyRows}
                      timestamp={item.timestamp}
                      initiallyNearViewport={initiallyNearViewport}
                      isProcessCollapsed={isProcessCollapsed}
                    >
                      <ToolGroupContainer
                        group={item}
                        prevMessage={groupPrevMessage}
                        createDiff={createDiff}
                        getMessageKey={getMessageKey}
                        onFileOpen={onFileOpen}
                        onShowSettings={onShowSettings}
                        onGrantToolPermission={onGrantToolPermission}
                        showRawParameters={showRawParameters}
                        showThinking={showThinking}
                        selectedProject={selectedProject}
                        provider={provider}
                      />
                    </LazyMessageRow>
                  </Fragment>
                );
              }

              const messagePrevMessage = prevMessage;
              prevMessage = item;
              const reasoningPresentation = reasoningPresentations.get(item);
              const reasoningDisclosureState = reasoningPresentation
                && disclosureRegistry.sessionId === sessionId
                ? resolveReasoningDisclosureState(
                    disclosureRegistry,
                    reasoningPresentation.disclosureKey,
                    String(item.content || ''),
                  )
                : undefined;
              const messageKey = getMessageKey(item);
              const executionTurnKey = executionProjection.memberTurnKeys.get(messageKey);
              const executionGroup = executionTurnKey
                ? executionProjection.groups.get(executionTurnKey)
                : undefined;
              const isProcessCollapsed = Boolean(executionGroup && (
                executionDisclosure[executionGroup.turnKey] === 'user_closed'
                || (!executionGroup.hasAttention && executionDisclosure[executionGroup.turnKey] !== 'user_open')
              ));

              return (
                <Fragment key={messageKey}>
                  {executionGroup?.firstMemberKey === messageKey && (
                    <ExecutionProcessSummary
                      collapsed={isProcessCollapsed}
                      hasAttention={executionGroup.hasAttention}
                      onToggle={() => toggleExecutionProcess(executionGroup.turnKey, isProcessCollapsed)}
                    />
                  )}
                  <LazyMessageRow
                    lazyRows={lazyRows}
                    timestamp={item.timestamp}
                    initiallyNearViewport={initiallyNearViewport}
                    isProcessCollapsed={isProcessCollapsed}
                  >
                    <MessageComponent
                      message={item}
                      prevMessage={messagePrevMessage}
                      createDiff={createDiff}
                      onFileOpen={onFileOpen}
                      onShowSettings={onShowSettings}
                      onGrantToolPermission={onGrantToolPermission}
                      showRawParameters={showRawParameters}
                      showThinking={showThinking}
                      selectedProject={selectedProject}
                      provider={provider}
                      reasoningPresentation={reasoningPresentation}
                      reasoningDisclosureState={reasoningDisclosureState}
                      suppressReasoningAutoCollapse={isUserScrolledUp}
                      onReasoningUserOpenChange={handleReasoningUserOpenChange}
                      onReasoningProgramOpen={handleReasoningProgramOpen}
                      onReasoningProgramCollapse={handleReasoningProgramCollapse}
                      onEditMessage={onEditMessage}
                      onForkFromMessage={onForkFromMessage}
                    />
                  </LazyMessageRow>
                </Fragment>
              );
            });
          })()}
        </>
      )}
      </div>
    </div>
  );
}

export default memo(ChatMessagesPane);
