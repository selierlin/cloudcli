import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useModelGroupCollapse } from '@/modules/chat/hooks/useModelGroupCollapse';
import type { ModelOptionGroup } from '@/modules/chat/utils/modelGrouping';
import type { ProviderModelOption } from '@/shared/types';

const model = (value: string, group?: string): ProviderModelOption => ({
  value,
  label: value,
  group,
});

const GROUPS: ModelOptionGroup[] = [
  { key: 'ark', options: [model('ark/a', 'ark'), model('ark/b', 'ark')] },
  { key: 'deepseek', options: [model('deepseek/x', 'deepseek')] },
  { key: null, options: [model('custom-model')] },
];

test('expands only the section holding the selected model by default', () => {
  const { result } = renderHook(() => useModelGroupCollapse(GROUPS, 'deepseek/x'));

  assert.equal(result.current.isExpanded('ark'), false);
  assert.equal(result.current.isExpanded('deepseek'), true);
  assert.equal(result.current.isExpanded(null), false);
});

test('falls back to the first section when the selected model is unknown', () => {
  const { result } = renderHook(() => useModelGroupCollapse(GROUPS, 'missing-model'));

  assert.equal(result.current.isExpanded('ark'), true);
  assert.equal(result.current.isExpanded('deepseek'), false);
  assert.equal(result.current.isExpanded(null), false);
});

test('toggle flips a section without touching the default', () => {
  const { result } = renderHook(() => useModelGroupCollapse(GROUPS, 'deepseek/x'));

  act(() => result.current.toggle('ark'));
  assert.equal(result.current.isExpanded('ark'), true);
  assert.equal(result.current.isExpanded('deepseek'), true);

  act(() => result.current.toggle('ark'));
  assert.equal(result.current.isExpanded('ark'), false);
});

test('reset restores only the selected section after manual toggles', () => {
  const { result } = renderHook(() => useModelGroupCollapse(GROUPS, 'deepseek/x'));

  act(() => result.current.toggle('ark'));
  act(() => result.current.reset());

  assert.equal(result.current.isExpanded('ark'), false);
  assert.equal(result.current.isExpanded('deepseek'), true);
});

test('moving the selected model to another section re-expands that section', () => {
  const { result, rerender } = renderHook(
    ({ value }: { value: string }) => useModelGroupCollapse(GROUPS, value),
    { initialProps: { value: 'deepseek/x' } },
  );

  assert.equal(result.current.isExpanded('deepseek'), true);

  rerender({ value: 'custom-model' });

  assert.equal(result.current.isExpanded('deepseek'), false);
  assert.equal(result.current.isExpanded(null), true);
});
