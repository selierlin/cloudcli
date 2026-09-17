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
const completedHistory = { isProcessing: false };

describe('execution process projection', () => {
  it('projects one process run for all ordinary segments before the final answer', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const thought = message({ id: 'thinking', content: 'checking', isThinking: true });
    const firstTool = message({ id: 'tool-1', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const narration = message({ id: 'narration', content: 'Now I will run the tests.' });
    const secondTool = message({ id: 'tool-2', isToolUse: true, toolName: 'Bash', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, thought, firstTool, narration, secondTool, answer],
      keyFor,
      completedHistory,
    );

    expect(projection.groups.size).toBe(1);
    const group = projection.groups.get('process:turn:message-user-u1');
    expect(group).toMatchObject({
      memberKeys: new Set(['thinking', 'tool-1', 'narration', 'tool-2']),
      narrationKeys: new Set(['narration']),
      labelKind: 'execution',
      activityLabel: 'Now I will run the tests.',
      toolCount: 2,
      defaultCollapsed: true,
    });
    expect(projection.memberDisclosureKeys.get('narration')).toBe(group?.disclosureKey);
    expect(projection.memberDisclosureKeys.get('answer')).toBeUndefined();
  });

  it('labels reasoning-only and narration-only runs without inventing tool activity', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const thought = message({ id: 'thinking', content: 'checking', isThinking: true });
    const answer = message({ id: 'answer', content: 'final' });
    const reasoning = deriveExecutionProcessProjection(
      [user, thought, answer], keyFor, completedHistory,
    );
    expect(reasoning.groups.get('process:turn:message-user-u1')).toMatchObject({
      labelKind: 'reasoning',
      toolCount: 0,
    });

    const progress = message({ id: 'progress', content: 'Checkpoint complete.' });
    const narration = deriveExecutionProcessProjection(
      [user, progress, answer], keyFor, completedHistory,
    );
    expect(narration.groups.get('process:turn:message-user-u1')).toMatchObject({
      labelKind: 'narration',
      toolCount: 0,
    });
  });

  it('keeps a provisional tail answer visible until later activity absorbs it', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const provisionalAnswer = message({ id: 'progress', content: 'I will inspect the files.' });

    const provisional = deriveExecutionProcessProjection(
      [user, provisionalAnswer], keyFor, { isProcessing: true },
    );
    expect(provisional.groups.size).toBe(0);

    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'running' });
    const continued = deriveExecutionProcessProjection(
      [user, provisionalAnswer, tool], keyFor, { isProcessing: true },
    );
    expect(continued.groups.get('process:turn:message-user-u1')).toMatchObject({
      memberKeys: new Set(['progress', 'tool']),
      activityLabel: 'I will inspect the files.',
      isActiveRun: true,
      defaultCollapsed: true,
    });
  });

  it('marks attention members without forcing the whole process run open', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const failedTool = message({ id: 'failed', isToolUse: true, toolName: 'Bash', toolStatus: 'error' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, tool, failedTool, answer], keyFor, completedHistory,
    );
    expect(projection.groups.get('process:turn:message-user-u1')).toMatchObject({
      attentionKeys: new Set(['failed']),
      hasAttention: true,
      defaultCollapsed: true,
    });
  });

  it('uses a partial identity until pagination reveals the user anchor and retains it as an alias', () => {
    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final' });
    const partial = deriveExecutionProcessProjection([tool, answer], keyFor, completedHistory);
    expect(partial.groups.get('process:before:answer')).toMatchObject({
      isWindowTruncated: true,
      memberKeys: new Set(['tool']),
    });

    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const complete = deriveExecutionProcessProjection([user, tool, answer], keyFor, completedHistory);
    expect(complete.groups.get('process:turn:message-user-u1')).toMatchObject({
      isWindowTruncated: false,
      disclosureAliases: expect.arrayContaining(['process:before:answer']),
    });
  });

  it('does not let local command stdout or compact summaries become focus', () => {
    expect(isAssistantTextFocusCandidate(message({ content: 'stdout', isLocalCommandStdout: true }))).toBe(false);
    expect(isAssistantTextFocusCandidate(message({ content: 'summary', isCompactSummary: true }))).toBe(false);
  });

  it('does not let a local command echo split the surrounding user turn', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const narration = message({ id: 'narration', content: 'checking' });
    const commandEcho = message({ id: 'command', type: 'user', content: '/model', isLocalCommand: true });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [user, narration, commandEcho, answer], keyFor, completedHistory,
    );
    expect(projection.groups.get('process:turn:message-user-u1')?.memberKeys).toEqual(
      new Set(['narration', 'command']),
    );
  });
});
