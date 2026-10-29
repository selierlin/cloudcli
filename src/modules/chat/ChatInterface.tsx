import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTasksSettings } from '@/modules/task-master';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import PermissionContext from '@/modules/chat/context/PermissionContext';
import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import { api } from '@/shared/api';
import { afterNextPaint, isImeKeyEvent } from '@/shared/utils';
import type {
  ChatMessage,
  PendingPermissionRequest,
  Project,
  ProjectSession,
  SessionEstablishedContext,
  SessionNavigationOptions,
} from '@/shared/types';
import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import { usePermissionModeCopy } from '@/shared/hooks/usePermissionModeCopy';
import { useScheduledMessages } from '@/modules/chat/composer/useScheduledMessages';
import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import type { StreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import { createRevealPacer } from '@/modules/chat/utils/revealPacer';
import type { RevealPacer } from '@/modules/chat/utils/revealPacer';
import { getChatProviderLabel } from '@/modules/chat/utils/chatProviderLabel';
import { forkFailureMessageKey } from '@/modules/chat/utils/forkFailureMessage';
import { buildChatSendOptions } from '@/modules/chat/utils/sendOptions';
import { useBtwSession } from '@/modules/chat/hooks/useBtwSession';
import type { BtwAnchorRequest } from '@/modules/chat/hooks/useBtwSession';
import { useSideAskPlacement } from '@/modules/chat/hooks/useSideAskPlacement';
import BtwDrawer from '@/modules/chat/btw/BtwDrawer';
import { downloadTranscriptExport } from '@/modules/chat/utils/chatExport';
import type { PartialExportFormat } from '@/modules/chat/utils/chatExport';
import { buildTailAnchoredMessageKeys, getTranscriptMessageKey } from '@/modules/chat/utils/messageKeys';
import { collectSelectedMessages } from '@/modules/chat/utils/transcriptSelection';
import { countVisibleTranscriptMessages } from '@/modules/chat/utils/executionProcess';
import {
  useProcessingSessions,
  useSessionProtectionActions,
} from '@/shared/context/SessionProtectionContext';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import CommandResultModal from '@/modules/chat/modals/CommandResultModal';
import TranscriptSelectionBar from '@/modules/chat/TranscriptSelectionBar';
import ShareTranscriptDialog from '@/modules/chat/ShareTranscriptDialog';

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

/** Stable empty transcript for a drawer that has not forked yet. Never mutated. */
const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];

/**
 * True when a keyboard event originated inside the side-question drawer.
 *
 * Used only by the Escape handler below, which has to leave the drawer's own
 * Escape alone while still aborting the watched turn for presses outside it.
 */
