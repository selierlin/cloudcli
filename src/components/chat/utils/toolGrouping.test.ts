import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../types/types';

import { groupConsecutiveTools, isToolGroupItem } from './toolGrouping';

const tool = (toolName: string): ChatMessage => ({
  type: 'assistant',
  timestamp: '2026-08-30T00:00:00.000Z',
  isToolUse: true,
  toolName,
  toolInput: '{}',
});

test('groups mixed routine tools into one compact activity summary', () => {
  const grouped = groupConsecutiveTools([
    tool('Bash'),
    tool('Read'),
    tool('Grep'),
  ], false);

  assert.equal(grouped.length, 1);
  assert.ok(isToolGroupItem(grouped[0]));
  assert.deepEqual(grouped[0].messages.map((message) => message.toolName), ['Bash', 'Read', 'Grep']);
});

test('keeps interactive tools outside routine activity summaries', () => {
  const grouped = groupConsecutiveTools([
    tool('Bash'),
    tool('AskUserQuestion'),
    tool('Read'),
  ], false);

  assert.equal(grouped.length, 3);
  assert.ok(!isToolGroupItem(grouped[0]));
  assert.ok(!isToolGroupItem(grouped[1]));
  assert.ok(!isToolGroupItem(grouped[2]));
});
