import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import '@/index.css';
import 'katex/dist/katex.min.css';
import { i18n } from '@/modules/i18n';
import { useSessionStore } from '@/modules/chat';
import { normalizedToChatMessages } from '@/modules/chat';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { DiffLine, NormalizedMessage, ProviderModelActions } from '@/shared/types';

const SESSION_ID = 'transcript-layout-fixture';
const BASE_TIME_MS = Date.parse('2026-09-13T08:00:00.000Z');

type FixtureAction =
  | 'seed-stable'
  | 'append-thinking'
  | 'append-text'
  | 'append-tool'
  | 'seed-wrapping-samples'
  | 'finalize-stream'
  | 'set-processing'
  | 'set-top-chrome'
  | 'set-load-all-overlay'
  | 'scroll-bottom'
  | 'inject-negative-gap'
  | 'clear-negative-gap'
  | 'block-main-thread';

/**
 * Which of the three mutually exclusive bars above the transcript is showing.
 * The fixture viewport is the only place their real heights can be measured, so
 * the RS06 geometry assertions drive them from here instead of from pagination
 * timing.
 */
type FixtureTopChrome = 'none' | 'loading' | 'counting' | 'legacy';

type FixtureStep = {
  action: FixtureAction;
  payload?: unknown;
};

type FixtureStepResult = {
  actualBlockMs?: number;
  timestamp?: string;
};

type FixtureController = {
  dispatch(step: FixtureStep): Promise<FixtureStepResult>;
  snapshot(): {
    messageCount: number;
    processing: boolean;
  };
};

type FixtureWindow = Window & typeof globalThis & {
  __TRANSCRIPT_FIXTURE__?: FixtureController;
};

const providerModelActions: ProviderModelActions = {
  create: async () => undefined,
  update: async () => undefined,
  remove: async () => undefined,
};

