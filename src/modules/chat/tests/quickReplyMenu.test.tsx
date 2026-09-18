import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import QuickReplyMenu from '@/modules/chat/composer/QuickReplyMenu';
import { writeQuickReplies } from '@/shared/quickReplies';
import { resetUserPreferences } from '@/shared/userSettings';

/**
 * This button is the composer's only entry point to the snippets, so what it
 * has to get right is: one button that says how many there are, one row per
 * snippet, a row whose name differs from its text showing both, and no button
 * at all once the list is empty. It reads the preference the settings tab
 * writes; the fake `t` keeps the assertions independent of the locale files.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

test('the button counts the snippets and lists one row each', () => {
  writeQuickReplies([{ text: '继续' }, { label: '先评估影响面', text: '你评估下影响面，先不要改' }]);
  const { getByLabelText, getAllByRole } = render(<QuickReplyMenu onInsert={() => undefined} />);

  const button = getByLabelText('quickReplies.button');
  assert.equal(button.textContent, '2');

  fireEvent.click(button);

  const rows = getAllByRole('menuitem');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].textContent, '继续', 'a snippet with no name shows only its text');
  assert.match(rows[1].textContent ?? '', /先评估影响面/);
  assert.match(rows[1].textContent ?? '', /你评估下影响面，先不要改/);
});

test('an emptied list leaves the button out of the composer', () => {
  writeQuickReplies([]);

  const { container } = render(<QuickReplyMenu onInsert={() => undefined} />);

  assert.equal(container.querySelector('button'), null);
});

test('picking a row hands the snippet over and closes the list', () => {
  writeQuickReplies([{ text: '继续' }]);
  const picked: string[] = [];
  const { getByLabelText, getAllByRole, queryAllByRole } = render(
    <QuickReplyMenu onInsert={(reply) => picked.push(reply.text)} />,
  );

  fireEvent.click(getByLabelText('quickReplies.button'));
  fireEvent.click(getAllByRole('menuitem')[0]);

  assert.deepEqual(picked, ['继续']);
  assert.equal(queryAllByRole('menuitem').length, 0, 'the list must close after the pick');
});
