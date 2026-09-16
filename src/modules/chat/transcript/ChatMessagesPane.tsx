import { useTranslation } from 'react-i18next';
import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

import type { ChatMessage,
  Project,
  ProjectSession,
  LLMProvider,
  TranscriptRevealRequest,
  ProviderModelActions,
  ProviderModelsDefinition } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import {
  deriveExecutionProcessProjection,
  getRightmostVisibleTurnKey,
} from '@/modules/chat/utils/executionProcess';
import type { ExecutionTailClosure } from '@/modules/chat/utils/executionProcess';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import { deriveReasoningPresentations } from '@/modules/chat/utils/reasoningDisclosure';
import {
  disclosureRegistryReducer,
  resolveReasoningDisclosureState,
} from '@/modules/chat/utils/reasoningDisclosureRegistry';
import { useBottomEdgeResizeCompensation } from '@/modules/chat/hooks/useBottomEdgeResizeCompensation';
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

const clampEstimatedRowHeight = (height: number, maximum: number) =>
  Math.min(maximum, Math.max(64, Math.round(height)));

function estimateTextLines(value: unknown): number {
  const text = typeof value === 'string' ? value : '';
  if (!text) return 1;
  return text.split('\n').reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / 72)),
    0,
  );
}

/** Reserves plausible geometry before an old row has entered the render band. */
function estimateMessageRowHeight(message: ChatMessage): number {
  if (message.isToolUse) return 112;

  const lines = estimateTextLines(message.displayText || message.content || message.reasoning);
  if (message.isThinking) return clampEstimatedRowHeight(48 + lines * 18, 420);
  if (message.type === 'user') return clampEstimatedRowHeight(44 + lines * 20, 420);
  if (message.isCompactSummary) return clampEstimatedRowHeight(64 + lines * 19, 480);
  return clampEstimatedRowHeight(56 + lines * 21, 680);
}

function estimateToolGroupRowHeight(messages: ChatMessage[]): number {
  const hasIssue = messages.some((message) => message.toolResult?.isError
    || ['error', 'denied', 'stopped'].includes(String(message.toolStatus || '')));
  if (messages.length >= 2 && !hasIssue) return 64;
  return clampEstimatedRowHeight(
    messages.reduce((height, message) => height + estimateMessageRowHeight(message), 0),
    680,
  );
}

/**
 * Outer geometry shared by the three mutually exclusive bars above the
 * transcript (loading older messages, "showing N of M", legacy count) and by
 * the empty slot that stands in for them when none is showing. They swap while
 * the reader is parked near them, so all four states keep one height: any
 * difference in padding, border or height moves every row below and drifts the
 * reading position. They previously rendered as separate elements with `py-3`
 * and `py-2`, a 7px jump on every finished page.
 *
 * Keeping the slot mounted while no bar shows costs a strip of whitespace above
 * the first row, and that is the deliberate price of never moving the rows: the
 * count bar disappears the moment the last page loads, so unmounting the slot
 * with it would shift the transcript by the slot plus its `space-y` gap.
 *
 * Every variant is a single flex row whose text can shrink, because a wrapped
 * line would grow the slot past `min-h-10` and move the rows below again: the
 * longest locales wrap both count bars at phone widths and the legacy bar up to
 * tablet widths. The parts a reader can do without give up their room first —
 * the hint, then the sentence — and only the button labels themselves ellipsize
 * if a phone still cannot fit them. `min-h-10` is still a spacing token standing
 * in for a designed slot height rather than a value the design has signed off on.
 */
const TOP_CHROME_SLOT_CLASS =
  'min-h-10 border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400';

const PROCESS_AUTO_COLLAPSE_DELAY_MS = 800;