function emptyDiff(): DiffLine[] {
  return [];
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function TranscriptLayoutFixture() {
  const sessionStore = useSessionStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sequenceRef = useRef(0);
  const followFrameRef = useRef<number | null>(null);
  const followUntilRef = useRef(0);
  const followGeometryRef = useRef<string | null>(null);
  const followStableFramesRef = useRef(0);
  // Drives the same presentation branch as a provider run entering and leaving its active lifecycle.
  const [isProcessing, setIsProcessing] = useState(true);
  // Captures explicit fixture input so automatic following can be disabled by future ownership scenarios.
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  // Selects which top bar renders, so the geometry assertions can compare their
  // real heights without waiting for pagination to produce each state.
  const [topChrome, setTopChrome] = useState<FixtureTopChrome>('none');
  // Drives the load-all pill independently: it can appear while any top bar is showing.
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);

  sessionStore.setActiveSession(SESSION_ID);
  const normalizedMessages = sessionStore.getMessages(SESSION_ID);
  const chatMessages = useMemo(
    () => normalizedToChatMessages(normalizedMessages),
    [normalizedMessages],
  );

  // Each entry below is the production condition for one of the pane's three
  // mutually exclusive top bars, or for none of them.
  const topChromeProps = useMemo(() => {
    const tailVisibleCount = chatMessages.length;
    switch (topChrome) {
      case 'loading':
        return { isLoadingMoreMessages: true, hasMoreMessages: true, allMessagesLoaded: false, visibleMessageCount: tailVisibleCount };
      case 'counting':
        return { isLoadingMoreMessages: false, hasMoreMessages: true, allMessagesLoaded: false, visibleMessageCount: tailVisibleCount };
      case 'legacy':
        return { isLoadingMoreMessages: false, hasMoreMessages: false, allMessagesLoaded: false, visibleMessageCount: Math.max(1, tailVisibleCount - 1) };
      case 'none':
      default:
        return { isLoadingMoreMessages: false, hasMoreMessages: false, allMessagesLoaded: true, visibleMessageCount: tailVisibleCount };
    }
  }, [chatMessages.length, topChrome]);

  const nextTimestamp = useCallback(() => {
    sequenceRef.current += 1;
    return new Date(BASE_TIME_MS + sequenceRef.current * 1000).toISOString();
  }, []);

  const appendRealtime = useCallback((message: Omit<NormalizedMessage, 'sessionId' | 'provider'>) => {
    sessionStore.appendRealtime(SESSION_ID, {
      ...message,
      sessionId: SESSION_ID,
      provider: 'codex',
    });
  }, [sessionStore]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  const followTranscriptLayout = useCallback((minimumDurationMs = 0) => {
    if (isUserScrolledUp || !scrollContainerRef.current) return;
    followUntilRef.current = Math.max(followUntilRef.current, Date.now() + minimumDurationMs);
    followGeometryRef.current = null;
    followStableFramesRef.current = 0;
    scrollToBottom();
    if (followFrameRef.current !== null) return;

    const tick = () => {
      followFrameRef.current = null;
      const container = scrollContainerRef.current;
      if (!container || isUserScrolledUp) return;
      container.scrollTop = container.scrollHeight;
      const geometry = `${container.scrollTop}:${container.scrollHeight}:${container.clientHeight}`;
      if (geometry === followGeometryRef.current) {
        followStableFramesRef.current += 1;
      } else {
        followGeometryRef.current = geometry;
        followStableFramesRef.current = 0;
      }
      if (Date.now() < followUntilRef.current || followStableFramesRef.current < 2) {
        followFrameRef.current = requestAnimationFrame(tick);
      }
    };
    followFrameRef.current = requestAnimationFrame(tick);
  }, [isUserScrolledUp, scrollToBottom]);

  const dispatch = useCallback(async (step: FixtureStep): Promise<FixtureStepResult> => {
    switch (step.action) {
      case 'seed-stable': {
        appendRealtime({
          id: 'seed-user',
          kind: 'text',
          role: 'user',
          content: '请检查这段长会话。',
          timestamp: nextTimestamp(),
        });
        for (let index = 0; index < 48; index += 1) {
          appendRealtime({
            id: `seed-assistant-${index}`,
            kind: 'text',
            role: 'assistant',
            content: `稳定基线消息 ${index + 1}。这段内容用于让真实 transcript 产生可滚动高度。`,
            timestamp: nextTimestamp(),
          });
        }
        await nextPaint();
        scrollToBottom();
        await nextPaint();
        return {};
      }
      case 'append-thinking': {
        const content = typeof step.payload === 'string' ? step.payload : '正在分析布局变化。';
        sessionStore.updateStreaming(SESSION_ID, content, 'codex', 'thinking');
        await nextPaint();
        return {};
      }
      case 'append-text': {
        const content = typeof step.payload === 'string' ? step.payload : '这是最终正文。';
        sessionStore.updateStreaming(SESSION_ID, content, 'codex', 'text');
        await nextPaint();
        return {};
      }
      case 'seed-wrapping-samples': {
        // One message per line-break rule the message body can hit. The strings
        // are picked so tool-content-wrapping.spec.ts can assert on word
        // boundaries rather than on font-dependent break points.
        appendRealtime({
          id: 'wrap-words',
          kind: 'text',
          role: 'assistant',
          // Inside inline code on purpose: the global rule only reaches
          // `<pre>`/`<code>`, so a plain paragraph would not exercise it and
          // the word-boundary assertion would pass either way.
          content: `\`${'aaaaaaaaaa bbbbbbbbbb '.repeat(6).trim()}\``,
          timestamp: nextTimestamp(),
        });
        appendRealtime({
          id: 'wrap-overflow',
          kind: 'text',
          role: 'assistant',
          content: `Long token: ${'c'.repeat(400)}`,
          timestamp: nextTimestamp(),
        });
        appendRealtime({
          id: 'wrap-inline',
          kind: 'text',
          role: 'assistant',
          content: 'See `src/modules/chat/tools/ContentRenderers/TextContent.tsx` for the renderer behind this surface.',
          timestamp: nextTimestamp(),
        });
        appendRealtime({
          id: 'wrap-json',
          kind: 'text',
          role: 'assistant',
          content: JSON.stringify({ key: 'd'.repeat(300) }),
          timestamp: nextTimestamp(),
        });
        appendRealtime({
          id: 'wrap-fenced',
          kind: 'text',
          role: 'assistant',
          content: `\`\`\`ts
const longLine = "${'e'.repeat(300)}";
\`\`\``,
          timestamp: nextTimestamp(),
        });
        await nextPaint();
        return {};
      }
      case 'append-tool': {
        const toolIndex = sequenceRef.current + 1;
        const timestamp = nextTimestamp();
        appendRealtime({
          id: `tool-${toolIndex}`,
          kind: 'tool_use',
          timestamp,
          toolId: `tool-${toolIndex}`,
          toolName: 'Read',
          toolInput: JSON.stringify({ file_path: `/tmp/fixture-${toolIndex}.txt` }),
          status: 'running',
        });
        await nextPaint();
        return { timestamp };
      }
      case 'finalize-stream':
        sessionStore.finalizeStreaming(SESSION_ID);
        await nextPaint();
        return {};
      case 'set-processing':
        setIsProcessing(Boolean(step.payload));
        await nextPaint();
        return {};
      case 'set-top-chrome': {
        const next = step.payload as FixtureTopChrome;
        setTopChrome(next);
        await nextPaint();
        return {};
      }
      case 'set-load-all-overlay':
        setShowLoadAllOverlay(Boolean(step.payload));
        await nextPaint();
        return {};
      case 'scroll-bottom':
        scrollToBottom();
        await nextPaint();
        return {};
      case 'inject-negative-gap': {
        const container = scrollContainerRef.current;
        const gapPx = Number(step.payload) || 360;
        if (container) container.scrollTop = Math.max(0, container.scrollTop - gapPx);
        await nextPaint();
        return {};
      }
      case 'clear-negative-gap': {
        scrollToBottom();
        await nextPaint();
        return {};
      }
      case 'block-main-thread': {
        const targetMs = Math.max(0, Number(step.payload) || 0);
        const startedAt = performance.now();
        while (performance.now() - startedAt < targetMs) {
          // Intentional busy-loop: this fixture verifies recovery from an actual main-thread stall.
        }
        return { actualBlockMs: performance.now() - startedAt };
      }
    }
  }, [appendRealtime, followTranscriptLayout, nextTimestamp, scrollToBottom, sessionStore]);

  useLayoutEffect(() => {
    if (chatMessages.length > 0) followTranscriptLayout();
  }, [chatMessages, followTranscriptLayout]);

  useEffect(() => () => {
    if (followFrameRef.current !== null) cancelAnimationFrame(followFrameRef.current);
  }, []);

  useEffect(() => {
    const fixtureWindow = window as FixtureWindow;
    fixtureWindow.__TRANSCRIPT_FIXTURE__ = {
      dispatch,
      snapshot: () => ({ messageCount: chatMessages.length, processing: isProcessing }),
    };
    window.dispatchEvent(new Event('transcript-fixture-ready'));
    return () => {
      delete fixtureWindow.__TRANSCRIPT_FIXTURE__;
    };
  }, [chatMessages.length, dispatch, isProcessing]);

  return (
    <div
      className="flex min-h-0 flex-col bg-background text-foreground"
      data-testid="transcript-fixture"
      style={{ height: 640 }}
    >
      <ChatMessagesPane
        scrollContainerRef={scrollContainerRef}
        onWheel={() => setIsUserScrolledUp(true)}
        onTouchMove={() => setIsUserScrolledUp(true)}
        isLoadingSessionMessages={false}
        isProcessing={isProcessing}
        isUserScrolledUp={isUserScrolledUp}
        onReasoningAutoCollapseStart={() => followTranscriptLayout(350)}
        chatMessages={chatMessages}
        selectedSession={{ id: SESSION_ID, provider: 'codex' }}
        provider="codex"
        setProvider={() => undefined}
        textareaRef={textareaRef}
        providerModels={{ claude: '', cursor: '', codex: 'gpt-5', opencode: '', dsh: '', workbuddy: '', pi: '', zcode: '' }}
        setProviderModel={() => undefined}
        providerModelCatalog={{}}
        providerModelActions={providerModelActions}
        providerModelsLoading={false}
        tasksEnabled={false}
        isTaskMasterInstalled={false}
        setInput={() => undefined}
        isLoadingMoreMessages={topChromeProps.isLoadingMoreMessages}
        hasMoreMessages={topChromeProps.hasMoreMessages}
        totalMessages={chatMessages.length}
        sessionMessagesCount={chatMessages.length}
        visibleMessageCount={topChromeProps.visibleMessageCount}
        visibleMessages={chatMessages}
        loadEarlierMessages={() => undefined}
        loadAllMessages={() => undefined}
        allMessagesLoaded={topChromeProps.allMessagesLoaded}
        isLoadingAllMessages={false}
        loadAllJustFinished={false}
        showLoadAllOverlay={showLoadAllOverlay}
        createDiff={emptyDiff}
        onGrantToolPermission={() => ({ success: true })}
        showThinking
        selectedProject={{ projectId: 'fixture-project', displayName: 'Fixture', fullPath: '/tmp' }}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Transcript fixture root is missing');

ReactDOM.createRoot(root).render(
  <I18nextProvider i18n={i18n}>
    <UiPreferencesProvider>
      <TranscriptLayoutFixture />
    </UiPreferencesProvider>
  </I18nextProvider>,
);
