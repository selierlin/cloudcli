import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import BtwMessageList from '@/modules/chat/btw/BtwMessageList';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine } from '@/shared/types';

/**
 * The drawer renders the same rows as the main transcript, so it also has to
 * fold the same way: a turn's reasoning and tool activity belong to the answer,
 * not beside it. Before this the drawer showed every thinking block expanded
 * and never closed it, which made a side question read as a wall of process
 * output instead of an answer.
 */

const createDiff = (): DiffLine[] => [];

const conversation: ChatMessage[] = [
  {
    type: 'user',
    content: 'Why did the build fail?',
    timestamp: '2026-10-22T10:00:00.000Z',
  },
  {
    type: 'assistant',
    content: 'THINKING_TEXT',
    isThinking: true,
    timestamp: '2026-10-22T10:00:01.000Z',
  },
  {
    type: 'assistant',
    content: 'ANSWER_TEXT',
    timestamp: '2026-10-22T10:00:02.000Z',
  },
];

const renderList = (messages: ChatMessage[] = conversation) => render(
  <UiPreferencesProvider>
    <BtwMessageList
      messages={messages}
      provider="claude"
      selectedProject={null}
      createDiff={createDiff}
      showThinking
      isProcessing={false}
      emptyState={<div>EMPTY_STATE</div>}
    />
  </UiPreferencesProvider>,
);

test('a side question folds the process run and keeps the answer', () => {
  const { container } = renderList();

  const pane = container.querySelector('.chat-messages-pane');
  assert.ok(pane, 'the drawer must carry the transcript pane class so font settings apply');
  assert.equal(
    container.querySelectorAll('button[aria-expanded="false"]').length,
    1,
    'the run should start folded',
  );
  assert.ok(
    container.textContent?.includes('ANSWER_TEXT'),
    'the answer stays visible',
  );
  assert.ok(
    !container.textContent?.includes('THINKING_TEXT'),
    'folded reasoning must not be rendered',
  );
  assert.ok(
    container.textContent?.includes('Why did the build fail?'),
    'folding must not hide the question',
  );
});

test('opening the run puts its member rows back in the transcript', () => {
  const { container } = renderList();
  const assistantRowsWhileFolded = container.querySelectorAll('.chat-message.assistant').length;

  fireEvent.click(container.querySelector('button[aria-expanded="false"]')!);

  assert.equal(
    container.querySelectorAll('button[aria-expanded="true"]').length,
    1,
    'the summary should report itself open',
  );
  assert.equal(
    container.querySelectorAll('.chat-message.assistant').length,
    assistantRowsWhileFolded + 1,
    'the reasoning row is rendered once the run opens',
  );
  assert.ok(
    !container.textContent?.includes('THINKING_TEXT'),
    // Matching the main transcript: the run opens, but a reasoning block still
    // arrives folded and the reader opens that block to read it.
    'opening the run does not also expand every reasoning block inside it',
  );
});

test('a folded run keeps the row that is waiting on the reader', () => {
  // A pending approval or a failed call is part of the run, so a plain fold
  // would hide the very row the turn is blocked on. The main transcript exempts
  // attention rows from the fold; the drawer has to make the same exception or
  // its permission card disappears behind the summary.
  const withAttention: ChatMessage[] = [
    conversation[0]!,
    conversation[1]!,
    {
      type: 'error',
      content: 'NEEDS_YOU',
      timestamp: '2026-10-22T10:00:01.500Z',
    },
    conversation[2]!,
  ];
  const { container } = renderList(withAttention);

  assert.equal(
    container.querySelectorAll('button[aria-expanded="false"]').length,
    1,
    'the run still starts folded',
  );
  assert.ok(
    container.textContent?.includes('NEEDS_YOU'),
    'an attention row stays visible inside a folded run',
  );
});

test('an empty conversation shows the drawer empty state instead of a fold', () => {
  const { container } = renderList([]);

  assert.ok(container.textContent?.includes('EMPTY_STATE'));
  assert.equal(container.querySelectorAll('button[aria-expanded]').length, 0);
});
