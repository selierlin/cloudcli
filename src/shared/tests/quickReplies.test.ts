import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import {
  MAX_QUICK_REPLIES,
  addQuickReply,
  composeQuickReplyInput,
  isQuickReplyCommand,
  moveQuickReply,
  normalizeQuickReplies,
  quickReplyLabel,
  readStoredQuickReplies,
  removeQuickReplyAt,
  resolveDefaultQuickReplies,
  setQuickReplyAt,
  writeQuickReplies,
} from '@/shared/quickReplies';
import type { QuickReply } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The list is one JSON array inside the preference blob, and the two states
 * that have to stay distinguishable are "never edited" (render the shipped
 * defaults) and "edited down to nothing" (stay empty). The rest is about
 * surviving a value that an older or a different client wrote.
 */

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

const reply = (text: string, label?: string): QuickReply => (label ? { label, text } : { text });

test('a list that was never edited reads as unset, so the defaults are rendered', () => {
  assert.equal(readStoredQuickReplies(), null);
});

test('an emptied list stays empty instead of falling back to the defaults', () => {
  writeQuickReplies([]);

  assert.deepEqual(readStoredQuickReplies(), []);
});

test('the shipped defaults keep the label/text split the arrows rely on', () => {
  const defaults = resolveDefaultQuickReplies((key) => key);

  assert.equal(defaults.length, 15);
  assert.deepEqual(defaults[0], { text: 'quickReplies.defaults.continue' });
  assert.deepEqual(defaults[9], {
    label: 'quickReplies.defaults.assessImpact.label',
    text: 'quickReplies.defaults.assessImpact.text',
  });
});

test('a stored list is read back exactly as written', () => {
  const list = [reply('继续'), reply('你评估下影响面，先不要改', '先评估影响面')];

  writeQuickReplies(list);

  assert.deepEqual(readStoredQuickReplies(), list);
});

test('anything that is not a snippet is dropped rather than crashing the composer', () => {
  writeUserPreference('quickReplies', 'not a list');
  assert.deepEqual(readStoredQuickReplies(), []);

  writeUserPreference('quickReplies', [{ text: 'ok' }, { label: 'no text' }, null, 7, ['x']]);
  assert.deepEqual(readStoredQuickReplies(), [{ text: 'ok' }]);
});

test('no more than the limit is kept', () => {
  const many = Array.from({ length: MAX_QUICK_REPLIES + 5 }, (_, index) => reply(`n${index}`));

  assert.equal(normalizeQuickReplies(many).length, MAX_QUICK_REPLIES);
  assert.equal(
    addQuickReply(normalizeQuickReplies(many), reply('one too many')).length,
    MAX_QUICK_REPLIES,
  );
});

test('values are never trimmed or rewritten, so a controlled editor round-trips typing', () => {
  // The settings rows write on every keystroke and render what comes back, so a
  // normalizing write would eat the space in "a b" between keystrokes.
  writeQuickReplies([{ label: 'a ', text: ' b ' }]);

  assert.deepEqual(readStoredQuickReplies(), [{ label: 'a ', text: ' b ' }]);
});

test('a snippet is named by its label, or by its text when it has none', () => {
  assert.equal(quickReplyLabel({ text: '继续' }), '继续');
  assert.equal(quickReplyLabel({ label: '先评估影响面', text: '你评估下影响面，先不要改' }), '先评估影响面');
  assert.equal(quickReplyLabel({ label: '   ', text: '继续' }), '继续');
});

test('editing a row replaces only that row and ignores an index off the end', () => {
  const list = [reply('a'), reply('b')];

  assert.deepEqual(setQuickReplyAt(list, 0, { label: 'A' }), [{ label: 'A', text: 'a' }, { text: 'b' }]);
  assert.deepEqual(setQuickReplyAt(list, 2, { label: 'A' }), list);
});

test('removing a row leaves the others in order and ignores an index off the end', () => {
  const list = [reply('a'), reply('b'), reply('c')];

  assert.deepEqual(removeQuickReplyAt(list, 1), [reply('a'), reply('c')]);
  assert.deepEqual(removeQuickReplyAt(list, 3), list);
});

test('moving a row swaps it with its neighbour and stops at either end', () => {
  const list = [reply('a'), reply('b')];

  assert.deepEqual(moveQuickReply(list, 0, 1), [reply('b'), reply('a')]);
  assert.deepEqual(moveQuickReply(list, 0, -1), list);
  assert.deepEqual(moveQuickReply(list, 1, 1), list);
});

test('a snippet is appended to what is already typed', () => {
  assert.equal(composeQuickReplyInput('', '继续'), '继续');
  assert.equal(composeQuickReplyInput('   ', '继续'), '继续');
  assert.equal(composeQuickReplyInput('跑一下测试', '继续'), '跑一下测试 继续');
});

test('only a leading slash starts a fresh box, so the text stays a command', () => {
  assert.equal(composeQuickReplyInput('先别动手', '/session-sediment'), '/session-sediment');
  assert.equal(composeQuickReplyInput('跑一下测试', '看看 src/foo.ts'), '跑一下测试 看看 src/foo.ts');
});

test('a snippet counts as a command only when the slash leads, which is what gates sending', () => {
  assert.equal(isQuickReplyCommand('/session-sediment'), true);
  assert.equal(isQuickReplyCommand('继续'), false);
  // A slash further in is just a path, and the send path treats it as prose.
  assert.equal(isQuickReplyCommand('看看 src/foo.ts'), false);
});