function isInsideSideAskDrawer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-slot="btw-drawer"]') !== null;
}

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
  // The side-question copy is visible in its own drawer even though it is not
  // the selected conversation; treating it as visible gives it the same
  // foreground streaming cadence instead of the 5 Hz background one.
  const sideAskStreamingSessionIdRef = useRef<string | null>(null);
  const publishStreamingBatch = useCallback<Parameters<typeof createStreamingBufferRegistry>[0]>(
    (sessionId, updates, provider) => {
      sessionStoreRef.current.updateStreamingBatch(sessionId, updates, provider);
    },
    [],
  );
  const isStreamingSessionVisible = useCallback(
    (sessionId: string) => (
      visibleStreamingSessionIdRef.current === sessionId
      || sideAskStreamingSessionIdRef.current === sessionId
    ),
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
    hasNewerMessages,
    totalMessages,
    isUserScrolledUp,
    showTailAffordance,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    prependedRowCount,
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

  /* ---------------------------------------------------------------- */
  /*  Side question (btw)                                              */
  /* ---------------------------------------------------------------- */

  // Whether the drawer is on screen. Independent of `btw.sessionId`: the drawer
  // opens first, and the first question is what creates the hidden copy.
  const [sideAskOpen, setSideAskOpen] = useState(false);
  // The message an explicit "ask from here" picked; null lets the server use
  // the conversation's latest user message at send time.
  const [sideAskAnchor, setSideAskAnchor] = useState<BtwAnchorRequest>(null);
  // Tool prompts belonging to the copy. Kept apart from the viewed
  // conversation's list so neither surface shows the other's requests.
  const [sideAskPermissionRequests, setSideAskPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  // Set when the reader tucks the drawer away to work in the main conversation
  // again. Available in every layout: on a phone the full-width sheet would
  // otherwise keep the main composer out of reach for as long as the branch
  // lives, and a docked panel still costs 420px the reader may not want to pay.
  const [sideAskMinimized, setSideAskMinimized] = useState(false);
  // Whether the drawer sits beside the transcript or floats over it, decided by
  // the chat column's own width rather than the viewport's — the sidebar can be
  // dragged and the editor can take half the page.
  const sideAskLayout = useSideAskPlacement();

  const sideAskSourceSessionId = currentSessionId || selectedSession?.id || null;

  // Same builder the main composer uses, fed the values it currently sends
  // with: the drawer must not be able to run under a different permission mode
  // (or model/effort) than the conversation it branched from.
  const buildSideAskOptions = useCallback((text: string) => buildChatSendOptions({
    provider,
    model: currentProviderModel,
    effort: currentProviderEffort,
    permissionMode,
    resolvePermissionModeForProvider,
    selectedSession,
  }, text), [
    currentProviderEffort,
    currentProviderModel,
    permissionMode,
    provider,
    resolvePermissionModeForProvider,
    selectedSession,
  ]);

  const btw = useBtwSession({
    sourceSessionId: sideAskSourceSessionId,
    provider,
    anchor: sideAskAnchor,
    sendMessage,
    sessionStore,
    buildOptions: buildSideAskOptions,
  });

  // Read straight from the activity map so a frame that changes this copy's
  // state re-renders the drawer, exactly as the viewed conversation does.
  const sideAskActivity = btw.sessionId ? processingSessions.get(btw.sessionId) : undefined;
  const sideAskProcessing = Boolean(sideAskActivity && !sideAskActivity.background);
  const sideAskCanAbort = sideAskProcessing && Boolean(sideAskActivity?.canInterrupt);
  sideAskStreamingSessionIdRef.current = btw.sessionId;

  // Read on every render rather than memoized: the store mutates its slot in
  // place, so a memo on the session id alone would freeze the transcript.
  const sideAskMessages = btw.sessionId
    ? normalizedToChatMessages(sessionStore.getMessages(btw.sessionId))
    : EMPTY_CHAT_MESSAGES;

  const handleSideAskClose = useCallback(async () => {
    const closed = await btw.close();
    if (!closed) {
      // The copy is still doing something or the request failed: the drawer
      // stays up with its retry, so the reader never loses the only control.
      return;
    }
    setSideAskOpen(false);
    setSideAskAnchor(null);
    setSideAskPermissionRequests([]);
    setSideAskMinimized(false);
  }, [btw]);

  // The drawer's "start over": discard the copy and fork a fresh one at the
  // same cut point. Clearing the anchor here would quietly widen the context to
  // the newest message, and the reader would have to re-open the drawer from
  // the row they picked to get their branch back.
  const handleSideAskRefork = useCallback(async () => {
    const closed = await btw.refork();
    if (!closed) {
      return;
    }
    setSideAskPermissionRequests([]);
  }, [btw]);

  const handleSideAskPromote = useCallback(async () => {
    const promotedSessionId = await btw.promote();
    if (!promotedSessionId) {
      return;
    }
    setSideAskOpen(false);
    setSideAskAnchor(null);
    setSideAskPermissionRequests([]);
    setSideAskMinimized(false);
    const promotedProvider = selectedSession?.__provider;
    if (promotedProvider && selectedProject) {
      // The conversations feed does not receive `session_upserted`, so the new
      // visible row is bridged the same way a formal fork is.
      onSessionForked?.(promotedSessionId, { provider: promotedProvider, project: selectedProject });
    }
    onNavigateToSession?.(promotedSessionId);
  }, [btw, onNavigateToSession, onSessionForked, selectedProject, selectedSession?.__provider]);

  const handleSideAskPermissionDecision = useCallback((
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => {
    const ids = (Array.isArray(requestIds) ? requestIds : [requestIds]).filter(Boolean);
    if (ids.length === 0) {
      return;
    }
    ids.forEach((requestId) => {
      sendMessage({
        type: 'chat.permission-response',
        requestId,
        allow: Boolean(decision?.allow),
        updatedInput: decision?.updatedInput,
        message: decision?.message,
        rememberEntry: decision?.rememberEntry,
      });
    });
    setSideAskPermissionRequests((previous) =>
      previous.filter((request) => !ids.includes(request.requestId)));
  }, [sendMessage]);

  // A message-level entry always branches from that message. Asking again while
  // the drawer is open replaces the copy rather than stacking a second one.
  const handleSideAskFromMessage = useCallback(async (message: ChatMessage) => {
    const nextAnchor: BtwAnchorRequest = {
      forkAnchorId: message.forkAnchorId,
      messageId: message.id,
    };
    if (btw.sessionId) {
      const closed = await btw.refork();
      if (!closed) {
        return;
      }
      setSideAskPermissionRequests([]);
    }
    setSideAskAnchor(nextAnchor);
    setSideAskOpen(true);
    setSideAskMinimized(false);
  }, [btw]);

  // The cut point, resolved against the transcript the reader can see: the
  // server answers with a display id only after the fork exists.
  const sideAskAnchorLabel = useMemo(() => {
    // The server moves the cut to the end of the requested row's turn, so its
    // answer names the real boundary; the request is the fallback until the
    // copy exists.
    const messageId = btw.anchorInfo?.anchorMessageId ?? sideAskAnchor?.messageId ?? null;
    if (!messageId) {
      return null;
    }
    const index = chatMessages.findIndex((message) => message.id === messageId);
    return index >= 0 ? t('sideAsk.anchorAt', { index: index + 1 }) : null;
  }, [btw.anchorInfo?.anchorMessageId, chatMessages, sideAskAnchor?.messageId, t]);

  // Providers that can only cut at a coarser boundary say so, because "why can
  // it not see my last message" is otherwise read as a bug.
  const sideAskAnchorNotice = btw.anchorInfo?.anchorDegraded
    ? (provider === 'codex'
      ? t('sideAsk.anchorDegradedCodex')
      : provider === 'zcode'
        ? t('sideAsk.anchorDegradedZcode')
        : null)
    : null;

  // Named through the same module as the composer menu and settings, so this
  // header cannot reintroduce a second word for the same mode.
  const permissionModeCopy = usePermissionModeCopy(provider, permissionMode);

  const sideAskPermissionModeLabel = t('sideAsk.permissionMode', {
    mode: permissionModeCopy.label,
  });

  // On WebSocket reconnect, request a bounded persisted-tail sync (deferred
  // while Chat is hidden), then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await requestLatestMessages(selectedSession.id, isActive);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());

    // The aside copy holds its own subscription, and a subscription does not
    // survive the socket. Re-subscribing it here keeps a live drawer streaming
    // after a blip and is also what tells the server the copy still has a
    // watcher, so its idle reclaim never fires under an open drawer.
    const asideSessionId = sideAskStreamingSessionIdRef.current;
    const sessionIds = asideSessionId && asideSessionId !== selectedSession.id
      ? [selectedSession.id, asideSessionId]
      : [selectedSession.id];

    sendMessage({
      type: 'chat.subscribe',
      sessions: sessionIds.map((sessionId) => ({
        sessionId,
        lastSeq: lastSeqRef.current.get(sessionId) ?? 0,
      })),
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
    sideAskSessionId: btw.sessionId,
    setSideAskPermissionRequests,
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
      // Escape cancels a pinyin candidate while the user is composing; aborting
      // the turn on that press would end their answer mid-word.
      if (isImeKeyEvent(event)) {
        return;
      }
      // The drawer owns Escape for presses that land inside it, because
      // "close this panel" must not read as "stop the watched turn". Desktop
      // keeps the drawer beside a still-usable composer, so a press in the
      // conversation behind it keeps aborting, exactly as before the drawer
      // existed.
      if (sideAskOpen && isInsideSideAskDrawer(event.target)) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, sideAskOpen]);

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
    useScheduledMessages(currentSessionId || selectedSession?.id || null, subscribe);

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
  // Publishing has its own confirmation flow, so it stays open independently of
  // the export buttons and never touches the downloaded file.
  const [shareSelectionOpen, setShareSelectionOpen] = useState(false);

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
  // The exported header names the conversation's size, so the denominator has
  // to be the session, not the page. A paginated session keeps only a window in
  // memory (a search hit can even leave newer rows out); there the export says
  // "excerpt" without a total instead of publishing a number that is too small.
  //
  // Both directions have to be checked, and neither can be read off a count:
  // `chatMessages` drops control rows and folds tool results into their call,
  // while `totalMessages` counts the server's rows, so the two never match for
  // a session that used a tool.
  const wholeTranscriptLoaded = !hasMoreMessages && !hasNewerMessages;
  // "I picked everything" is a different question from "the whole transcript is
  // in memory", and array lengths cannot answer it: the pickable rows are a
  // strict subset of the transcript (process rows are picked through their
  // turn), and rows above the loaded window's first turn belong to no turn at
  // all. Compare the two tallies the header itself uses instead, so picking
  // every row a reader would count reads as the whole conversation.
  const selectionIsWholeTranscript = useMemo(
    () => wholeTranscriptLoaded
      && countVisibleTranscriptMessages(selectedExportMessages, getExportMessageKey)
        === countVisibleTranscriptMessages(chatMessages, getExportMessageKey),
    [chatMessages, getExportMessageKey, selectedExportMessages, wholeTranscriptLoaded],
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
        totalMessages: wholeTranscriptLoaded ? chatMessages : undefined,
        isExcerpt: !selectionIsWholeTranscript,
      }, t('export.filePrefix', { defaultValue: 'conversation' }));
      // Same rule as sharing: the file exists now, so the picking has done its
      // job and the transcript goes back to the reader instead of leaving them
      // in a mode with nothing left to do.
      handleCancelExportSelection();
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
    handleCancelExportSelection,
    provider,
    selectedExportMessages,
    selectedProject,
    selectedSession?.title,
    selectionExportFormat,
    selectionIsWholeTranscript,
    t,
    wholeTranscriptLoaded,
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
      {/* The drawer is a sibling of the conversation, not an overlay on it: at
          this width the transcript gives up 420px instead of losing it. */}
      <div ref={sideAskLayout.ref} className="relative flex h-full min-h-0">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
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
              showTailAffordance={showTailAffordance}
              onScrollToBottom={scrollToBottomAndReset}
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
              prependedRowCount={prependedRowCount}
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
              onAskAsideFromMessage={supportsSessionForking ? handleSideAskFromMessage : undefined}
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
                onShare={() => setShareSelectionOpen(true)}
                onCancel={handleCancelExportSelection}
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

      {/* The drawer reads the copy's own session id for workflow cards, and the
          project's id so markdown images resolve the same way they do in the
          main transcript. */}
      <MarkdownWorkspaceContext.Provider value={markdownWorkspaceValue}>
        <TranscriptSessionContext.Provider value={{ sessionId: btw.sessionId }}>
          <BtwDrawer
            open={sideAskOpen}
            btw={btw}
            placement={sideAskLayout.placement}
            minimized={sideAskMinimized}
            onMinimize={() => setSideAskMinimized(true)}
            onRestore={() => setSideAskMinimized(false)}
            sourceTitle={selectedSession?.title || selectedSession?.summary || selectedSession?.name || ''}
            provider={provider}
            selectedProject={selectedProject}
            messages={sideAskMessages}
            isProcessing={sideAskProcessing}
            canAbort={sideAskCanAbort}
            sourceIsProcessing={isProcessing}
            anchorLabel={sideAskAnchorLabel}
            anchorNotice={sideAskAnchorNotice}
            permissionModeLabel={sideAskPermissionModeLabel}
            permissionRequests={sideAskPermissionRequests}
            onPermissionDecision={handleSideAskPermissionDecision}
            onGrantToolPermission={handleGrantToolPermission}
            onSend={btw.send}
            onClose={() => { void handleSideAskClose(); }}
            onRefork={() => { void handleSideAskRefork(); }}
            onPromote={() => { void handleSideAskPromote(); }}
            createDiff={createDiff}
            onFileOpen={onFileOpen}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
          />
        </TranscriptSessionContext.Provider>
      </MarkdownWorkspaceContext.Provider>
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

      {shareSelectionOpen && (
        <ShareTranscriptDialog
          onClose={() => setShareSelectionOpen(false)}
          // Publishing finishes the pick, so the reader leaves the mode as soon
          // as the link exists instead of coming back to a transcript they can
          // no longer type into.
          onShared={handleCancelExportSelection}
          messages={selectedExportMessages}
          sessionTitle={selectedSession?.title || t('export.untitled', { defaultValue: 'Conversation' })}
          provider={provider}
          selectedProject={selectedProject}
          sessionId={selectedSession?.id ?? null}
          totalMessages={wholeTranscriptLoaded ? chatMessages : undefined}
          isExcerpt={!selectionIsWholeTranscript}
        />
      )}
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);
