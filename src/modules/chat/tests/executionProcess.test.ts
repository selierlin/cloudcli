import { describe, expect, it } from 'vitest';

import {
  deriveExecutionProcessProjection,
  isAssistantTextFocusCandidate,
} from '@/modules/chat/utils/executionProcess';
import type { ChatMessage } from '@/shared/types';

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: '2026-09-15T10:00:00.000Z',
  ...overrides,
});

const keyFor = (entry: ChatMessage) => String(entry.id);
const completedHistory = {
  isProcessing: false,
  isLiveCompletionPending: false,
  tailClosures: {},
};

describe('execution process projection', () => {
  it('keeps the latest assistant text visible and projects prior activity into its turn', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const thought = message({ id: 'thinking', content: 'checking', isThinking: true });
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final', isStreaming: true });

    const projection = deriveExecutionProcessProjection(
      [user, thought, tool, answer], keyFor, {
        isProcessing: true,
        isLiveCompletionPending: false,
        tailClosures: {},
      },
    );

    const group = projection.groups.get('message-user-u1');
    expect(group?.memberKeys).toEqual(new Set(['thinking', 'tool']));
    expect(projection.memberDisclosureKeys.get('answer')).toBeUndefined();
  });

  it('keeps a live deferred tail visible but closes completed history', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const answer = message({ id: 'answer', content: 'final' });
    const tailTool = message({ id: 'tail', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });

    const whileReading = deriveExecutionProcessProjection(
      [user, answer, tailTool], keyFor, {
        isProcessing: false,
        isLiveCompletionPending: false,
        tailClosures: { 'message-user-u1': 'deferred_live' },
      },
    );
    expect(whileReading.groups.size).toBe(0);

    const atTail = deriveExecutionProcessProjection(
      [user, answer, tailTool], keyFor, completedHistory,
    );
    expect(atTail.groups.get('message-user-u1')?.memberKeys).toEqual(new Set(['tail']));
  });

  it('does not let local command stdout or compact summaries become focus', () => {
    expect(isAssistantTextFocusCandidate(message({ content: 'stdout', isLocalCommandStdout: true }))).toBe(false);
    expect(isAssistantTextFocusCandidate(message({ content: 'summary', isCompactSummary: true }))).toBe(false);
  });

  it('does not let a local command echo split the surrounding user turn', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const preamble = message({ id: 'preamble', content: 'checking' });
    const commandEcho = message({ id: 'command', type: 'user', content: '/model', isLocalCommand: true });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, preamble, commandEcho, answer], keyFor, {
        isProcessing: true,
        isLiveCompletionPending: false,
        tailClosures: {},
      },
    );
    expect(projection.groups.get('message-user-u1')?.memberKeys).toEqual(new Set(['preamble', 'command']));
  });

  it('keeps attention rows outside the collapsed process', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const failedTool = message({ id: 'failed', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'error' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, failedTool, answer], keyFor, {
        isProcessing: true,
        isLiveCompletionPending: false,
        tailClosures: {},
      },
    );
    expect(projection.groups.size).toBe(0);
  });

  it('folds a completed left-truncated history window before its user anchor loads', () => {
    const thought = message({ id: 'thought', content: 'checking', isThinking: true });
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection([thought, tool, answer], keyFor, completedHistory);
    const group = projection.groups.get('truncated:answer');
    expect(group).toMatchObject({ isWindowTruncated: true, firstMemberKey: 'thought' });
    expect(group?.memberKeys).toEqual(new Set(['thought', 'tool']));
  });

  it('does not fold a left-truncated active turn whose focus can still move', () => {
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'partial', isStreaming: true });

    const projection = deriveExecutionProcessProjection([tool, answer], keyFor, {
      isProcessing: true,
      isLiveCompletionPending: false,
      tailClosures: {},
    });
    expect(projection.groups.size).toBe(0);
  });

  it('keeps a truncated disclosure alias when pagination reveals its user anchor', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const thought = message({ id: 'thought', content: 'checking', isThinking: true });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection([user, thought, answer], keyFor, completedHistory);
    expect(projection.groups.get('message-user-u1')?.disclosureAliases).toContain('truncated:answer');
  });
});
