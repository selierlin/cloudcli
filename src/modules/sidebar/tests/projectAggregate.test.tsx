import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { Project, SessionWithProvider, SidebarProjectListProps } from '@/shared/types';
import { deriveProjectAggregate, type ProjectAggregate } from '@/modules/sidebar/utils/projectAggregate';
import { ProjectAggregateSlot } from '@/modules/sidebar/SessionStatusIndicators';

// The session list is stubbed to the one control this test drives: entering
// batch-manage mode. It exists to prove the row reacts to that mode, not to
// re-test the list.
vi.mock('@/modules/sidebar/SidebarProjectSessions', () => ({
  default: ({ onManagingChange }: { onManagingChange: (managing: boolean) => void }) =>
    React.createElement('button', { type: 'button', onClick: () => onManagingChange(true) }, 'manage-sessions'),
}));

const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

/**
 * A project row has room for one indicator, not the session row's two ends, so
 * the four child states are ranked into a single strongest signal. Two things
 * are load-bearing: the rank never lets a weaker state mask a stronger one, and
 * every state keeps a distinct *shape* — the row has no bold-title fallback, so
 * colour alone would fail §3 原则 6.
 */

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NO_IDS: ReadonlySet<string> = new Set();
const sessions = (...ids: string[]) => ids.map((id) => ({ id }));
const levels = (entries: Array<[string, 'action' | 'notice']>) => new Map(entries);

const renderAggregate = (aggregate: ProjectAggregate | null) =>
  render(React.createElement(ProjectAggregateSlot, { aggregate, t }));

test('an idle project aggregates to nothing', () => {
  assert.equal(deriveProjectAggregate(sessions('a', 'b'), NO_IDS, NO_IDS, levels([])), null);
});

test('action outranks notice and activity, and counts only the action sessions', () => {
  const aggregate = deriveProjectAggregate(
    sessions('a', 'b', 'c'),
    new Set(['b']),
    NO_IDS,
    levels([['a', 'action'], ['b', 'notice'], ['c', 'action']]),
  );

  assert.deepEqual(aggregate, { kind: 'action', count: 2 });
});

test('notice outranks activity when nothing needs the user', () => {
  const aggregate = deriveProjectAggregate(
    sessions('a', 'b'),
    new Set(['a', 'b']),
    NO_IDS,
    levels([['a', 'notice']]),
  );

  assert.deepEqual(aggregate, { kind: 'notice' });
});

test('a response in flight outranks background-only work', () => {
  const aggregate = deriveProjectAggregate(
    sessions('a', 'b'),
    new Set(['a', 'b']),
    new Set(['b']),
    levels([]),
  );

  assert.deepEqual(aggregate, { kind: 'foreground' });
});

test('background work alone is its own state', () => {
  const aggregate = deriveProjectAggregate(
    sessions('a'),
    new Set(['a']),
    new Set(['a']),
    levels([]),
  );

  assert.deepEqual(aggregate, { kind: 'background' });
});

test('a session the user is not looking at still counts when it is only in the attention map', () => {
  // The aggregate reads the same event-fed map the rows do; a session with an
  // `action` flag but no entry in the active set is still waiting on the user.
  const aggregate = deriveProjectAggregate(
    sessions('loaded-only'),
    NO_IDS,
    NO_IDS,
    levels([['loaded-only', 'action']]),
  );

  assert.deepEqual(aggregate, { kind: 'action', count: 1 });
});

test('the action capsule carries the count, capped at 9+', () => {
  const { container } = renderAggregate({ kind: 'action', count: 3 });
  const capsule = container.querySelector('[role="status"].bg-amber-500');
  assert.ok(capsule, 'action is the amber capsule, the same shape a session row uses');
  assert.match(String(capsule.textContent), /3/);
  assert.equal(container.querySelectorAll('.animate-spin').length, 0);

  const many = renderAggregate({ kind: 'action', count: 12 });
  assert.match(String(many.container.querySelector('[role="status"]')?.textContent), /9\+/);
});

test('each remaining state draws a different shape, not just a different colour', () => {
  const notice = renderAggregate({ kind: 'notice' });
  assert.ok(notice.container.querySelector('[role="status"] svg'), 'notice draws a bell icon');
  assert.equal(notice.container.querySelectorAll('.animate-spin').length, 0);

  const foreground = renderAggregate({ kind: 'foreground' });
  assert.equal(
    foreground.container.querySelectorAll('.animate-spin').length,
    1,
    'a foreground turn spins, the same cue a session row uses',
  );

  const background = renderAggregate({ kind: 'background' });
  assert.ok(background.container.querySelector('[role="status"] svg'), 'background draws an icon, not a flat dot');
  assert.equal(
    background.container.querySelectorAll('.animate-spin').length,
    0,
    'background work pulses rather than spins — nothing is responding',
  );
});

test('a null aggregate renders no marker at all', () => {
  const { container } = renderAggregate(null);
  assert.ok(container.querySelector('[role="status"]') === null);
});

const PROJECT = {
  projectId: 'project-1',
  name: 'project-1',
  displayName: 'project one',
  fullPath: '/tmp/project-1',
  sessions: [{ id: 's1', summary: 'session one', lastActivity: '2026-08-21T10:00:00.000Z' }],
} as unknown as Project;

const noop = () => {};
const NOW = new Date('2026-08-21T10:00:00.000Z');

const projectRow = (attentionSessions: ReadonlyMap<string, 'action' | 'notice'>) => ({
  project: PROJECT,
  selectedProject: null,
  selectedSession: null,
  isExpanded: true,
  isDeleting: false,
  isStarred: false,
  isEditing: false,
  renameDraft: '',
  sessions: PROJECT.sessions as unknown as SessionWithProvider[],
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: NOW,
  sessionRenameId: null,
  sessionRenameDraft: '',
  tasksEnabled: false,
  mcpServerStatus: null,
  onRenameDraftChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onDeleteProject: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onLoadMoreSessions: noop,
  activeSessions: NO_IDS,
  backgroundSessionIds: NO_IDS,
  attentionSessions,
  onNewSession: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  t,
});

test('the project row aggregates its children, then hides the aggregate in batch-manage mode', () => {
  const { container, getByText } = render(
    React.createElement(SidebarProjectItem, projectRow(levels([['s1', 'action']]))),
  );

  assert.ok(
    container.querySelector('[role="status"].bg-amber-500'),
    'a project holding a session that needs the user shows the aggregate capsule',
  );

  fireEvent.click(getByText('manage-sessions'));

  assert.ok(
    container.querySelector('[role="status"]') === null,
    'the aggregate is suppressed while the list is being culled (D4)',
  );
});
