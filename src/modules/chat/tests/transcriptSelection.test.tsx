import assert from 'node:assert/strict';

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import TranscriptSelectionBar from '@/modules/chat/TranscriptSelectionBar';
import type { ChatMessage } from '@/shared/types';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import {
  collectSelectedMessages,
  collectTurnSelectionKeys,
  isSelectableExportRow,
  projectSelectableTurns,
} from '@/modules/chat/utils/transcriptSelection';
import { buildTailAnchoredMessageKeys } from '@/modules/chat/utils/messageKeys';
import { buildTranscriptExport } from '@/modules/chat/utils/chatExport';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const message = (overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'type' | 'content'>): ChatMessage => ({
  timestamp: '2026-10-20T10:00:00.000Z',
  ...overrides,
} as ChatMessage);

const conversation: ChatMessage[] = [
  // A window that begins mid-turn: no user row, so nothing can select it.
  message({ id: 'lead-answer', type: 'assistant', content: 'Earlier answer fragment' }),
  message({ id: 'u1', type: 'user', content: 'First question' }),
  message({ id: 'a1', type: 'assistant', content: 'First answer' }),
  message({ id: 't1', type: 'tool', content: 'tool output', isToolUse: true }),
  message({ id: 'u2', type: 'user', content: 'Second question' }),
  message({ id: 'a2', type: 'assistant', content: 'Second answer' }),
];

const keys = buildTailAnchoredMessageKeys(conversation);
const getKey = (item: ChatMessage) => keys.get(item) ?? String(item.id);

describe('the keys a selection is stored under', () => {
  test('stay the same for the visible tail when older history is prepended', () => {
    const older = message({ id: 'dup', type: 'assistant', content: 'older' });
    const visible = [
      message({ id: 'dup', type: 'assistant', content: 'one' }),
      message({ id: 'dup', type: 'assistant', content: 'two' }),
    ];

    const fullKeys = buildTailAnchoredMessageKeys([older, ...visible]);
    const tailKeys = buildTailAnchoredMessageKeys(visible);

    for (const row of visible) {
      expect(fullKeys.get(row)).toBe(tailKeys.get(row));
    }
  });
});

describe('which rows a reader can pick', () => {
  test('a question and an answer are pickable on their own', () => {
    expect(isSelectableExportRow(conversation[1]!, false)).toBe(true);
    expect(isSelectableExportRow(conversation[2]!, false)).toBe(true);
  });

  test('a tool row is not: the export folds it into the run', () => {
    expect(isSelectableExportRow(conversation[3]!, false)).toBe(false);
  });

  test('an answer absorbed into a run is not pickable on its own', () => {
    expect(isSelectableExportRow(conversation[2]!, true)).toBe(false);
  });

  test('an answer above the window\'s first question is still its own row', () => {
    expect(isSelectableExportRow(conversation[0]!, false)).toBe(true);
  });
});

describe('which turns a reader can pick', () => {
  test('starts at each user message and runs to the row before the next one', () => {
    const turns = projectSelectableTurns(conversation, getKey);

    expect(turns.map((turn) => turn.key)).toEqual(['message-user-u1', 'message-user-u2']);
    expect(turns.map((turn) => [turn.startIndex, turn.endIndex])).toEqual([[1, 3], [4, 5]]);
  });

  test('leaves the leading fragment out: it has no user row to hang a checkbox on', () => {
    const turns = projectSelectableTurns(conversation, getKey);

    assert.equal(turns.some((turn) => turn.startIndex === 0), false);
  });

  test('the turn entry picks the question with its answers, not the tool rows', () => {
    const keys = collectTurnSelectionKeys(
      conversation,
      'message-user-u1',
      getKey,
      () => false,
    );

    expect(keys).toEqual(['message-user-u1', 'message-assistant-a1']);
  });
});

describe('the rows a selection exports', () => {
  test('a picked answer travels without the question it answered', () => {
    const rows = collectSelectedMessages(conversation, new Set(['message-assistant-a1']), getKey);

    expect(rows.map((row) => row.id)).toEqual(['a1']);
  });

  test('a picked question travels without its answer', () => {
    const rows = collectSelectedMessages(conversation, new Set(['message-user-u2']), getKey);

    expect(rows.map((row) => row.id)).toEqual(['u2']);
  });

  test('keeps transcript order no matter what order the reader picked in', () => {
    const rows = collectSelectedMessages(
      conversation,
      new Set(['message-user-u2', 'message-assistant-a1', 'message-user-u1']),
      getKey,
    );

    expect(rows.map((row) => row.id)).toEqual(['u1', 'a1', 'u2']);
  });

  test('returns nothing when nothing is picked', () => {
    expect(collectSelectedMessages(conversation, new Set(), getKey)).toEqual([]);
  });

  test('exports only the picked answer, and does not call it a truncated window', async () => {
    const rows = collectSelectedMessages(conversation, new Set(['message-assistant-a2']), getKey);
    const html = await buildTranscriptExport('html', {
      messages: rows,
      sessionTitle: 'Selection',
      provider: 'claude',
      createDiff: () => [],
    }, new Date('2026-10-20T10:00:00.000Z'));

    expect(html).toContain('Second answer');
    expect(html).not.toContain('Second question');
    // A lone answer is the vanguard of its own turn, so the projector opens no
    // folded run at all — and "earlier history not loaded" never appears.
    expect(html).not.toContain(i18n.getFixedT(null, 'chat')('transcript.executionProcess.truncated'));
  });
});

