import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@/shared/types';
import { projectTranscriptTurns } from '@/modules/chat/utils/transcriptProjection';

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'message',
  type: 'assistant',
  content: '',
  timestamp: '2026-09-16T10:00:00.000Z',
  ...overrides,
});

describe('transcript turn projection', () => {
  it('projects an ordered multi-answer turn without hiding provider differences', () => {
    const user = message({ id: 'u1', type: 'user', content: 'Inspect this project' });
    const preamble = message({ id: 'answer-1', content: 'I will inspect the files.' });
    const reasoning = message({ id: 'reasoning-1', content: 'Finding the entry point', isThinking: true });
    const tool = message({
      id: 'tool-1',
      content: '',
      isToolUse: true,
      toolName: 'Read',
      toolStatus: 'completed',
    });
    const conclusion = message({ id: 'answer-2', content: 'The entry point is main.ts.' });

    const projection = projectTranscriptTurns(
      [user, preamble, reasoning, tool, conclusion],
      (entry) => String(entry.id),
    );

    expect(projection.turns).toHaveLength(1);
    expect(projection.turns[0]).toMatchObject({
      id: 'turn:u1',
      boundary: 'synthetic',
      userMessage: user,
    });
    expect(projection.turns[0]?.segments.map((segment) => ({
      id: segment.id,
      kind: segment.kind,
      lifecycle: segment.lifecycle,
    }))).toEqual([
      { id: 'answer-1', kind: 'answer', lifecycle: 'complete' },
      { id: 'reasoning-1', kind: 'reasoning', lifecycle: 'complete' },
      { id: 'tool-1', kind: 'tool', lifecycle: 'complete' },
      { id: 'answer-2', kind: 'answer', lifecycle: 'complete' },
    ]);
  });

  it('makes active and attention lifecycle explicit for folding decisions', () => {
    const user = message({ id: 'u1', type: 'user', content: 'Run the checks' });
    const running = message({
      id: 'running',
      isToolUse: true,
      toolName: 'Bash',
      toolStatus: 'running',
    });
    const failed = message({
      id: 'failed',
      isToolUse: true,
      toolName: 'Read',
      toolStatus: 'error',
    });
    const waiting = message({
      id: 'waiting',
      isToolUse: true,
      toolName: 'AskUserQuestion',
      toolStatus: 'completed',
    });
    const error = message({ id: 'error', type: 'error', content: 'Provider failed' });

    const [turn] = projectTranscriptTurns(
      [user, running, failed, waiting, error],
      (entry) => String(entry.id),
    ).turns;

    expect(turn).toMatchObject({
      hasActiveSegments: true,
      hasAttention: true,
    });
    expect(turn?.segments.map((segment) => [segment.id, segment.lifecycle])).toEqual([
      ['running', 'active'],
      ['failed', 'attention'],
      ['waiting', 'attention'],
      ['error', 'attention'],
    ]);
  });

  it('anchors a left-truncated turn to its visible answer until the user boundary loads', () => {
    const reasoning = message({ id: 'reasoning-1', content: 'Checking', isThinking: true });
    const tool = message({ id: 'tool-1', isToolUse: true, toolName: 'Read', toolStatus: 'completed' });
    const answer = message({ id: 'answer-1', content: 'First result' });
    const nextUser = message({ id: 'u2', type: 'user', content: 'Continue' });
    const nextAnswer = message({ id: 'answer-2', content: 'Second result' });

    const projection = projectTranscriptTurns(
      [reasoning, tool, answer, nextUser, nextAnswer],
      (entry) => String(entry.id),
    );

    expect(projection.turns.map((turn) => ({
      id: turn.id,
      boundary: turn.boundary,
      hasActiveSegments: turn.hasActiveSegments,
      hasAttention: turn.hasAttention,
      segmentIds: turn.segments.map((segment) => segment.id),
    }))).toEqual([
      {
        id: 'partial:answer-1',
        boundary: 'partial',
        hasActiveSegments: false,
        hasAttention: false,
        segmentIds: ['reasoning-1', 'tool-1', 'answer-1'],
      },
      {
        id: 'turn:u2',
        boundary: 'synthetic',
        hasActiveSegments: false,
        hasAttention: false,
        segmentIds: ['answer-2'],
      },
    ]);
  });
});
