import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import QuickSettingsExportSection from '@/modules/quick-settings-panel/QuickSettingsExportSection';
import type { ChatMessage, LLMProvider } from '@/shared/types';
import { downloadTranscriptExport } from '@/modules/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { format?: string }) =>
      options?.format ? `${key}:${options.format}` : key,
  }),
}));

vi.mock('@/modules/chat', () => ({
  createCachedDiffCalculator: () => () => [],
  downloadTranscriptExport: vi.fn(),
}));

/**
 * Rendering a long transcript is one synchronous pass, so the panel must show
 * its "generating" row *before* that pass starts — otherwise the click reads as
 * dead for as long as the render takes. These tests hold the build open and
 * assert the row is already busy, and that a second click cannot start another
 * export while it is.
 */
const renderSection = () => render(
  <QuickSettingsExportSection
    messages={[{ type: 'user', content: 'hi' } as ChatMessage]}
    sessionTitle="Conversation"
    provider={'claude' as LLMProvider}
    selectedProject={null}
    isOpen
    onToggle={() => {}}
  />,
);

let finishExport: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(downloadTranscriptExport).mockImplementation(
    () => new Promise<void>((resolve) => { finishExport = resolve; }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('shows a busy row before the export starts and clears it afterwards', async () => {
  const { getByText, queryByText } = renderSection();

  fireEvent.click(getByText('Web Page (.html)'));

  // The point of the wait: the busy row is on screen while the build has not
  // started yet. Anything that set the state after the build would still look
  // fine in a `waitFor`, so this has to be a synchronous read.
  const busyLabel = queryByText('quickSettings.export.generating:Web Page (.html)');
  assert.ok(busyLabel, 'the generating copy is painted before the build starts');
  assert.equal(vi.mocked(downloadTranscriptExport).mock.calls.length, 0);

  await waitFor(() => {
    assert.equal(vi.mocked(downloadTranscriptExport).mock.calls.length, 1);
  });
  const busyButton = busyLabel.closest('button');
  assert.ok(busyButton);
  assert.equal(busyButton.disabled, true, 'the row cannot be clicked twice');
  assert.equal(busyButton.getAttribute('aria-busy'), 'true');

  // Every format is blocked, not just the one in flight.
  assert.equal(queryByText('Markdown (.md)')?.closest('button')?.disabled, true);

  finishExport();

  await waitFor(() => {
    assert.ok(queryByText('Web Page (.html)'), 'the row returns to its label');
  });
  assert.equal(queryByText('Markdown (.md)')?.closest('button')?.disabled, false);
});

test('starts one export per click', async () => {
  const { getByText } = renderSection();

  fireEvent.click(getByText('Web Page (.html)'));
  await waitFor(() => {
    assert.equal(vi.mocked(downloadTranscriptExport).mock.calls.length, 1);
  });

  // The button is disabled by now, so a second click cannot enqueue another
  // multi-second render.
  fireEvent.click(getByText('quickSettings.export.generating:Web Page (.html)'));
  assert.equal(vi.mocked(downloadTranscriptExport).mock.calls.length, 1);

  finishExport();
  await waitFor(() => {
    assert.ok(getByText('Web Page (.html)'));
  });
});

const renderWith = (messages: ChatMessage[]) => render(
  <QuickSettingsExportSection
    messages={messages}
    sessionTitle="Conversation"
    provider={'claude' as LLMProvider}
    selectedProject={null}
    isOpen
    onToggle={() => {}}
  />,
);

test('warns before a long transcript makes the click look dead', () => {
  const transcript = Array.from({ length: 400 }, (_, index) => ({
    type: 'user',
    content: `message ${index}`,
  } as ChatMessage));

  assert.ok(renderWith(transcript).queryByText('quickSettings.export.sizeHint'));
});

test('warns for a short transcript that still carries a lot of text', () => {
  const transcript = [{ type: 'user', content: 'x'.repeat(600 * 1024) } as ChatMessage];

  assert.ok(renderWith(transcript).queryByText('quickSettings.export.sizeHint'));
});

test('says so when the export throws', async () => {
  vi.mocked(downloadTranscriptExport).mockRejectedValueOnce(new Error('stylesheets blocked'));
  const { getByText, queryByText } = renderSection();

  fireEvent.click(getByText('Web Page (.html)'));

  // The row goes back to its label either way, so silence is indistinguishable
  // from a download that produced no file.
  await waitFor(() => {
    assert.ok(queryByText('transcript.selection.exportFailed'));
  });
});

test('stays quiet for a transcript that exports instantly', () => {
  const { queryByText } = renderWith([{ type: 'user', content: 'hi' } as ChatMessage]);

  assert.equal(queryByText('quickSettings.export.sizeHint'), null);
});
