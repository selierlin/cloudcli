import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage, DiffLine } from '@/shared/types';

/**
 * A question's controls used to live inside its bubble, which made edit and
 * copy read as part of what the user sent. They now sit under the bubble, in
 * the same footer an answer uses.
 */

const createDiff = (): DiffLine[] => [];

const renderUserMessage = (message: ChatMessage) => render(
  <UiPreferencesProvider>
    <MessageComponent
      message={message}
      prevMessage={null}
      createDiff={createDiff}
      provider="claude"
      onEditMessage={() => {}}
    />
  </UiPreferencesProvider>,
);

const textMessage: ChatMessage = {
  type: 'user',
  content: 'Please rename the helper',
  timestamp: '2026-08-21T10:00:00.000Z',
  transcriptAnchorId: 'user-anchor',
};

test('a question keeps its controls outside the bubble', () => {
  const { container } = renderUserMessage(textMessage);
  const bubble = container.querySelector('.rounded-2xl');
  const edit = container.querySelector('button[aria-label="message.editAndResend"]');
  const footer = edit?.parentElement;

  assert.ok(bubble, 'the question still renders a bubble');
  assert.ok(edit, 'the question still offers edit');
  assert.ok(footer, 'the controls live in their own row');
  assert.equal(bubble.contains(edit), false, 'edit must not be inside the bubble');
  assert.equal(footer.parentElement, bubble.parentElement, 'the row sits under the bubble');
  // The chat used to reveal edit on hover; a footer control is always there,
  // the way an answer's copy control is.
  assert.equal(edit.className.includes('opacity-0'), false);
  assert.equal(edit.className.includes('group-hover'), false);
  // A triple click that ran into the timestamp used to copy the question with
  // three trailing line breaks. The footer is chrome, so it stays out of text
  // selection entirely.
  assert.equal(footer.className.includes('select-none'), true);
  // Copy and the timestamp share the row with edit.
  assert.equal(
    footer.querySelectorAll('button').length,
    2,
    'copy joins edit in the footer',
  );
  assert.ok(
    footer.textContent?.includes(new Date(textMessage.timestamp).toLocaleString()),
    'the timestamp moved out of the bubble with the controls',
  );
  assert.equal(
    bubble.textContent?.includes(new Date(textMessage.timestamp).toLocaleString()),
    false,
    'the bubble no longer carries the timestamp',
  );
});

test('an attachment-only question keeps its timestamp without a bubble', () => {
  const { container } = renderUserMessage({
    type: 'user',
    content: '',
    timestamp: '2026-08-21T10:00:00.000Z',
    transcriptAnchorId: 'user-anchor',
    images: [{ data: 'data:image/png;base64,AA==', mimeType: 'image/png' }],
  });

  assert.equal(container.querySelector('.rounded-2xl'), null, 'no text means no bubble');
  assert.ok(
    container.textContent?.includes(
      new Date(textMessage.timestamp).toLocaleString(),
    ),
    'the timestamp survives with no bubble to hold it',
  );
});
