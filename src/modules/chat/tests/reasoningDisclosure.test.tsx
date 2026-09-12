import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deriveReasoningPresentations } from '@/modules/chat/utils/reasoningDisclosure';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/modules/chat/transcript/Reasoning';
import type { ChatMessage, ReasoningDisclosureState } from '@/shared/types';

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  type: 'assistant',
  content: '',
  timestamp: '2026-09-13T10:00:00.000Z',
  ...overrides,
});

const thinking = (content = 'thinking', isStreaming = false): ChatMessage => message({
  content,
  isThinking: true,
  isStreaming,
});

type HarnessProps = {
  handoffSequence?: number;
  finalAnswerStarted?: boolean;
  isAutoCollapseCandidate?: boolean;
  isSupersededThinking?: boolean;
  toolActivityStarted?: boolean;
  suppressAutoCollapse?: boolean;
  visibleStartedAtMs?: number;
};

function Harness({ visibleStartedAtMs, ...props }: HarnessProps) {
  // Simulates the pane registry so component tests exercise atomic ownership updates.
  const [disclosure, setDisclosure] = useState<ReasoningDisclosureState>({
    ownership: 'auto',
    autoCollapsed: false,
    hasEverStreamed: true,
    visibleStartedAtMs,
  });
  return (
    <Reasoning
      {...props}
      disclosureState={disclosure}
      onUserOpenChange={(open) => setDisclosure((current) => ({
        ...current,
        ownership: open ? 'user_open' : 'user_closed',
      }))}
      onProgramOpen={() => setDisclosure((current) => current.ownership === 'auto'
        ? { ...current, autoCollapsed: false }
        : current)}
      onProgramCollapse={() => setDisclosure((current) => current.ownership === 'auto'
        ? { ...current, autoCollapsed: true }
        : current)}
    >
      <ReasoningTrigger />
      <ReasoningContent>details</ReasoningContent>
    </Reasoning>
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reasoning presentation derivation', () => {
  it('distinguishes final prose, preambles, task results, and visible tool handoff', () => {
    const thought = thinking();
    const final = message({ content: 'answer', isStreaming: true });
    expect(deriveReasoningPresentations([thought, final], 's1', true).get(thought)?.finalAnswerStarted).toBe(true);

    const preamble = message({ content: 'I will inspect this.' });
    const tool = message({ type: 'tool', isToolUse: true, toolName: 'Read' });
    const preambleState = deriveReasoningPresentations([thought, preamble, tool], 's1', true).get(thought);
    expect(preambleState?.finalAnswerStarted).toBe(false);
    expect(preambleState?.toolActivityStarted).toBe(true);

    const taskResult = message({ content: 'background result', isTaskNotificationResult: true });
    expect(deriveReasoningPresentations([thought, taskResult], 's1', false).get(thought)?.finalAnswerStarted).toBe(false);
  });

  it('supersedes older thinking blocks one at a time and only targets the latest for prose', () => {
    const first = thinking('one');
    const second = message({ ...thinking('two'), timestamp: '2026-09-13T10:00:01.000Z' });
    const third = message({ ...thinking('three'), timestamp: '2026-09-13T10:00:02.000Z' });
    const final = message({ content: 'answer', isStreaming: true, timestamp: '2026-09-13T10:00:03.000Z' });
    const states = deriveReasoningPresentations([first, second, third, final], 's1', true);

    expect(states.get(first)?.isSupersededThinking).toBe(true);
    expect(states.get(second)?.isSupersededThinking).toBe(true);
    expect(states.get(third)?.isAutoCollapseCandidate).toBe(true);
    expect(states.get(first)?.isAutoCollapseCandidate).toBe(false);
  });

  it('keeps the disclosure key stable while content grows and streaming settles', () => {
    const live = thinking('partial', true);
    const settled = { ...live, content: 'partial and complete', isStreaming: false };
    const liveKey = deriveReasoningPresentations([live], 's1', true).get(live)?.disclosureKey;
    const settledKey = deriveReasoningPresentations([settled], 's1', false).get(settled)?.disclosureKey;
    expect(settledKey).toBe(liveKey);
  });
});

describe('Reasoning disclosure behavior', () => {
  it('waits 2500ms after final prose before collapsing', () => {
    vi.useFakeTimers();
    render(<Harness finalAnswerStarted isAutoCollapseCandidate />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');

    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('does not collapse while hovered and gives a fresh window after leaving', () => {
    vi.useFakeTimers();
    const { container } = render(<Harness finalAnswerStarted isAutoCollapseCandidate />);
    const root = container.querySelector('[data-state="open"]') as HTMLElement;
    fireEvent.pointerEnter(root);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');

    fireEvent.pointerLeave(root);
    act(() => vi.advanceTimersByTime(2499));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('gives a desktop activity handoff a 350ms stability window', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness toolActivityStarted />);
    act(() => vi.advanceTimersByTime(349));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    rerender(<Harness toolActivityStarted finalAnswerStarted isAutoCollapseCandidate />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('guarantees a 900ms minimum desktop lifetime before an activity handoff', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:00.200Z'));
    render(<Harness toolActivityStarted visibleStartedAtMs={Date.parse('2026-09-13T10:00:00.000Z')} />);

    act(() => vi.advanceTimersByTime(699));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('restarts a pending handoff when a newer segment arrives', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Harness toolActivityStarted handoffSequence={1} />);
    act(() => vi.advanceTimersByTime(300));
    rerender(<Harness toolActivityStarted handoffSequence={2} />);

    act(() => vi.advanceTimersByTime(349));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('uses the slower touch handoff profile', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    vi.useFakeTimers();
    render(<Harness isSupersededThinking />);

    act(() => vi.advanceTimersByTime(449));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('never overrides a user-owned disclosure', () => {
    vi.useFakeTimers();
    render(<Harness finalAnswerStarted isAutoCollapseCandidate />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });
});
