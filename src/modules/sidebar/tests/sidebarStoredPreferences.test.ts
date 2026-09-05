import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

const loadReader = async () => {
  vi.resetModules();
  return import('@/modules/sidebar/utils/sidebarStoredPreferences');
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

test('defaults project sorting to recent activity when no preference exists', async () => {
  const { readProjectSortOrder } = await loadReader();

  assert.equal(readProjectSortOrder(), 'date');
});

test('preserves an explicit alphabetical project sorting preference', async () => {
  localStorage.setItem('user-preferences', JSON.stringify({ projectSortOrder: 'name' }));
  const { readProjectSortOrder } = await loadReader();

  assert.equal(readProjectSortOrder(), 'name');
});

test('falls back to recent activity for an invalid project sorting preference', async () => {
  localStorage.setItem('user-preferences', JSON.stringify({ projectSortOrder: 'invalid' }));
  const { readProjectSortOrder } = await loadReader();

  assert.equal(readProjectSortOrder(), 'date');
});
