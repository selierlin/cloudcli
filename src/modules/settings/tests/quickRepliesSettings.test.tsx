import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import QuickRepliesSettingsTab from '@/modules/settings/tabs/QuickRepliesSettingsTab';
import { readStoredQuickReplies, writeQuickReplies } from '@/shared/quickReplies';
import { resetUserPreferences } from '@/shared/userSettings';

/**
 * The tab edits the stored list through the preference store, and the two
 * states it has to keep apart are "never edited" (the shipped defaults are
 * shown and nothing is stored) and "deleted down to nothing" (the list stays
 * empty and the defaults must not come back).
 *
 * The assertions count rows and read the store rather than matching translated
 * copy, so they stay independent of the locale files: the fake `t` returns keys.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options ? `${key}:${JSON.stringify(options)}` : key
    ),
    i18n: { language: 'en' },
  }),
}));

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

const removeButtons = (container: HTMLElement) => (
  container.querySelectorAll('[aria-label="quickRepliesSettings.remove"]')
);

test('the shipped defaults are offered without being stored', () => {
  const { container } = render(<QuickRepliesSettingsTab />);

  assert.equal(removeButtons(container).length, 15);
  assert.equal(
    readStoredQuickReplies(),
    null,
    'showing the defaults must not write them into the preference',
  );
});

test('adding a row stores the defaults it was shown, plus the new row', () => {
  const { getByPlaceholderText, getByRole } = render(<QuickRepliesSettingsTab />);

  fireEvent.change(getByPlaceholderText('quickRepliesSettings.labelPlaceholder'), {
    target: { value: ' 接着写 ' },
  });
  fireEvent.change(getByPlaceholderText('quickRepliesSettings.textPlaceholder'), {
    target: { value: '继续写下去' },
  });
  fireEvent.click(getByRole('button', { name: 'quickRepliesSettings.add' }));

  const stored = readStoredQuickReplies();
  assert.equal(stored?.length, 16);
  assert.deepEqual(stored?.at(-1), { label: '接着写', text: '继续写下去' });
});

test('moving a row writes the new order', () => {
  const { container } = render(<QuickRepliesSettingsTab />);

  fireEvent.click(container.querySelectorAll('[aria-label="quickRepliesSettings.moveUp"]')[1] as HTMLButtonElement);

  assert.deepEqual(readStoredQuickReplies()?.[0], { text: 'quickReplies.defaults.goAhead' });
});

test('removing the last row leaves an empty list that stays empty', () => {
  writeQuickReplies([{ text: '唯一一条' }]);
  const { container, getByText } = render(<QuickRepliesSettingsTab />);

  fireEvent.click(removeButtons(container)[0] as HTMLButtonElement);

  assert.deepEqual(readStoredQuickReplies(), []);
  assert.equal(removeButtons(container).length, 0);
  assert.ok(getByText('quickRepliesSettings.empty'), 'the empty state must replace the rows');
});

const pickFile = (container: HTMLElement, file: File) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
};

test('an import whose file holds nothing usable reports it and leaves the list alone', async () => {
  writeQuickReplies([{ text: '原有' }]);
  const { container, findByRole } = render(<QuickRepliesSettingsTab />);

  pickFile(container, new File(['   \n \n'], 'empty.txt', { type: 'text/plain' }));

  const status = await findByRole('status');
  assert.equal(status.textContent, 'quickRepliesSettings.importEmpty');
  assert.deepEqual(readStoredQuickReplies(), [{ text: '原有' }]);
});

test('a confirmed import replaces the list and reports the rows it skipped', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { container, findByRole } = render(<QuickRepliesSettingsTab />);

  pickFile(container, new File(['继续\n\n重试\n'], 'snippets.txt', { type: 'text/plain' }));

  const status = await findByRole('status');
  assert.equal(status.textContent, 'quickRepliesSettings.importSkipped:{"count":1}');
  assert.deepEqual(readStoredQuickReplies(), [{ text: '继续' }, { text: '重试' }]);
  confirmSpy.mockRestore();
});

test('declining the confirm leaves the current list untouched', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  writeQuickReplies([{ text: '原有' }]);
  const { container } = render(<QuickRepliesSettingsTab />);

  pickFile(container, new File(['新的一条'], 'snippets.txt', { type: 'text/plain' }));

  await vi.waitFor(() => assert.equal(confirmSpy.mock.calls.length, 1));
  assert.deepEqual(readStoredQuickReplies(), [{ text: '原有' }]);
  confirmSpy.mockRestore();
});
