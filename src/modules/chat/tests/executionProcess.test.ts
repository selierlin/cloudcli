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

describe('execution process projection', () => {
  it('keeps the latest assistant text visible and projects prior activity into its turn', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const thought = message({ id: 'thinking', content: 'checking', isThinking: true });
    const tool = message({ id: 'tool', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final', isStreaming: true });

    const projection = deriveExecutionProcessProjection(
      [user, thought, tool, answer], keyFor, true, () => true,
    );

    const group = projection.groups.get('message-user-u1');
    expect(group?.memberKeys).toEqual(new Set(['thinking', 'tool']));
    expect(projection.memberTurnKeys.get('answer')).toBeUndefined();
  });

  it('only closes trailing activity after completion when the caller allows it', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const answer = message({ id: 'answer', content: 'final' });
    const tailTool = message({ id: 'tail', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });

    const whileReading = deriveExecutionProcessProjection(
      [user, answer, tailTool], keyFor, false, () => false,
    );
    expect(whileReading.groups.size).toBe(0);

    const atTail = deriveExecutionProcessProjection(
      [user, answer, tailTool], keyFor, false, () => true,
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
      [user, preamble, commandEcho, answer], keyFor, true, () => true,
    );
    expect(projection.groups.get('message-user-u1')?.memberKeys).toEqual(new Set(['preamble', 'command']));
  });

  it('keeps attention rows outside the collapsed process', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const failedTool = message({ id: 'failed', type: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'error' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, failedTool, answer], keyFor, true, () => true,
    );
    expect(projection.groups.size).toBe(0);
  });
});
