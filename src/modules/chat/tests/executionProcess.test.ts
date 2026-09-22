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
      // Settled runs carry no live activity; the label comes from labelKind.
      activityLabel: undefined,
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

  it('keeps a provisional tail answer visible until a newer answer absorbs it', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const provisionalAnswer = message({ id: 'progress', content: 'I will inspect the files.' });

    const provisional = deriveExecutionProcessProjection(
      [user, provisionalAnswer], keyFor, { isProcessing: true },
    );
    expect(provisional.groups.size).toBe(0);

    // Tool activity after the prose does NOT absorb it: the reader keeps
    // seeing what the assistant just said while the tools run.
    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'running' });
    const duringTools = deriveExecutionProcessProjection(
      [user, provisionalAnswer, tool], keyFor, { isProcessing: true },
    );
    const duringGroup = duringTools.groups.get('process:turn:message-user-u1');
    expect(duringGroup).toMatchObject({
      memberKeys: new Set(['tool']),
      narrationKeys: new Set(),
      isActiveRun: true,
      defaultCollapsed: true,
    });
    expect(duringTools.memberDisclosureKeys.get('progress')).toBeUndefined();

    // A newer answer supersedes the prose: only then does it absorb into the
    // run as narration, and the newer answer stays visible in its place.
    const nextAnswer = message({ id: 'answer', content: 'The first file looks fine.' });
    const superseded = deriveExecutionProcessProjection(
      [user, provisionalAnswer, tool, nextAnswer], keyFor, { isProcessing: true },
    );
    expect(superseded.groups.get('process:turn:message-user-u1')).toMatchObject({
      memberKeys: new Set(['progress', 'tool']),
      narrationKeys: new Set(['progress']),
    });
    expect(superseded.memberDisclosureKeys.get('answer')).toBeUndefined();
  });

  it('keeps the last narration visible for a settled turn that ends on tool activity', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const narration = message({ id: 'narration', content: 'Running the tests now.' });
    const failedTool = message({ id: 'failed', isToolUse: true, toolName: 'Bash', toolStatus: 'error' });

    const projection = deriveExecutionProcessProjection(
      [user, narration, failedTool], keyFor, completedHistory,
    );
    expect(projection.groups.get('process:turn:message-user-u1')).toMatchObject({
      memberKeys: new Set(['failed']),
      narrationKeys: new Set(),
      attentionKeys: new Set(['failed']),
    });
    expect(projection.memberDisclosureKeys.get('narration')).toBeUndefined();
  });

  it('labels a live run with the reasoning tail that is still streaming', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const narration = message({ id: 'narration', content: 'I will inspect the files.' });
    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const streamingThought = message({
      id: 'thinking', content: 'weighing the options', isThinking: true, isStreaming: true,
    });

    const projection = deriveExecutionProcessProjection(
      [user, narration, tool, streamingThought], keyFor, { isProcessing: true },
    );
    expect(projection.groups.get('process:turn:message-user-u1')).toMatchObject({
      activityLabel: 'weighing the options',
      isActiveRun: true,
    });
    // The narration stays visible beside the run; only the streaming thought
    // feeds the live label.
    expect(projection.memberDisclosureKeys.get('narration')).toBeUndefined();
  });

  it('does not repeat the visible narration in the live label', () => {
    const user = message({ id: 'u1', type: 'user', content: 'question' });
    const settledThought = message({ id: 'thinking', content: 'settled thought', isThinking: true });
    const narration = message({ id: 'narration', content: 'Now I will run the tests.' });
    const runningTool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'running' });

    const projection = deriveExecutionProcessProjection(
      [user, settledThought, narration, runningTool], keyFor, { isProcessing: true },
    );
    expect(projection.groups.get('process:turn:message-user-u1')?.activityLabel)
      .toBeUndefined();
    expect(projection.memberDisclosureKeys.get('narration')).toBeUndefined();
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

  it('retains the partial identity of an absorbed vanguard as an alias', () => {
    const narration = message({ id: 'narration', content: 'I will inspect the files.' });
    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'running' });

    const duringTools = deriveExecutionProcessProjection(
      [narration, tool], keyFor, { isProcessing: true },
    );
    expect(duringTools.groups.get('process:before:narration')).toMatchObject({
      memberKeys: new Set(['tool']),
    });

    // Once a newer answer supersedes the narration, the run re-keys to the
    // new vanguard; the previous key must survive as an alias so an
    // interaction (e.g. user_open) made during the tools is not lost.
    const nextAnswer = message({ id: 'answer', content: 'The first file looks fine.' });
    const superseded = deriveExecutionProcessProjection(
      [narration, tool, nextAnswer], keyFor, { isProcessing: true },
    );
    const group = superseded.groups.get('process:before:answer');
    expect(group).toMatchObject({ memberKeys: new Set(['narration', 'tool']) });
    expect(group?.disclosureAliases).toEqual(expect.arrayContaining(['process:before:narration']));
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

  it('promotes a leading local command to the visible turn anchor instead of folding it away', () => {
    const command = message({ id: 'command', type: 'user', content: '/model', isLocalCommand: true });
    const thought = message({ id: 'thinking', content: 'checking', isThinking: true });
    const tool = message({ id: 'tool', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer', content: 'final' });

    const projection = deriveExecutionProcessProjection(
      [command, thought, tool, answer], keyFor, completedHistory,
    );
    const group = projection.groups.get('process:turn:message-user-command');
    expect(group).toBeDefined();
    // The command is the turn anchor (rendered as the user's own bubble), the
    // tool work folds into the collapsed run beneath it — the command must NOT
    // hide alongside the process members.
    expect(group?.memberKeys).toEqual(new Set(['thinking', 'tool']));
    expect(projection.memberDisclosureKeys.get('command')).toBeUndefined();
  });
});
