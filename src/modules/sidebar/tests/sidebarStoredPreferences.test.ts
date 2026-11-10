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

test('defaults the sidebar section to projects when no preference exists', async () => {
  const { readSidebarSearchMode } = await loadReader();

  assert.equal(readSidebarSearchMode(), 'projects');
});

test('restores the sidebar section the user last chose', async () => {
  localStorage.setItem('user-preferences', JSON.stringify({ sidebarSearchMode: 'conversations' }));
  const { readSidebarSearchMode } = await loadReader();

  assert.equal(readSidebarSearchMode(), 'conversations');
});

test('falls back to projects for a sidebar section this build does not have', async () => {
  localStorage.setItem('user-preferences', JSON.stringify({ sidebarSearchMode: 'retired-section' }));
  const { readSidebarSearchMode } = await loadReader();

  assert.equal(readSidebarSearchMode(), 'projects');
});
