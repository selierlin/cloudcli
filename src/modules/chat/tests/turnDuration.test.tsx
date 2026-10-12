import assert from 'node:assert/strict';

import React from 'react';
import { render, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it, test } from 'vitest';

import { i18n } from '@/modules/i18n';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { createStreamingBufferRegistry } from '@/modules/chat/utils/streamingBufferRegistry';
import { createRevealPacer } from '@/modules/chat/utils/revealPacer';
import {
  clearTurnDurations,
  endTurn,
  getTurnDuration,
  markTurnStart,
} from '@/modules/chat/utils/turnDurationRegistry';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, NormalizedMessage, ProjectSession, ServerEvent } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

// The footer text is translated and this fork runs the app in zh-CN by default,
// so pin the assertions to the English source they read.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('the turn duration registry', () => {
  it('reports the elapsed time between the recorded start and the run end', () => {
    markTurnStart('registry-session-a', 1_000);
    endTurn('registry-session-a', 'seg-a', 13_500);
    expect(getTurnDuration('registry-session-a', 'seg-a')).toBe(12_500);
  });

  it('reports nothing for a turn this client never dispatched', () => {
    // No start was recorded (a turn another client ran): the end alone is not a
    // duration, and inventing one would put a number on a reply we did not time.
    endTurn('registry-session-b', 'seg-b', 5_000);
    expect(getTurnDuration('registry-session-b', 'seg-b')).toBeUndefined();
  });

  it('refuses a negative elapsed time rather than reporting it', () => {
    markTurnStart('registry-session-c', 5_000);
    endTurn('registry-session-c', 'seg-c', 4_000);
    expect(getTurnDuration('registry-session-c', 'seg-c')).toBeUndefined();
  });

  it('consumes the start so a stale one cannot time a later turn', () => {
    markTurnStart('registry-session-d', 1_000);
    endTurn('registry-session-d', 'seg-d1', 2_000);
    endTurn('registry-session-d', 'seg-d2', 9_000);
    expect(getTurnDuration('registry-session-d', 'seg-d1')).toBe(1_000);
    expect(getTurnDuration('registry-session-d', 'seg-d2')).toBeUndefined();
  });

  it('consumes the start even when the turn has no answer segment to time', () => {
    // An abort (and a run that produced no text of its own) closes the turn
    // with a null segment; the start must still go, or it would time whatever
    // turn came next.
    markTurnStart('registry-session-f', 1_000);
    endTurn('registry-session-f', null, 2_000);
    endTurn('registry-session-f', 'seg-later', 9_000);
    expect(getTurnDuration('registry-session-f', 'seg-later')).toBeUndefined();
  });

  it('drops a session\'s measurements and its unconsumed start on clear', () => {
    markTurnStart('registry-session-e', 1_000);
    endTurn('registry-session-e', 'seg-e', 2_000);
    markTurnStart('registry-session-e', 3_000);

    clearTurnDurations('registry-session-e');

    expect(getTurnDuration('registry-session-e', 'seg-e')).toBeUndefined();
    // The pending start went with it: closing a later turn records nothing.
    endTurn('registry-session-e', 'seg-e2', 4_000);
    expect(getTurnDuration('registry-session-e', 'seg-e2')).toBeUndefined();
    // Another session is untouched.
    markTurnStart('registry-session-e-other', 1_000);
    endTurn('registry-session-e-other', 'seg-x', 2_000);
    expect(getTurnDuration('registry-session-e-other', 'seg-x')).toBe(1_000);
  });

  it('sheds the oldest measurements once the retained set is full', () => {
    // Mirrors MAX_RETAINED_DURATIONS: the registry is a cache of what this JS
    // context timed, so it must not grow with every turn forever.
    const sessionId = 'registry-session-cap';
    for (let i = 0; i <= 1_000; i += 1) {
      markTurnStart(sessionId, 0);
      endTurn(sessionId, `seg-${i}`, 1);
    }
    expect(getTurnDuration(sessionId, 'seg-1000')).toBe(1);
    expect(getTurnDuration(sessionId, 'seg-0')).toBeUndefined();
  });
});

const userRow = (id: string, sessionId: string): NormalizedMessage => ({
  id,
  sessionId,
  timestamp: '2026-08-21T10:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'user',
  content: 'Do the thing',
});

const answerRow = (segmentId: string, sessionId: string): NormalizedMessage => ({
  id: `${segmentId}-row`,
  segmentId,
  sessionId,
  timestamp: '2026-08-21T10:00:01.000Z',
  provider: 'claude',
  kind: 'text',
  role: 'assistant',
  content: 'Done.',
});

const renderHandlers = (sessionId: string) => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const stored: NormalizedMessage[] = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: sessionId } as ProjectSession,
    currentSessionId: sessionId,
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamBuffers: createStreamingBufferRegistry(() => {}),
    revealPacer: createRevealPacer(() => {}),
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionIdle: () => {},
    onSessionBackground: () => {},
    getSessionActivity: () => undefined,
    requestLatestMessages: async () => {},
    sessionStore: {
      appendRealtime: () => {},
      getMessages: () => stored,
      updateStreaming: () => {},
      finalizeStreaming: () => {},
    } as unknown as SessionStore,
  }));

  return {
    dispatch: (event: ServerEvent) => listener?.(event),
    stored,
  };
};

const event = (sessionId: string, fields: Record<string, unknown>): ServerEvent => ({
  id: `event-${Math.random()}`,
  sessionId,
  provider: 'claude',
  timestamp: '2026-08-21T10:00:02.000Z',
  ...fields,
} as unknown as ServerEvent);

