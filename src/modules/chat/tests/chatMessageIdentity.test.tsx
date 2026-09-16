import assert from 'node:assert/strict';

import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import type {
  ChatMessage,
  NormalizedMessage,
  Project,
  ProjectSession,
  ToolGroupItem,
} from '@/shared/types';
import { normalizedToChatMessages } from '@/modules/chat/hooks/useChatMessages';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';

vi.mock('@/modules/chat/tools', () => ({
  ToolRenderer: () => null,
  ToolErrorDisplay: () => null,
  SubagentPanel: () => null,
  shouldHideToolResult: () => false,
}));

vi.mock('@/modules/chat/transcript/ToolGroupContainer', () => ({
  default: ({ group }: { group: ToolGroupItem }) => (
    <div data-testid="tool-group">
      {group.messages.map((entry) => `${entry.id}:${entry.toolStatus}`).join('|')}
    </div>
  ),
}));

vi.mock('@/modules/chat/transcript/ProviderSelectionEmptyState', () => ({
  default: () => null,
}));

vi.mock('@/shared/ui', () => ({
  LLMProviderLogo: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
} as Project;

const streamMessage = (content: string): NormalizedMessage => ({
  id: '__streaming_session-1',
  // The store assigns a stable client segmentId to every streaming cycle;
  // provider-synthesized row ids are deliberately not rendered identities.
  segmentId: 'stream-segment:session-1:main:1',
  sessionId: 'session-1',
  timestamp: '2026-09-16T10:00:00.000Z',
  provider: 'claude',
  kind: 'stream_delta',
  content,
});

const paneProps = (
  visibleMessages: ReturnType<typeof normalizedToChatMessages>,
): ComponentProps<typeof ChatMessagesPane> => ({
  scrollContainerRef: createRef<HTMLDivElement>(),
  onWheel: vi.fn(),
  onTouchMove: vi.fn(),
  isLoadingSessionMessages: false,
  isProcessing: true,
  chatMessages: visibleMessages,
  selectedSession: { id: 'session-1' } as ProjectSession,
  provider: 'claude',
  setProvider: vi.fn(),
  textareaRef: createRef<HTMLTextAreaElement>(),
  providerModels: {} as ComponentProps<typeof ChatMessagesPane>['providerModels'],
  setProviderModel: vi.fn(),
  providerModelCatalog: {},
  providerModelActions: {} as ComponentProps<typeof ChatMessagesPane>['providerModelActions'],
  providerModelsLoading: false,
  tasksEnabled: false,
  isTaskMasterInstalled: false,
  setInput: vi.fn(),
  isLoadingMoreMessages: false,
  hasMoreMessages: false,
  totalMessages: visibleMessages.length,
  sessionMessagesCount: visibleMessages.length,
  visibleMessageCount: visibleMessages.length,
  visibleMessages,
  loadEarlierMessages: vi.fn(),
  loadAllMessages: vi.fn(),
  allMessagesLoaded: true,
  isLoadingAllMessages: false,
  loadAllJustFinished: false,
  showLoadAllOverlay: false,
  createDiff: () => [],
  onGrantToolPermission: () => ({ success: false }),
  selectedProject: project,
});

const renderPane = (messages: ReturnType<typeof normalizedToChatMessages>) => (
  <UiPreferencesProvider>
    <ChatMessagesPane {...paneProps(messages)} />
  </UiPreferencesProvider>
);

test('a growing stream keeps the same transcript row DOM node', () => {
  const initialMessages = normalizedToChatMessages([streamMessage('Part one')]);
  const view = render(renderPane(initialMessages));
  const initialRow = view.container.querySelector('.chat-message.assistant');
  assert.ok(initialRow, 'expected the streaming assistant row');

  const updatedMessages = normalizedToChatMessages([streamMessage('Part one and two')]);
  view.rerender(renderPane(updatedMessages));

  const updatedRow = view.container.querySelector('.chat-message.assistant');
  assert.strictEqual(updatedRow, initialRow);
  assert.match(updatedRow?.textContent ?? '', /Part one and two/);
});

test('an unseen long transcript row reserves more space than the fixed fallback', () => {
  class InertIntersectionObserver {
    constructor(_callback: IntersectionObserverCallback) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('IntersectionObserver', InertIntersectionObserver);

  try {
    const messages: ChatMessage[] = Array.from({ length: 31 }, (_, index) => ({
      id: `message-${index}`,
      type: index === 0 ? 'assistant' : 'user',
      content: index === 0 ? 'A'.repeat(1_200) : `message ${index}`,
      timestamp: `2026-09-16T10:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const view = render(
      <UiPreferencesProvider>
        <ChatMessagesPane {...paneProps(messages)} isProcessing={false} />
      </UiPreferencesProvider>,
    );

    const firstRow = view.container.querySelector(
      '[data-message-timestamp="2026-09-16T10:00:00.000Z"]',
    ) as HTMLElement;
    assert.ok(Number.parseFloat(firstRow.style.height) > 100);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('manually closing completed process rows never hides an attention tool in the same visual group', () => {
  const user: ChatMessage = {
    id: 'user', type: 'user', content: 'Run checks', timestamp: '2026-09-16T10:00:00.000Z',
  };
  const completedTool: ChatMessage = {
    id: 'completed-tool',
    type: 'assistant',
    content: '',
    timestamp: '2026-09-16T10:00:01.000Z',
    isToolUse: true,
    toolName: 'Read',
    toolInput: { file_path: '/repo/a.ts' },
    toolStatus: 'completed',
  };
  const failedTool: ChatMessage = {
    id: 'failed-tool',
    type: 'assistant',
    content: '',
    timestamp: '2026-09-16T10:00:02.000Z',
    isToolUse: true,
    toolName: 'Read',
    toolInput: { file_path: '/repo/b.ts' },
    toolStatus: 'error',
  };
  const answer: ChatMessage = {
    id: 'answer', type: 'assistant', content: 'One check failed.', timestamp: '2026-09-16T10:00:03.000Z',
  };
  const initialMessages = [user, completedTool, answer];
  const view = render(
    <UiPreferencesProvider>
      <ChatMessagesPane {...paneProps(initialMessages)} isProcessing={false} />
    </UiPreferencesProvider>,
  );

  fireEvent.click(view.getByRole('button', { name: /transcript.executionProcess.execution/ }));
  view.rerender(
    <UiPreferencesProvider>
      <ChatMessagesPane {...paneProps([user, completedTool, failedTool, answer])} isProcessing={false} />
    </UiPreferencesProvider>,
  );

  const groupContent = view.getByTestId('tool-group');
  assert.notEqual(groupContent.parentElement?.getAttribute('aria-hidden'), 'true');
  assert.equal(groupContent.parentElement?.classList.contains('hidden'), false);
});

test('one process disclosure reveals reasoning and tools without a nested thought disclosure', () => {
  const user: ChatMessage = {
    id: 'user', type: 'user', content: 'Inspect the code', timestamp: '2026-09-16T10:00:00.000Z',
  };
  const reasoning: ChatMessage = {
    id: 'reasoning',
    type: 'assistant',
    content: 'private reasoning detail',
    timestamp: '2026-09-16T10:00:01.000Z',
    isThinking: true,
  };
  const tool: ChatMessage = {
    id: 'tool',
    type: 'assistant',
    content: '',
    timestamp: '2026-09-16T10:00:02.000Z',
    isToolUse: true,
    toolName: 'Read',
    toolInput: { file_path: '/repo/example.ts' },
    toolStatus: 'completed',
  };
  const answer: ChatMessage = {
    id: 'answer', type: 'assistant', content: 'Finished.', timestamp: '2026-09-16T10:00:03.000Z',
  };
  const view = render(
    <UiPreferencesProvider>
      <ChatMessagesPane
        {...paneProps([user, reasoning, tool, answer])}
        isProcessing={false}
        showThinking
      />
    </UiPreferencesProvider>,
  );

  fireEvent.click(view.getByRole('button', { name: /transcript.executionProcess.execution/ }));

  assert.match(view.container.textContent ?? '', /private reasoning detail/);
  assert.equal(view.queryByRole('button', { name: /Thought for/ }), null);
  assert.ok(view.getByTestId('tool-group'));
});

test('keeps a user-opened process stage open after switching away and back', () => {
  const user: ChatMessage = {
    id: 'user', type: 'user', content: 'Inspect', timestamp: '2026-09-16T10:00:00.000Z',
  };
  const tool: ChatMessage = {
    id: 'tool', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
    isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
  };
  const answer: ChatMessage = {
    id: 'answer', type: 'assistant', content: 'Done', timestamp: '2026-09-16T10:00:02.000Z',
  };
  const firstSession = [user, tool, answer];
  const secondSession: ChatMessage[] = [{
    id: 'other', type: 'user', content: 'Other session', timestamp: '2026-09-16T11:00:00.000Z',
  }];
  const view = render(
    <UiPreferencesProvider>
      <ChatMessagesPane {...paneProps(firstSession)} isProcessing={false} />
    </UiPreferencesProvider>,
  );

  fireEvent.click(view.getByRole('button', { name: /transcript.executionProcess.execution/ }));
  view.rerender(
    <UiPreferencesProvider>
      <ChatMessagesPane
        {...paneProps(secondSession)}
        selectedSession={{ id: 'session-2' } as ProjectSession}
        isProcessing={false}
      />
    </UiPreferencesProvider>,
  );
  view.rerender(
    <UiPreferencesProvider>
      <ChatMessagesPane {...paneProps(firstSession)} isProcessing={false} />
    </UiPreferencesProvider>,
  );

  const groupContent = view.getByTestId('tool-group');
  assert.equal(groupContent.parentElement?.classList.contains('hidden'), false);
});

test('waits for a stable answer before auto-collapsing its preceding process stage', () => {
  vi.useFakeTimers();
  try {
    const user: ChatMessage = {
      id: 'user', type: 'user', content: 'Inspect', timestamp: '2026-09-16T10:00:00.000Z',
    };
    const tool: ChatMessage = {
      id: 'tool', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
      isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
    };
    const streamingAnswer: ChatMessage = {
      id: 'answer', type: 'assistant', content: 'Almost done', timestamp: '2026-09-16T10:00:02.000Z',
      isStreaming: true,
    };
    const completedAnswer = { ...streamingAnswer, content: 'Done', isStreaming: false };
    const view = render(
      <UiPreferencesProvider>
        <ChatMessagesPane {...paneProps([user, tool, streamingAnswer])} />
      </UiPreferencesProvider>,
    );

    view.rerender(
      <UiPreferencesProvider>
        <ChatMessagesPane {...paneProps([user, tool, completedAnswer])} isProcessing={false} />
      </UiPreferencesProvider>,
    );
    let groupContent = view.getByTestId('tool-group');
    assert.equal(groupContent.parentElement?.classList.contains('hidden'), false);

    act(() => vi.advanceTimersByTime(799));
    groupContent = view.getByTestId('tool-group');
    assert.equal(groupContent.parentElement?.classList.contains('hidden'), false);

    act(() => vi.advanceTimersByTime(1));
    groupContent = view.getByTestId('tool-group');
    assert.equal(groupContent.parentElement?.classList.contains('hidden'), true);
  } finally {
    vi.useRealTimers();
  }
});

test('opens only the completed process stage containing a search target', () => {
  const user: ChatMessage = {
    id: 'user', type: 'user', content: 'Inspect', timestamp: '2026-09-16T10:00:00.000Z',
  };
  const firstTool: ChatMessage = {
    id: 'tool-1', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:01.000Z',
    isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/a.ts' }, toolStatus: 'completed',
  };
  const firstAnswer: ChatMessage = {
    id: 'answer-1', type: 'assistant', content: 'First result', timestamp: '2026-09-16T10:00:02.000Z',
  };
  const secondTool: ChatMessage = {
    id: 'tool-2', type: 'assistant', content: '', timestamp: '2026-09-16T10:00:03.000Z',
    isToolUse: true, toolName: 'Read', toolInput: { file_path: '/repo/b.ts' }, toolStatus: 'completed',
  };
  const finalAnswer: ChatMessage = {
    id: 'answer-2', type: 'assistant', content: 'Final result', timestamp: '2026-09-16T10:00:04.000Z',
  };
  const view = render(
    <UiPreferencesProvider>
      <ChatMessagesPane
        {...paneProps([user, firstTool, firstAnswer, secondTool, finalAnswer])}
        isProcessing={false}
        searchRevealRequest={{
          sessionId: 'session-1',
          timestamp: secondTool.timestamp,
          requestId: 1,
        }}
      />
    </UiPreferencesProvider>,
  );

  const toolGroups = view.getAllByTestId('tool-group');
  assert.equal(toolGroups[0]?.parentElement?.classList.contains('hidden'), true);
  assert.equal(toolGroups[1]?.parentElement?.classList.contains('hidden'), false);
});