type ExecutionDisclosure = 'auto_open' | 'auto_closed' | 'search_open' | 'user_open' | 'user_closed';
type ExecutionDisclosureRegistry = Record<string, Record<string, ExecutionDisclosure>>;
const EMPTY_EXECUTION_DISCLOSURE: Record<string, ExecutionDisclosure> = {};
type ExecutionDisclosureAction =
  | { type: 'toggle'; sessionKey: string; disclosureKey: string; open: boolean }
  | { type: 'program_open' | 'program_close' | 'search_open'; sessionKey: string; disclosureKey: string };

function executionDisclosureReducer(
  state: ExecutionDisclosureRegistry,
  action: ExecutionDisclosureAction,
): ExecutionDisclosureRegistry {
  const sessionEntries = state[action.sessionKey] ?? {};
  const nextDisclosure = action.type === 'toggle'
    ? (action.open ? 'user_open' : 'user_closed')
    : action.type === 'program_open'
      ? 'auto_open'
      : action.type === 'program_close'
        ? 'auto_closed'
        : 'search_open';
  const existing = sessionEntries[action.disclosureKey];
  if (existing === nextDisclosure) return state;
  if (
    action.type !== 'toggle'
    && action.type !== 'search_open'
    && existing?.startsWith('user_')
  ) return state;
  return {
    ...state,
    [action.sessionKey]: {
      ...sessionEntries,
      [action.disclosureKey]: nextDisclosure,
    },
  };
}

type ExecutionTailClosureAction =
  | { type: 'reset' }
  | { type: 'decide'; disclosureKey: string; closure: ExecutionTailClosure };

function executionTailClosureReducer(
  state: Record<string, ExecutionTailClosure>,
  action: ExecutionTailClosureAction,
): Record<string, ExecutionTailClosure> {
  if (action.type === 'reset') return {};
  if (state[action.disclosureKey] === action.closure) return state;
  return { ...state, [action.disclosureKey]: action.closure };
}

type ActiveRunState = { sessionId: string | null; hasActiveRun: boolean };
type ActiveRunAction =
  | { type: 'reset'; sessionId: string | null }
  | { type: 'started' }
  | { type: 'completed' };

