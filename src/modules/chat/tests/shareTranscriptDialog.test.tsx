import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import ShareTranscriptDialog from '@/modules/chat/ShareTranscriptDialog';
import { api } from '@/shared/api';
import type { ChatMessage } from '@/shared/types';

const { publishMock, buildMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  buildMock: vi.fn(async (..._args: unknown[]) => '<!DOCTYPE html><html><body><p>snapshot</p></body></html>'),
}));

vi.mock('@/modules/chat/utils/chatExport', () => ({
  buildTranscriptExport: buildMock,
  publishTranscriptHtml: publishMock,
}));

const messages = [
  { id: 'u1', type: 'user', content: 'Question', timestamp: '2026-10-20T10:00:00.000Z' },
] as ChatMessage[];

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  publishMock.mockReset();
  publishMock.mockResolvedValue({
    shareId: 'share-1',
    url: 'https://cloud.example.com/s/token',
    expiresAt: '2026-10-27T10:00:00.000Z',
  });
  buildMock.mockClear();
});

// Two things this dialog owes the quick settings panel it can be opened from:
// it has to sit above the panel (`z-[9999]`), and the snapshot it publishes has
// to be the script-free kind — the public page forbids scripts, so shipping a
// theme toggle would only produce a dead control.
test('opens above the quick settings panel and builds a script-free snapshot', async () => {
  render(
    <ShareTranscriptDialog
      onClose={() => {}}
      messages={messages}
      sessionTitle="A conversation"
      provider="claude"
    />,
  );

  const layer = document.querySelector('[data-dialog-layer]');
  assert.ok(layer, 'the dialog portals into a marked layer');
  expect(layer.className).toContain('z-[10000]');

  await waitFor(() => assert.equal(buildMock.mock.calls.length, 1));
  const input = buildMock.mock.calls[0][1] as unknown as { interactive?: boolean };
  assert.equal(input.interactive, false);
});

test('publishes nothing until the reader confirms, then shows the link', async () => {
  const { unmount } = render(
    <ShareTranscriptDialog
      onClose={() => {}}
      messages={messages}
      sessionTitle="A conversation"
      provider="claude"
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Create link' }));
  assert.equal(publishMock.mock.calls.length, 1);
  assert.match((publishMock.mock.calls[0][1] as { title: string }).title, /A conversation/);

  const input = await screen.findByDisplayValue('https://cloud.example.com/s/token') as HTMLInputElement;
  assert.equal(input.readOnly, true);
  expect(screen.getByText(/Expires/)).toBeTruthy();
  unmount();
});

test('leaves the picking mode once the link exists', async () => {
  const onShared = vi.fn();

  render(
    <ShareTranscriptDialog
      onClose={() => {}}
      onShared={onShared}
      messages={messages}
      sessionTitle="A conversation"
      provider="claude"
    />,
  );

  // Nothing is published until the reader confirms, so the mode must survive
  // the dialog simply being open.
  assert.equal(onShared.mock.calls.length, 0);

  fireEvent.click(await screen.findByRole('button', { name: 'Create link' }));
  await screen.findByDisplayValue('https://cloud.example.com/s/token');

  assert.equal(onShared.mock.calls.length, 1);
});

test('revoking the link reports that holders can no longer open it', async () => {
  const revoke = vi.spyOn(api.shares, 'revoke').mockResolvedValue(new Response(null, { status: 204 }));

  render(
    <ShareTranscriptDialog
      onClose={() => {}}
      messages={messages}
      sessionTitle="A conversation"
      provider="claude"
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Create link' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke link' }));

  await waitFor(() => expect(revoke).toHaveBeenCalledWith('share-1'));
  expect(await screen.findByText(/The link was revoked/)).toBeTruthy();
  revoke.mockRestore();
});

test('a failed upload keeps the dialog open and offers a retry', async () => {
  const onShared = vi.fn();
  publishMock.mockRejectedValueOnce(new Error('network down'));

  render(
    <ShareTranscriptDialog
      onClose={() => {}}
      onShared={onShared}
      messages={messages}
      sessionTitle="A conversation"
      provider="claude"
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Create link' }));
  expect(await screen.findByText('Sharing failed. Please try again.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  // Nothing was published, so the picks are still the reader's to retry with.
  assert.equal(onShared.mock.calls.length, 0);
});
