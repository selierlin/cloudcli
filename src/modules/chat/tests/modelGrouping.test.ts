import assert from 'node:assert/strict';

import { test } from 'vitest';

import { groupModelOptions } from '@/modules/chat/utils/modelGrouping';
import type { ProviderModelOption } from '@/shared/types';

const option = (value: string, group?: string): ProviderModelOption => ({ value, label: value, group });

test('untagged catalogs collapse into a single ungrouped section', () => {
  const groups = groupModelOptions([option('default'), option('sonnet')]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, null);
  assert.deepEqual(groups[0].options.map((entry) => entry.value), ['default', 'sonnet']);
});

test('tagged options group by channel in first-seen order', () => {
  const groups = groupModelOptions([
    option('ark/a', 'ark'),
    option('deepseek/x', 'deepseek'),
    option('ark/b', 'ark'),
  ]);

  assert.deepEqual(groups.map((group) => group.key), ['ark', 'deepseek']);
  assert.deepEqual(groups[0].options.map((entry) => entry.value), ['ark/a', 'ark/b']);
  assert.deepEqual(groups[1].options.map((entry) => entry.value), ['deepseek/x']);
});

test('same-named models from different channels stay in separate groups', () => {
  const groups = groupModelOptions([
    option('deepseek/deepseek-v4-flash', 'deepseek'),
    option('ark/deepseek-v4-flash', 'ark'),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.options[0].value), [
    'deepseek/deepseek-v4-flash',
    'ark/deepseek-v4-flash',
  ]);
});

test('untagged options collect into a trailing ungrouped section', () => {
  const groups = groupModelOptions([
    option('ark/a', 'ark'),
    option('custom-model'),
    option('deepseek/x', 'deepseek'),
  ]);

  assert.deepEqual(groups.map((group) => group.key), ['ark', 'deepseek', null]);
  assert.deepEqual(groups[2].options.map((entry) => entry.value), ['custom-model']);
});

test('blank channel tags are treated as ungrouped', () => {
  const groups = groupModelOptions([option('ark/a', '  '), option('ark/b', 'ark')]);

  assert.deepEqual(groups.map((group) => group.key), ['ark', null]);
  assert.deepEqual(groups[1].options.map((entry) => entry.value), ['ark/a']);
});

test('an empty catalog produces no groups', () => {
  assert.deepEqual(groupModelOptions([]), []);
});