function activeRunReducer(state: ActiveRunState, action: ActiveRunAction): ActiveRunState {
  if (action.type === 'reset') {
    return state.sessionId === action.sessionId && !state.hasActiveRun
      ? state
      : { sessionId: action.sessionId, hasActiveRun: false };
  }
  if (action.type === 'started') {
    return state.hasActiveRun ? state : { ...state, hasActiveRun: true };
  }
  return state.hasActiveRun ? { ...state, hasActiveRun: false } : state;
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
  /** Search hit that must be visible before the scroll/highlight step runs. */
  searchRevealRequest?: TranscriptRevealRequest | null;
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
  searchRevealRequest,
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
  const sessionId = selectedSession?.id ?? null;
  const sessionDisclosureKey = sessionId ?? 'no-session';
  const lazyRows = useLazyRowObserver(scrollContainerRef, sessionId);
  // Keyboard/composer/window resizes move the container's bottom edge; this
  // keeps the transcript rows glued to it so the content beside the input
  // follows the input instead of being clipped behind it.
  useBottomEdgeResizeCompensation(scrollContainerRef);
  // Retains user ownership and visible duration across lazy row unmounts.
  const [disclosureRegistry, dispatchDisclosure] = useReducer(disclosureRegistryReducer, {
    sessionId,
    entries: {},
  });
  // Keeps a user's process disclosure choice while stream updates recompute the projection.
  const [executionDisclosureRegistry, dispatchExecutionDisclosure] = useReducer(
    executionDisclosureReducer,
    {},
  );
  const executionDisclosure = executionDisclosureRegistry[sessionDisclosureKey]
    ?? EMPTY_EXECUTION_DISCLOSURE;
  // Records each live turn's completion decision so later scrolling cannot re-open its tail.
  const [executionTailClosures, dispatchExecutionTailClosures] = useReducer(executionTailClosureReducer, {});
  // Distinguishes an initially completed historical view from the render where a live run just ended.
  const [activeRun, dispatchActiveRun] = useReducer(activeRunReducer, {
    sessionId,
    hasActiveRun: isProcessing,
  });
  const reasoningPresentations = useMemo(
    () => deriveReasoningPresentations(visibleMessages, sessionId ?? 'no-session', isProcessing),
    [isProcessing, sessionId, visibleMessages],
  );

  useLayoutEffect(() => {
    dispatchDisclosure({ type: 'reset', sessionId });
    dispatchExecutionTailClosures({ type: 'reset' });
    dispatchActiveRun({ type: 'reset', sessionId });
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
    // Number collisions from the tail so prepending historical pages never
    // changes an already-rendered row's key or its local React state.
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (message) assign(message);
    }
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
      {
        isProcessing,
        isLiveCompletionPending: !isProcessing && activeRun.hasActiveRun,
        tailClosures: executionTailClosures,
      },
    ),
    [activeRun.hasActiveRun, executionTailClosures, getMessageKey, isProcessing, visibleMessages],
  );
  const groupedVisibleMessages = useMemo(
    () => groupConsecutiveTools(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
  );
  const revealedMessageKey = useMemo(() => {
    if (!searchRevealRequest || searchRevealRequest.sessionId !== sessionId) return undefined;
    const target = visibleMessages.find((message) => (
      String(message.timestamp) === String(searchRevealRequest.timestamp)
    ));
    return target ? getMessageKey(target) : undefined;
  }, [getMessageKey, searchRevealRequest, sessionId, visibleMessages]);
  const resolveExecutionDisclosure = useCallback((group: {
    disclosureKey: string;
    disclosureAliases: string[];
  }) => executionDisclosure[group.disclosureKey]
    ?? group.disclosureAliases.map((key) => executionDisclosure[key]).find(Boolean),
  [executionDisclosure]);

  useLayoutEffect(() => {
    executionProjection.groups.forEach((group) => {
      if (
        !group.defaultCollapsed
        && !group.hasAttention
        && resolveExecutionDisclosure(group) === undefined
      ) {
        dispatchExecutionDisclosure({
          type: 'program_open',
          sessionKey: sessionDisclosureKey,
          disclosureKey: group.disclosureKey,
        });
      }
    });
  }, [executionProjection, resolveExecutionDisclosure, sessionDisclosureKey]);

  useLayoutEffect(() => {
    if (!revealedMessageKey || !searchRevealRequest) return;
    const disclosureKey = executionProjection.memberDisclosureKeys.get(revealedMessageKey);
    if (!disclosureKey) return;
    dispatchExecutionDisclosure({
      type: 'search_open',
      sessionKey: sessionDisclosureKey,
      disclosureKey,
    });
  }, [
    executionProjection,
    revealedMessageKey,
    searchRevealRequest,
    sessionDisclosureKey,
  ]);

  useLayoutEffect(() => {
    if (isUserScrolledUp) return undefined;
    const keysToCollapse = [...executionProjection.groups.values()]
      .filter((group) => (
        group.defaultCollapsed
        && !group.hasAttention
        && !group.hasActiveSegments
        && resolveExecutionDisclosure(group) === 'auto_open'
      ))
      .map((group) => group.disclosureKey);
    if (keysToCollapse.length === 0) return undefined;

    const timer = window.setTimeout(() => {
      onReasoningAutoCollapseStart?.();
      keysToCollapse.forEach((disclosureKey) => {
        dispatchExecutionDisclosure({
          type: 'program_close',
          sessionKey: sessionDisclosureKey,
          disclosureKey,
        });
      });
    }, PROCESS_AUTO_COLLAPSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    executionProjection,
    isUserScrolledUp,
    onReasoningAutoCollapseStart,
    resolveExecutionDisclosure,
    sessionDisclosureKey,
  ]);
  const collapsedProcessSignature = useMemo(() => (
    [...executionProjection.groups.values()]
      .filter((group) => {
        const disclosure = resolveExecutionDisclosure(group);
        if (group.hasAttention || group.hasActiveSegments) return false;
        return disclosure === 'user_closed'
          || disclosure === 'auto_closed'
          || (group.defaultCollapsed
            && disclosure !== 'user_open'
            && disclosure !== 'auto_open'
            && disclosure !== 'search_open');
      })
      .map((group) => `${group.disclosureKey}:${[...group.memberKeys].join(',')}`)
      .join('|')
  ), [executionProjection, resolveExecutionDisclosure]);
  const previousCollapsedProcessSignature = useRef('');

  useLayoutEffect(() => {
    const changed = previousCollapsedProcessSignature.current !== collapsedProcessSignature;
    previousCollapsedProcessSignature.current = collapsedProcessSignature;
    if (changed && collapsedProcessSignature && !isUserScrolledUp) {
      // ChatInterface coalesces this with reasoning disclosure changes in one frame.
      onReasoningAutoCollapseStart?.();
    }
  }, [collapsedProcessSignature, isUserScrolledUp, onReasoningAutoCollapseStart]);

  useLayoutEffect(() => {
    if (isProcessing) {
      dispatchActiveRun({ type: 'started' });
      return;
    }
    if (!activeRun.hasActiveRun) return;
    const disclosureKey = getRightmostVisibleTurnKey(visibleMessages);
    if (disclosureKey) {
      dispatchExecutionTailClosures({
        type: 'decide',
        disclosureKey,
        closure: isUserScrolledUp || executionDisclosure[disclosureKey] === 'user_open'
          ? 'deferred_live'
          : 'closed_live',
      });
    }
    dispatchActiveRun({ type: 'completed' });
  }, [activeRun.hasActiveRun, executionDisclosure, isProcessing, isUserScrolledUp, visibleMessages]);

  const toggleExecutionProcess = useCallback((disclosureKey: string, currentlyCollapsed: boolean) => {
    dispatchExecutionDisclosure({
      type: 'toggle',
      sessionKey: sessionDisclosureKey,
      disclosureKey,
      open: currentlyCollapsed,
    });
  }, [sessionDisclosureKey]);
  const isExecutionProcessCollapsed = useCallback((group: {
    disclosureKey: string;
    disclosureAliases: string[];
    hasAttention: boolean;
    hasActiveSegments: boolean;
    defaultCollapsed: boolean;
    isWindowTruncated: boolean;
  }) => {
    const disclosure = resolveExecutionDisclosure(group);
    if (group.hasAttention || group.hasActiveSegments) return false;
    return disclosure === 'user_closed'
      || disclosure === 'auto_closed'
      || (group.defaultCollapsed
        && disclosure !== 'user_open'
        && disclosure !== 'auto_open'
        && disclosure !== 'search_open');
  }, [resolveExecutionDisclosure]);

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
          {/* One slot, always rendered: the three bars swap and the count bar
              disappears when the last page loads, so the slot has to survive
              all of those or the rows below move with it. */}
          <div className={TOP_CHROME_SLOT_CLASS} data-transcript-top-chrome>
            {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded ? (
              <div className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-b-2 border-gray-400" />
                <p className="min-w-0 truncate">{t('session.loading.olderMessages')}</p>
              </div>
            ) : hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded ? (
              totalMessages > 0 && (
                <div className="flex items-center justify-center gap-2">
                  <span className="min-w-0 truncate">
                    {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}
                  </span>
                  <span className="hidden min-w-0 truncate text-xs sm:inline-block">
                    {t('session.messages.scrollToLoad')}
                  </span>
                </div>
              )
            ) : !hasMoreMessages && chatMessages.length > visibleMessageCount ? (
              <div className="flex items-center justify-center gap-2">
                {/* Everything with text here shrinks rather than wraps. The
                    sentence gives up its room first; the button labels are the
                    last resort, and the longest locales need more room for them
                    than a phone can give. */}
                <span className="hidden min-w-0 truncate md:inline-block">
                  {t('session.messages.showingLast', {
                    count: visibleMessageCount,
                    total: chatMessages.length,
                  })}
                </span>
                <button
                  className="min-w-0 truncate text-blue-600 underline hover:text-blue-700"
                  onClick={loadEarlierMessages}
                >
                  {t('session.messages.loadEarlier')}
                </button>
                <span className="shrink-0">|</span>
                <button
                  className="min-w-0 truncate text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  onClick={loadAllMessages}
                >
                  {t('session.messages.loadAll')}
                </button>
              </div>
            ) : null}
          </div>

          {/* Rendered after every bar: a zero-height sticky sibling that sits
              before the rows would otherwise take the space-y first-child slot
              from whichever bar is showing and push the rows down by that gap
              when the legacy count is the visible one. */}
          <LoadAllMessagesOverlay
            showLoadAllOverlay={showLoadAllOverlay}
            isLoadingAllMessages={isLoadingAllMessages}
            loadAllJustFinished={loadAllJustFinished}
            totalMessages={totalMessages}
            onLoadAllMessages={loadAllMessages}
          />

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
                const executionDisclosureKey = itemMessageKeys
                  .map((key) => executionProjection.memberDisclosureKeys.get(key))
                  .find(Boolean);
                const executionGroup = executionDisclosureKey
                  ? executionProjection.groups.get(executionDisclosureKey)
                  : undefined;
                const isProcessCollapsed = Boolean(executionGroup && isExecutionProcessCollapsed(executionGroup));
                const shouldRenderSummary = Boolean(
                  executionGroup && executionGroup.firstMemberKey === itemMessageKeys[0],
                );

                return (
                  <Fragment key={`tool-group-${getMessageKey(item.messages[0])}`}>
                    {shouldRenderSummary && executionGroup && (
                      <ExecutionProcessSummary
                        collapsed={isProcessCollapsed}
                        hasAttention={executionGroup.hasAttention}
                        isWindowTruncated={executionGroup.isWindowTruncated}
                        labelKind={executionGroup.labelKind}
                        toolCount={executionGroup.toolCount}
                        onToggle={() => toggleExecutionProcess(executionGroup.disclosureKey, isProcessCollapsed)}
                      />
                    )}
                    <LazyMessageRow
                      lazyRows={lazyRows}
                      rowKey={`${sessionId ?? 'no-session'}:tool-group:${getMessageKey(item.messages[0])}`}
                      timestamp={item.timestamp}
                      initiallyNearViewport={initiallyNearViewport}
                      estimatedHeight={estimateToolGroupRowHeight(item.messages)}
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
                        revealRequestId={revealedMessageKey && itemMessageKeys.includes(revealedMessageKey)
                          ? searchRevealRequest?.requestId
                          : undefined}
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
              const executionDisclosureKey = executionProjection.memberDisclosureKeys.get(messageKey);
              const executionGroup = executionDisclosureKey
                ? executionProjection.groups.get(executionDisclosureKey)
                : undefined;
              const isProcessCollapsed = Boolean(executionGroup && isExecutionProcessCollapsed(executionGroup));

              return (
                <Fragment key={messageKey}>
                  {executionGroup?.firstMemberKey === messageKey && (
                    <ExecutionProcessSummary
                      collapsed={isProcessCollapsed}
                      hasAttention={executionGroup.hasAttention}
                      isWindowTruncated={executionGroup.isWindowTruncated}
                      labelKind={executionGroup.labelKind}
                      toolCount={executionGroup.toolCount}
                      onToggle={() => toggleExecutionProcess(executionGroup.disclosureKey, isProcessCollapsed)}
                    />
                  )}
                  <LazyMessageRow
                    lazyRows={lazyRows}
                    rowKey={`${sessionId ?? 'no-session'}:${messageKey}`}
                    timestamp={item.timestamp}
                    initiallyNearViewport={initiallyNearViewport}
                    estimatedHeight={estimateMessageRowHeight(item)}
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
                      isProcessStageMember={Boolean(executionGroup)}
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
