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
  it('unifies reasoning and tool activity inside one local process stage', () => {
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

    const group = projection.groups.get('process:before:answer');
    expect(group?.memberKeys).toEqual(new Set(['thinking', 'tool']));
    expect(group).toMatchObject({ labelKind: 'execution', toolCount: 1 });
    expect(projection.memberDisclosureKeys.get('answer')).toBeUndefined();
    expect(projection.memberDisclosureKeys.get('thinking')).toBe('process:before:answer');
  });

  it('labels a reasoning-only stage as thinking without inventing tool activity', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const thought = message({ id: 'thinking', content: 'checking', isThinking: true });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, thought, answer], keyFor, completedHistory,
    );

    expect(projection.groups.get('process:before:answer')).toMatchObject({
      labelKind: 'reasoning',
      toolCount: 0,
    });
  });

  it('keeps a live deferred tail expanded but closes completed history', () => {
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
    expect(whileReading.groups.get('process:tail:tail')).toMatchObject({
      defaultCollapsed: false,
    });

    const atTail = deriveExecutionProcessProjection(
      [user, answer, tailTool], keyFor, completedHistory,
    );
    expect(atTail.groups.get('process:tail:tail')).toMatchObject({
      memberKeys: new Set(['tail']),
      defaultCollapsed: true,
    });
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
    expect(projection.groups.get('process:before:answer')?.memberKeys).toEqual(new Set(['command']));
    expect(projection.memberDisclosureKeys.get('preamble')).toBeUndefined();
  });

  it('keeps every answer visible and gives each surrounding process stage independent disclosure', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const preamble = message({ id: 'preamble', content: 'I will inspect the files.' });
    const firstTool = message({ id: 'tool-1', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const explanation = message({ id: 'explanation', content: 'The first file points to another module.' });
    const secondTool = message({ id: 'tool-2', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const conclusion = message({ id: 'conclusion', content: 'Here is the result.' });

    const projection = deriveExecutionProcessProjection(
      [user, preamble, firstTool, explanation, secondTool, conclusion],
      keyFor,
      completedHistory,
    );

    expect(projection.groups.get('process:before:explanation')?.memberKeys).toEqual(new Set(['tool-1']));
    expect(projection.groups.get('process:before:conclusion')?.memberKeys).toEqual(new Set(['tool-2']));
    expect(projection.memberDisclosureKeys.get('preamble')).toBeUndefined();
    expect(projection.memberDisclosureKeys.get('explanation')).toBeUndefined();
    expect(projection.memberDisclosureKeys.get('conclusion')).toBeUndefined();
  });

  it('keeps an attention stage present and expanded', () => {
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
    expect(projection.groups.get('process:before:answer')).toMatchObject({
      memberKeys: new Set(['failed']),
      hasAttention: true,
      defaultCollapsed: false,
    });
  });

  it('folds a completed left-truncated history window before its user anchor loads', () => {
    const thought = message({ id: 'thought', content: 'checking', isThinking: true });
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection([thought, tool, answer], keyFor, completedHistory);
    const group = projection.groups.get('process:before:answer');
    expect(group).toMatchObject({ isWindowTruncated: true, firstMemberKey: 'thought' });
    expect(group?.memberKeys).toEqual(new Set(['thought', 'tool']));
  });

  it('keeps a left-truncated active stage expanded while its boundary can still move', () => {
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'partial', isStreaming: true });

    const projection = deriveExecutionProcessProjection([tool, answer], keyFor, {
      isProcessing: true,
      isLiveCompletionPending: false,
      tailClosures: {},
    });
    expect(projection.groups.get('process:before:answer')).toMatchObject({
      isWindowTruncated: true,
      defaultCollapsed: false,
    });
  });

  it('keeps the same answer-anchored disclosure key when pagination reveals its user anchor', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection([user, tool, answer], keyFor, completedHistory);
    expect(projection.groups.get('process:before:answer')).toMatchObject({
      disclosureKey: 'process:before:answer',
      isWindowTruncated: false,
    });
  });
});
