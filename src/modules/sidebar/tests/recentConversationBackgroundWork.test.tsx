import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { test } from 'vitest';

import type { LLMProvider, ProjectSession, RecentConversationListItem, SessionAttentionLevel, SidebarProjectListProps } from '@/shared/types';

/**
 * The Conversations list shares the Projects list's two channels: activity on
 * the row's left edge (a spinning ring while a response is in flight, the
 * purple pulse of the workflow and agent cards while only background work
 * runs) and unread on the right edge (an amber capsule or a blue dot). The
 * row's age stays inline in its subtitle. These assertions lock the two tabs
 * to one behaviour (see sessionRowBackgroundWork.test.tsx).
 */

const { default: SidebarRecentConversations } = await import('@/modules/sidebar/SidebarRecentConversations');

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

const conversation = (
  sessionId: string,
  overrides: Partial<RecentConversationListItem> = {},
): RecentConversationListItem => ({
  sessionId,
  provider: 'claude' as LLMProvider,
  projectId: 'project-1',
  projectDisplayName: 'project one',
  sessionTitle: `title of ${sessionId}`,
  lastActivity: '2026-08-21T09:30:00.000Z',
  isPinned: false,
  ...overrides,
});

type RowState = {
  activeSessions?: Set<string>;
  backgroundSessionIds?: Set<string>;
  attentionSessions?: Map<string, SessionAttentionLevel>;
};

const renderList = (conversations: RecentConversationListItem[], state: RowState = {}) => render(
  <SidebarRecentConversations
    conversations={conversations}
    total={conversations.length}
    hasMore={false}
    isLoading={false}
    isLoadingMore={false}
    hasError={false}
    selectedSession={null as unknown as ProjectSession | null}
    activeSessions={state.activeSessions ?? new Set<string>()}
    backgroundSessionIds={state.backgroundSessionIds ?? new Set<string>()}
    attentionSessions={state.attentionSessions ?? new Map<string, SessionAttentionLevel>()}
    currentTime={NOW}
    onConversationSelect={noop}
    onLoadMore={noop}
    onRetry={noop}
    onRenameSession={noop}
    onTogglePinned={noop}
    onDeleteSession={noop}
    onRequestBatchArchive={noop}
    projects={[]}
    selectedProject={null}
    onNewSession={noop}
    t={t}
  />,
);

test('a session with only background work running gets a purple dot and keeps its age', () => {
  const { container } = renderList(
    [conversation('s1')],
    { activeSessions: new Set(['s1']), backgroundSessionIds: new Set(['s1']) },
  );

  assert.equal(container.querySelectorAll('.animate-spin').length, 0, 'nothing spins while only background work runs');
  const dots = container.querySelectorAll('[role="status"].bg-purple-500');
  assert.equal(dots.length, 1, 'the activity slot sits outside the responsive branches, so it renders once');
  assert.equal(dots[0].getAttribute('aria-label'), 'tooltips.backgroundWorkIndicator');
  assert.equal(container.querySelectorAll('time').length, 2, 'the age slot is freed — the dot moved to the left edge');
});

test('a response in flight shows the spinning ring and no purple dot', () => {
  const { container } = renderList(
    [conversation('s1')],
    { activeSessions: new Set(['s1']) },
  );

  // One ring for the row, on its left edge. A subtitle spinner next to the
  // project name would make this three — the row must never spin twice.
  assert.equal(container.querySelectorAll('.animate-spin').length, 1, 'a response in flight spins once, at the left edge');
  assert.equal(container.querySelectorAll('[role="status"].bg-purple-500').length, 0);
});

test('a session waiting on the user gets an amber capsule on the right edge', () => {
  const { container } = renderList(
    [conversation('s1'), conversation('s2')],
    { attentionSessions: new Map([['s1', 'action'], ['s2', 'action']]) },
  );

  // Both responsive layouts render the row, so each conversation carries two.
  const markers = container.querySelectorAll('[role="status"].bg-amber-500');
  assert.equal(markers.length, 4);
  assert.equal(markers[0].getAttribute('aria-label'), 'tooltips.attentionActionIndicator');
});

test('a passive unread event is flagged in blue rather than amber', () => {
  const { container } = renderList(
    [conversation('s1')],
    { attentionSessions: new Map([['s1', 'notice']]) },
  );

  assert.equal(container.querySelectorAll('[role="status"].bg-blue-500').length, 2);
  assert.equal(container.querySelectorAll('[role="status"].bg-amber-500').length, 0);
});

test('an idle session shows its age and nothing pulses', () => {
  const { container } = renderList([conversation('s1')]);

  assert.ok(container.querySelectorAll('time').length >= 1);
  assert.equal(container.querySelectorAll('[role="status"]').length, 0);
});
