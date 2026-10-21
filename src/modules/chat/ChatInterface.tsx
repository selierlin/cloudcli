import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '@/modules/task-master';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import PermissionContext from '@/modules/chat/context/PermissionContext';
import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import { api } from '@/shared/api';
import { afterNextPaint } from '@/shared/utils';
import type {
  ChatMessage,
  Project,
  ProjectSession,
  SessionEstablishedContext,
  SessionNavigationOptions,
} from '@/shared/types';
import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import { useScheduledMessages } from '@/modules/chat/composer/useScheduledMessages';
import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import type { StreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import { createRevealPacer } from '@/modules/chat/utils/revealPacer';
import type { RevealPacer } from '@/modules/chat/utils/revealPacer';
import { getChatProviderLabel } from '@/modules/chat/utils/chatProviderLabel';
import { forkFailureMessageKey } from '@/modules/chat/utils/forkFailureMessage';
import { downloadTranscriptExport } from '@/modules/chat/utils/chatExport';
import type { PartialExportFormat } from '@/modules/chat/utils/chatExport';
import { buildTailAnchoredMessageKeys, getTranscriptMessageKey } from '@/modules/chat/utils/messageKeys';
import { collectSelectedMessages } from '@/modules/chat/utils/transcriptSelection';
import {
  useProcessingSessions,
  useSessionProtectionActions,
} from '@/shared/context/SessionProtectionContext';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import CommandResultModal from '@/modules/chat/modals/CommandResultModal';
import ScrollToBottomAffordance from '@/modules/chat/ScrollToBottomAffordance';
import TranscriptSelectionBar from '@/modules/chat/TranscriptSelectionBar';

type ChatInterfaceProps = {
  isActive: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onSessionForked?: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings?: () => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  onTaskClick?: (...args: unknown[]) => void;
  onShowAllTasks?: (() => void) | null;
};

const REASONING_COLLAPSE_FOLLOW_MS = 350;

/**
 * Shared empty turn selection. A selection made in another session reads as
 * this set, so the bar disappears without an effect rewriting state after the
 * new transcript has painted. Never mutated.
 */
const EMPTY_EXPORT_ROW_KEYS: Set<string> = new Set();

/** Resolves the provider name shown in chat empty states and composer hints. */
/**
 * Used by the project-workspace module (via the chat barrel) to render a
 * project session's chat tab; it owns the session, provider, realtime and
 * composer state that ChatMessagesPane and ChatComposer render.
 */
function ChatInterface({
  isActive,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onNavigateToSession,
  onSessionEstablished,
  onSessionForked,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { subscribe } = useWebSocket();
  const { t } = useTranslation('chat');
  const processingSessions = useProcessingSessions();
  const {
    markSessionProcessing: onSessionProcessing,
    markSessionIdle: onSessionIdle,
    markSessionBackground: onSessionBackground,
    getSessionActivity,
  } = useSessionProtectionActions();

  const sessionStore = useSessionStore();
  // Latest store handle for the streaming buffer's flush callback. Kept current
  // in an effect so the callback never captures a stale `sessionStore` while
  // the registry itself is created once for the pane's lifetime.
  const sessionStoreRef = useRef(sessionStore);
  useEffect(() => {
    sessionStoreRef.current = sessionStore;
  }, [sessionStore]);
  const visibleStreamingSessionIdRef = useRef<string | null>(
    isActive ? selectedSession?.id ?? null : null,
  );
  const publishStreamingBatch = useCallback<Parameters<typeof createStreamingBufferRegistry>[0]>(
    (sessionId, updates, provider) => {
      sessionStoreRef.current.updateStreamingBatch(sessionId, updates, provider);
    },
    [],
  );
  const isStreamingSessionVisible = useCallback(
    (sessionId: string) => visibleStreamingSessionIdRef.current === sessionId,
    [],
  );
  // Session-keyed streaming buffer. The lazy initializer runs exactly once, so
  // a single registry backs every render.
  const [streamBuffers] = useState<StreamingBufferRegistry>(() =>
    createStreamingBufferRegistry(publishStreamingBatch, isStreamingSessionVisible));
  // Session-keyed reveal pacer for whole-segment providers (Codex / DSH):
  // same publish channel and visibility as the registry, so their prose plays
  // through identical streaming rows and shares the teardown paths.
  const [revealPacer] = useState<RevealPacer>(() =>
    createRevealPacer(publishStreamingBatch, isStreamingSessionVisible));
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());
  /** Wrapper around the composer, made inert while the reader picks rows. */
  const composerShellRef = useRef<HTMLDivElement | null>(null);

  const {
    provider,
    setProvider,
    providerModels,
    setStoredProviderModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    currentProviderModelOptions,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    availablePermissionModes,
    selectPermissionMode,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelsLoading,
    providerModelActions,
    selectProviderModel,
    selectProviderEffort,
    resolvePermissionModeForProvider,
    supportsMessageEditing,
    supportsSessionForking,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });

  const {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    revealMessage,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    programmaticScrollTopRef,
    scrollToLatest,
    scrollToBottomAndReset,
    followTranscriptLayout,
    handleScroll,
    requestLatestMessages,
    searchRevealRequest,
  } = useChatSessionState({
    isActive,
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
  });

  const handleReasoningAutoCollapseStart = useCallback(() => {
    followTranscriptLayout(REASONING_COLLAPSE_FOLLOW_MS);
  }, [followTranscriptLayout]);

  const visibleStreamingSessionId = isActive
    ? selectedSession?.id || currentSessionId || null
    : null;
  useLayoutEffect(() => {
    const previousSessionId = visibleStreamingSessionIdRef.current;
    visibleStreamingSessionIdRef.current = visibleStreamingSessionId;

    // Cancel any foreground schedule owned by the session that just became
    // hidden, then publish the newly visible session before its first paint.
    if (previousSessionId && previousSessionId !== visibleStreamingSessionId) {
      streamBuffers.flushNow(previousSessionId);
      revealPacer.flushNow(previousSessionId);
    }
    if (visibleStreamingSessionId) {
      streamBuffers.flushNow(visibleStreamingSessionId);
      revealPacer.flushNow(visibleStreamingSessionId);
    }
  }, [streamBuffers, revealPacer, visibleStreamingSessionId]);

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    setAttachedFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker,
    handleSubmit,
    backgroundSendPrompt,
    resolveBackgroundSendPrompt,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
    handleVoiceTranscript,
    handleQuickReplySend,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
    editingAnchorId,
    beginEditMessage,
    cancelEditMessage,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    currentProviderModel,
    currentProviderEffort,
    isLoading: isProcessing,
    processingSessions,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onFileOpen,
    onShowSettings,
    scrollToLatest,
    addMessage,
    setPendingPermissionRequests,
    resolvePermissionModeForProvider,
  });

  // On WebSocket reconnect, request a bounded persisted-tail sync (deferred
  // while Chat is hidden), then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await requestLatestMessages(selectedSession.id, isActive);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [isActive, requestLatestMessages, selectedProject, selectedSession, sendMessage]);

  useChatRealtimeHandlers({
    isActive,
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamBuffers,
    revealPacer,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onSessionBackground,
    getSessionActivity,
    onWebSocketReconnect: handleWebSocketReconnect,
    requestLatestMessages,
    sessionStore,
  });

  // Lets other modules (the quick settings Commands tab) hand text to the
  // composer: append it after a separating space, then focus the textarea with
  // the caret at the end once React has rendered the new value.
  const insertComposerText = useCallback((text: string) => {
    setInput((previous) => {
      const separator = previous && !/\s$/.test(previous) ? ' ' : '';
      return `${previous}${separator}${text}`;
    });
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      const caretPosition = textarea.value.length;
      textarea.setSelectionRange(caretPosition, caretPosition);
    });
  }, [setInput, textareaRef]);

  usePaletteOpsRegister({ insertComposerText });

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession]);

  // On unmount, cancel every pending flush so a timer cannot write into a
  // torn-down store. Per-session buffers are otherwise dropped by
  // `stream_end` / `complete`.
  useEffect(() => () => {
    streamBuffers.dropAll();
    revealPacer.dropAll();
  }, [streamBuffers, revealPacer]);

  /**
   * Branches the conversation into a new session that ends at this message,
   * then opens it. The session being viewed is left exactly as it was.
   *
   * A refusal is surfaced rather than swallowed: ZCode's guard rejects the whole
   * branch when it would revert workspace files, and a silent no-op would read
   * as a dead button. The server's code picks the wording.
   */
  const handleForkFromMessage = useCallback(async (message: ChatMessage) => {
    const anchorId = message.forkAnchorId;
    const sourceSessionId = selectedSession?.id;
    if (!anchorId || !sourceSessionId) return;

    try {
      const response = await api.forkSession(sourceSessionId, { upToAnchorId: anchorId });
      const payload = await response.json();
      const forkedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof forkedSessionId !== 'string') {
        alert(t(forkFailureMessageKey(payload?.error?.code)));
        return;
      }
      // Bridge the new session into the sidebar's Conversations feed, which the
      // server's `session_upserted` broadcast never reaches, so the forked row
      // shows there without a refetch.
      const provider = selectedSession?.__provider;
      if (provider && selectedProject) {
        onSessionForked?.(forkedSessionId, {
          provider,
          project: selectedProject,
          summary: payload?.data?.sessionName,
        });
      }
      onNavigateToSession?.(forkedSessionId);
    } catch (error) {
      console.error('Error forking session:', error);
      alert(t('message.forkFailed'));
    }
  }, [onNavigateToSession, onSessionForked, selectedProject, selectedSession?.__provider, selectedSession?.id, t]);

  const { scheduledMessages, schedule: scheduleMessage, cancel: cancelScheduledMessage } =
    useScheduledMessages(currentSessionId || selectedSession?.id || null);

  /**
   * Hands the composer's current text to the server to send later, and clears
   * the box as a send would — the message has left the composer either way.
   */
  const handleScheduleMessage = useCallback(async (scheduledFor: Date) => {
    const content = input.trim();
    if (!content) return;

    const scheduled = await scheduleMessage({
      content,
      scheduledFor,
      options: { model: currentProviderModel, effort: currentProviderEffort, permissionMode },
    });
    if (scheduled) {
      setInput('');
    }
  }, [currentProviderEffort, currentProviderModel, input, permissionMode, scheduleMessage, setInput]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // Lets markdown image paths in the transcript resolve against this project.
  const markdownWorkspaceValue = useMemo(() => ({
    projectId: selectedProject?.projectId ?? null,
  }), [selectedProject?.projectId]);

  // Lets a workflow card fetch its agents' timelines for this session.
  const transcriptSessionValue = useMemo(() => ({ sessionId: currentSessionId }), [currentSessionId]);

  // A composer pick becomes the default for new chats and, when a session is
  // open, is recorded against that session so reopening it restores this model.
  const handleSelectComposerModel = useCallback(async (model: string) => {
    try {
      await selectProviderModel(provider, model, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing the active session model:', error);
    }
  }, [currentSessionId, provider, selectProviderModel, selectedSession?.id]);

  const handleSelectComposerEffort = useCallback(async (effort: string) => {
    try {
      await selectProviderEffort(provider, effort, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing the active session reasoning effort:', error);
    }
  }, [currentSessionId, provider, selectProviderEffort, selectedSession?.id]);

  // Mirrors ChatComposer's own visibility check so the message pane can
  // reserve enough bottom space to keep the floating status tab from
  // overlapping the last message. The scroll-to-bottom button reads the same
  // flag for its glyph, so the two indicators can never disagree about whether
  // the turn is running.
  const hasActivityIndicator = Boolean(sessionActivity && pendingPermissionRequests.length === 0);

  // Partial-export selection. `sessionKey` scopes the picked row keys to the
  // transcript they came from, so switching sessions cannot match an unrelated
  // row in the next one. `active` keeps the mode on while the reader clears and
  // re-picks rows; `rowKeys` holds one key per picked question or answer.
  const exportSessionKey = currentSessionId ?? selectedSession?.id ?? null;
  const [exportSelection, setExportSelection] = useState<{
    sessionKey: string | null;
    active: boolean;
    rowKeys: Set<string>;
  }>({ sessionKey: null, active: false, rowKeys: new Set() });
  // The format currently being built, which keeps both bar buttons disabled
  // while one synchronous transcript render owns the main thread.
  const [selectionExportFormat, setSelectionExportFormat] = useState<PartialExportFormat | null>(null);
  // Set when the last attempt threw; the bar reports it until the next attempt
  // or until the reader leaves the mode.
  const [selectionExportFailed, setSelectionExportFailed] = useState(false);

  // Same tail-anchored keys the pane renders, so a row picked before older
  // history is prepended keeps pointing at the same row.
  const exportMessageKeys = useMemo(
    () => buildTailAnchoredMessageKeys(chatMessages),
    [chatMessages],
  );
  const getExportMessageKey = useCallback(
    (message: ChatMessage) => exportMessageKeys.get(message) || getTranscriptMessageKey(message),
    [exportMessageKeys],
  );

  const exportSelectionActive = exportSelection.active && exportSelection.sessionKey === exportSessionKey;
  // A selection made in another session reads as no selection, without an
  // effect resetting state after the transcript has already painted.
  const exportRowKeys = exportSelection.sessionKey === exportSessionKey
    ? exportSelection.rowKeys
    : EMPTY_EXPORT_ROW_KEYS;
  // What the selection actually resolves to, resolved once for both the bar
  // and the export. Keys can drift out of the transcript while an answer
  // streams (tail-anchored duplicates, a row without an id), and a bar that
  // counted the key set would keep promising rows the export can no longer
  // find — the click would then do nothing at all.
  const selectedExportMessages = useMemo(
    () => (exportRowKeys.size === 0
      ? []
      : collectSelectedMessages(chatMessages, exportRowKeys, getExportMessageKey)),
    [chatMessages, exportRowKeys, getExportMessageKey],
  );

  // Turning the mode on gives every pickable row a mark, which narrows its
  // content and can push the tail below the fold. A reader who was at the tail
  // stays there; one who was reading further up is left where they are.
  useLayoutEffect(() => {
    if (exportSelectionActive) followTranscriptLayout();
  }, [exportSelectionActive, followTranscriptLayout]);

  const handleToggleExportRows = useCallback((messageKeys: string[]) => {
    if (messageKeys.length === 0) return;
    setSelectionExportFailed(false);
    setExportSelection((previous) => {
      const rowKeys = new Set(
        previous.sessionKey === exportSessionKey ? previous.rowKeys : [],
      );
      // The turn entry arrives as several keys at once: it clears only when
      // every row it names is already picked, so one deselect cannot leave a
      // question behind without its answer.
      const clearAll = messageKeys.every((key) => rowKeys.has(key));
      messageKeys.forEach((key) => {
        if (clearAll) rowKeys.delete(key);
        else rowKeys.add(key);
      });
      return { sessionKey: exportSessionKey, active: true, rowKeys };
    });
  }, [exportSessionKey]);

  const handleCancelExportSelection = useCallback(() => {
    setSelectionExportFailed(false);
    setExportSelection({ sessionKey: exportSessionKey, active: false, rowKeys: new Set() });
  }, [exportSessionKey]);

  const handleExportSelectedRows = useCallback(async (format: PartialExportFormat) => {
    if (selectionExportFormat !== null) return;
    if (selectedExportMessages.length === 0) return;

    setSelectionExportFailed(false);
    setSelectionExportFormat(format);
    try {
      // The busy label must paint before the synchronous render starts.
      await afterNextPaint();
      await downloadTranscriptExport(format, {
        messages: selectedExportMessages,
        sessionTitle: selectedSession?.title || t('export.untitled', { defaultValue: 'Conversation' }),
        provider,
        selectedProject,
        createDiff,
        // The file names its own subset, so the reader can tell a pick from a
        // short conversation.
        totalMessages: chatMessages,
      }, t('export.filePrefix', { defaultValue: 'conversation' }));
    } catch (error) {
      // The bar is the only confirmation surface this mode has, so a failure
      // has to be said there: resetting the busy state silently would look
      // exactly like a successful download that produced no file.
      console.error('[Chat] Failed to export the selected messages:', error);
      setSelectionExportFailed(true);
    } finally {
      setSelectionExportFormat(null);
    }
  }, [
    chatMessages,
    createDiff,
    provider,
    selectedExportMessages,
    selectedProject,
    selectedSession?.title,
    selectionExportFormat,
    t,
  ]);

  // Picking rows is a mode, not a panel: the composer must not accept text,
  // focus or drops while it is on. `inert` covers pointer, keyboard and focus
  // in one attribute, and it also blurs whatever input had focus on entry.
  useLayoutEffect(() => {
    const shell = composerShellRef.current;
    if (!shell) return;
    if (exportSelectionActive) shell.setAttribute('inert', '');
    else shell.removeAttribute('inert');
  }, [exportSelectionActive]);

  const selectedProviderLabel = getChatProviderLabel(provider, t);

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }


  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className="flex h-full min-h-0 flex-col">
        <MarkdownWorkspaceContext.Provider value={markdownWorkspaceValue}>
          <TranscriptSessionContext.Provider value={transcriptSessionValue}>
            <ChatMessagesPane
              scrollContainerRef={scrollContainerRef}
              programmaticScrollTopRef={programmaticScrollTopRef}
              // Not redundant with the `scroll` listener. A first page is 20 rows,
              // tool results fold into their calls, and the "load earlier" link is
              // hidden while more pages exist — so a short transcript is often not
              // scrollable at all and never emits `scroll`. Wheel and touch are
              // then the only way to reach the top pager or the "load all" overlay.
              onWheel={handleScroll}
              onTouchMove={handleScroll}
              isLoadingSessionMessages={isLoadingSessionMessages}
              isProcessing={isProcessing}
              isUserScrolledUp={isUserScrolledUp}
              onReasoningAutoCollapseStart={handleReasoningAutoCollapseStart}
              searchRevealRequest={searchRevealRequest}
              hasActivityIndicator={hasActivityIndicator}
              chatMessages={chatMessages}
              selectedSession={selectedSession}
              currentSessionId={currentSessionId}
              provider={provider}
              setProvider={setProvider}
              textareaRef={textareaRef}
              providerModels={providerModels}
              setProviderModel={setStoredProviderModel}
              providerModelCatalog={providerModelCatalog}
              providerModelActions={providerModelActions}
              providerModelsLoading={providerModelsLoading}
              tasksEnabled={tasksEnabled}
              isTaskMasterInstalled={isTaskMasterInstalled}
              onShowAllTasks={onShowAllTasks}
              setInput={setInput}
              isLoadingMoreMessages={isLoadingMoreMessages}
              hasMoreMessages={hasMoreMessages}
              totalMessages={totalMessages}
              sessionMessagesCount={chatMessages.length}
              visibleMessageCount={visibleMessageCount}
              visibleMessages={visibleMessages}
              loadEarlierMessages={loadEarlierMessages}
              revealMessage={revealMessage}
              backgroundTasks={sessionActivity?.tasks}
              sendMessage={sendMessage}
              loadAllMessages={loadAllMessages}
              allMessagesLoaded={allMessagesLoaded}
              isLoadingAllMessages={isLoadingAllMessages}
              loadAllJustFinished={loadAllJustFinished}
              showLoadAllOverlay={showLoadAllOverlay}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={handleGrantToolPermission}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              // Editing replaces the turn and everything after it, so it is only
              // offered when the session is idle — a half-truncated transcript with
              // a live stream writing into it is not recoverable.
              onEditMessage={supportsMessageEditing && !isProcessing ? beginEditMessage : undefined}
              onForkFromMessage={supportsSessionForking ? handleForkFromMessage : undefined}
              isExportSelecting={exportSelectionActive}
              selectedExportRowKeys={exportRowKeys}
              onToggleExportRows={handleToggleExportRows}
            />
          </TranscriptSessionContext.Provider>
        </MarkdownWorkspaceContext.Provider>

        <div className="relative flex-shrink-0">
          {exportSelectionActive && (
            /* Floats over the tail of the transcript instead of taking a row of
               its own: the band either side of the pill stays transparent, so
               the reader still sees the conversation around the controls. It
               must not be laid out in flow: growing the composer's column
               shrinks the pane, and the browser's scroll anchoring then moves
               the reader several screens away from where they were. */
            <div className="pointer-events-none absolute bottom-full left-0 right-0 z-20 mb-2 flex justify-center px-3">
              <TranscriptSelectionBar
                selectedCount={selectedExportMessages.length}
                failed={selectionExportFailed}
                busyFormat={selectionExportFormat}
                onExport={(format) => { void handleExportSelectedRows(format); }}
                onCancel={handleCancelExportSelection}
              />
            </div>
          )}

          {!exportSelectionActive && isUserScrolledUp && chatMessages.length > 0 && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
              <ScrollToBottomAffordance
                isThinking={hasActivityIndicator}
                onScrollToBottom={scrollToBottomAndReset}
              />
            </div>
          )}

          <div ref={composerShellRef}>
          <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          activity={sessionActivity}
          isLoading={isProcessing}
          onAbortSession={handleAbortSession}
          permissionMode={permissionMode}
          availablePermissionModes={availablePermissionModes}
          onSelectPermissionMode={selectPermissionMode}
          providerLabel={selectedProviderLabel}
          provider={provider}
          effort={currentProviderEffort}
          availableEffortOptions={currentProviderEffortOptions}
          onSelectEffort={handleSelectComposerEffort}
          model={currentProviderModel}
          availableModelOptions={currentProviderModelOptions}
          modelCatalogNotice={providerModelCatalog[provider]?.notice}
          onSelectModel={handleSelectComposerModel}
          modelsLoading={providerModelsLoading}
          tokenBudget={tokenBudget}
          onShowTokenUsage={showCostModal}
          isEditingSentMessage={Boolean(editingAnchorId)}
          onCancelEditMessage={cancelEditMessage}
          scheduledMessages={scheduledMessages}
          onScheduleMessage={handleScheduleMessage}
          onCancelScheduledMessage={cancelScheduledMessage}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          onSendQuickReply={handleQuickReplySend}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          queuedDraft={queuedDraft}
          backgroundSendPrompt={backgroundSendPrompt}
          onResolveBackgroundSendPrompt={resolveBackgroundSendPrompt}
          onEditQueuedDraft={editQueuedDraft}
          onDeleteQueuedDraft={deleteQueuedDraft}
          attachedFiles={attachedFiles}
          onRemoveAttachment={(index) =>
            setAttachedFiles((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          fileErrors={fileErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openAttachmentPicker={openAttachmentPicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onVoiceTranscript={handleVoiceTranscript}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          isInputFocused={isInputFocused}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', { provider: selectedProviderLabel })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
        />
          </div>
        </div>
      </div>

      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelActions={providerModelActions}
        activeProvider={provider}
        activeProviderModel={currentProviderModel}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
