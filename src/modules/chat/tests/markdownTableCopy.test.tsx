import assert from 'node:assert/strict';

import { test, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * Coverage for the markdown table copy button: it must flatten the rendered
 * table into TSV (cells joined by tabs, rows by newlines) so the clipboard
 * content pastes into spreadsheets with rows and columns intact, and inline
 * markup inside cells must reduce to plain text.
 */

const TABLE_MARKDOWN = [
  '| Name | Age |',
  '| ---- | --- |',
  '| Alice | 30 |',
  '| Bob | 25 |',
].join('\n');

const RICH_CELL_MARKDOWN = [
  '| Ref | Note |',
  '| --- | ---- |',
  '| [`src/a.ts:12`](a) | **bold** text |',
].join('\n');

const tableCopyButton = (container: HTMLElement): HTMLButtonElement => {
  const button = container.querySelector('.markdown-table-wrapper')?.previousElementSibling;
  assert.ok(button instanceof HTMLButtonElement, 'expected a copy button beside the table wrapper');
  return button;
};

test('copying a table puts TSV on the clipboard', async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  const { container } = render(<Markdown>{TABLE_MARKDOWN}</Markdown>);
  fireEvent.click(tableCopyButton(container));

  await waitFor(() => assert.equal(writeText.mock.calls.length, 1));
  assert.equal(writeText.mock.calls[0][0], 'Name\tAge\nAlice\t30\nBob\t25');
});

test('inline markup inside cells is flattened to plain text', async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  const { container } = render(<Markdown>{RICH_CELL_MARKDOWN}</Markdown>);
  fireEvent.click(tableCopyButton(container));

  await waitFor(() => assert.equal(writeText.mock.calls.length, 1));
  assert.equal(writeText.mock.calls[0][0], 'Ref\tNote\nsrc/a.ts:12\tbold text');
});