const assistantMessage = conversation[2]!;

describe('picking rows from the transcript', () => {
  test('offers the entry on a user turn and asks for the whole turn', () => {
    const onSelect = vi.fn();
    render(
      <MessageComponent
        message={conversation[1]!}
        prevMessage={null}
        createDiff={() => []}
        provider="claude"
        onSelectExportRow={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select messages' }));

    expect(onSelect).toHaveBeenCalledWith(conversation[1], true);
  });

  test('shows a checked box once the row is selected', () => {
    const onSelect = vi.fn();
    render(
      <MessageComponent
        message={conversation[1]!}
        prevMessage={null}
        createDiff={() => []}
        provider="claude"
        isExportSelecting
        isExportSelected
        onSelectExportRow={onSelect}
      />,
    );

    const box = screen.getByRole('checkbox', { name: 'Select this message' });
    expect(box.getAttribute('aria-checked')).toBe('true');

    // The box is a keyboard affordance: a mouse click lands on the row instead,
    // and the row must not report the same pick twice.
    fireEvent.click(box);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(conversation[1], false);
  });

  test('a click anywhere on the row picks that row, not its turn', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MessageComponent
        message={conversation[1]!}
        prevMessage={null}
        createDiff={() => []}
        provider="claude"
        isExportSelecting
        onSelectExportRow={onSelect}
      />,
    );

    fireEvent.click(container.querySelector('.chat-message')!);

    expect(onSelect).toHaveBeenCalledWith(conversation[1], false);
  });

  test('an assistant answer carries its own mark, picked the same way', () => {
    const onSelect = vi.fn();
    render(
      <UiPreferencesProvider>
        <MessageComponent
          message={assistantMessage}
          prevMessage={null}
          createDiff={() => []}
          provider="claude"
          isExportSelecting
          isExportSelected
          onSelectExportRow={onSelect}
        />
      </UiPreferencesProvider>,
    );

    const box = screen.getByRole('checkbox', { name: 'Select this message' });
    expect(box.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(box);
    expect(onSelect).toHaveBeenCalledWith(assistantMessage, false);
  });

  test('a tool row offers no mark even while the mode is on', () => {
    render(
      <UiPreferencesProvider>
        <MessageComponent
          message={conversation[3]!}
          prevMessage={null}
          createDiff={() => []}
          provider="claude"
          isExportSelecting
          onSelectExportRow={() => {}}
        />
      </UiPreferencesProvider>,
    );

    assert.equal(screen.queryByRole('checkbox', { name: 'Select this message' }), null);
  });
});

describe('the selection bar', () => {
  test('reports the count and the chosen format', () => {
    const onExport = vi.fn();
    render(
      <TranscriptSelectionBar
        selectedCount={2}
        busyFormat={null}
        onExport={onExport}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('2 messages selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }));
    expect(onExport).toHaveBeenCalledWith('html');
  });

  test('disables both formats while one is being rendered', () => {
    render(
      <TranscriptSelectionBar
        selectedCount={1}
        busyFormat="html"
        onExport={() => {}}
        onCancel={() => {}}
      />,
    );

    const busy = screen.getByRole('button', { name: /Generating HTML/ }) as HTMLButtonElement;
    const other = screen.getByRole('button', { name: 'Export Markdown' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(other.disabled).toBe(true);
  });

  test('says a failed export wrote no file, and keeps the pick', () => {
    render(
      <TranscriptSelectionBar
        selectedCount={2}
        failed
        busyFormat={null}
        onExport={() => {}}
        onCancel={() => {}}
      />,
    );

    // Returning the buttons to their idle state is what a successful download
    // looks like; the failure has to be its own signal.
    expect(screen.getByRole('alert').textContent).toContain('no file was written');
    expect(screen.getByText('2 messages selected')).toBeTruthy();
  });
});