describe('recording a turn duration at the run terminal', () => {
  test('a completed run times the turn against its final answer segment', () => {
    const sessionId = 'duration-session-1';
    const { dispatch, stored } = renderHandlers(sessionId);
    markTurnStart(sessionId, Date.now() - 12_000);
    stored.push(userRow('u1', sessionId), answerRow('seg-mid', sessionId), answerRow('seg-final', sessionId));

    dispatch(event(sessionId, { kind: 'complete', success: true }));

    const duration = getTurnDuration(sessionId, 'seg-final');
    assert.equal(typeof duration, 'number');
    assert.ok((duration ?? -1) >= 12_000, 'the elapsed wall clock is reported');
    // The intermediate answer block of the same turn carries nothing.
    assert.equal(getTurnDuration(sessionId, 'seg-mid'), undefined);
  });

  test('an aborted run records no duration and consumes the turn start', () => {
    const sessionId = 'duration-session-2';
    const { dispatch, stored } = renderHandlers(sessionId);
    markTurnStart(sessionId, Date.now() - 5_000);
    stored.push(userRow('u1', sessionId), answerRow('seg-x', sessionId));

    dispatch(event(sessionId, { kind: 'complete', aborted: true }));

    assert.equal(getTurnDuration(sessionId, 'seg-x'), undefined);

    // The aborted turn's start was consumed, so the next terminal cannot time
    // itself against it.
    stored.push(userRow('u2', sessionId), answerRow('seg-y', sessionId));
    dispatch(event(sessionId, { kind: 'complete', success: true }));
    assert.equal(getTurnDuration(sessionId, 'seg-y'), undefined);
  });

  test('a run that produced no answer of its own borrows no earlier turn\'s time', () => {
    const sessionId = 'duration-session-3';
    const { dispatch, stored } = renderHandlers(sessionId);
    // Previous turn, already answered.
    stored.push(userRow('u1', sessionId), answerRow('seg-old', sessionId));
    // Current turn: prompt sent, but the run ended without any answer text.
    markTurnStart(sessionId, Date.now() - 3_000);
    stored.push(userRow('u2', sessionId));

    dispatch(event(sessionId, { kind: 'complete', success: true }));

    assert.equal(getTurnDuration(sessionId, 'seg-old'), undefined);

    // That answerless terminal still consumed the start.
    stored.push(answerRow('seg-new', sessionId));
    dispatch(event(sessionId, { kind: 'complete', success: true }));
    assert.equal(getTurnDuration(sessionId, 'seg-new'), undefined);
  });

  test('a rejected send consumes the start because its run never reports a terminal', () => {
    const sessionId = 'duration-session-4';
    const { dispatch, stored } = renderHandlers(sessionId);
    markTurnStart(sessionId, Date.now() - 4_000);
    stored.push(userRow('u1', sessionId));

    dispatch(event(sessionId, { kind: 'protocol_error', code: 'SEND_REJECTED', error: 'nope' }));

    stored.push(answerRow('seg-after', sessionId));
    dispatch(event(sessionId, { kind: 'complete', success: true }));
    assert.equal(getTurnDuration(sessionId, 'seg-after'), undefined);
  });

  test('a refused stop leaves the live run\'s start alone', () => {
    const sessionId = 'duration-session-5';
    const { dispatch, stored } = renderHandlers(sessionId);
    markTurnStart(sessionId, Date.now() - 6_000);
    stored.push(userRow('u1', sessionId), answerRow('seg-live', sessionId));

    // The stop request was refused because the task had already settled; the
    // run is still alive and will report its own `complete`.
    dispatch(event(sessionId, { kind: 'protocol_error', code: 'NO_SUCH_TASK', error: 'no task' }));

    dispatch(event(sessionId, { kind: 'complete', success: true }));
    const duration = getTurnDuration(sessionId, 'seg-live');
    assert.equal(typeof duration, 'number', 'the live run still reports its elapsed time');
    assert.ok((duration ?? -1) >= 6_000);
  });
});

const renderMessage = (message: ChatMessage, turnDurationMs?: number) =>
  render(
    <UiPreferencesProvider>
      <MessageComponent
        message={message}
        prevMessage={null}
        createDiff={() => []}
        provider="claude"
        turnDurationMs={turnDurationMs}
      />
    </UiPreferencesProvider>,
  );

const assistantMessage = (): ChatMessage => ({
  type: 'assistant',
  content: 'Here is the plan.',
  timestamp: '2026-08-19T12:00:00.000Z',
});

describe('the turn duration in the message footer', () => {
  it('shows the elapsed time as the last footer entry', () => {
    const { container } = renderMessage(assistantMessage(), 12_345);
    const label = container.querySelector('[title="Took 12s"]');
    assert.ok(label, 'a measured reply must report its elapsed time');
    assert.equal(label?.textContent, '12s');
    // It is the tail entry, so its absence after a reload shifts nothing.
    assert.equal(label?.parentElement?.lastElementChild, label);
  });

  it('formats a minute or more the way a task duration already reads', () => {
    const { container } = renderMessage(assistantMessage(), 65_000);
    assert.ok(container.querySelector('[title="Took 1m 5s"]'));
  });

  it('shows nothing when the client measured no duration', () => {
    const { container } = renderMessage(assistantMessage());
    assert.equal(container.querySelector('[title^="Took"]'), null);
  });
});
