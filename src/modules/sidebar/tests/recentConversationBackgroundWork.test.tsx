import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { LLMProvider, ProjectSession, RecentConversationListItem, SidebarProjectListProps } from '@/shared/types';

/**
 * The Conversations list draws a session's state inline: a spinner while a
 * response is in flight, the purple pulse of the workflow and agent cards
 * while only background work is running, and the row's age otherwise. These
 * assertions were carried over from the recents row tests the fork replaced;
 * they lock the indicators to the semantics the sidebar shares with the
 * Projects list (see sessionRowBackgroundWork.test.tsx).
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
  attentionSessionIds?: Set<string>;
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
    attentionSessionIds={state.attentionSessionIds ?? new Set<string>()}
    currentTime={NOW}
    onConversationSelect={noop}
    onLoadMore={noop}
    onRetry={noop}
    onRenameSession={noop}
    onTogglePinned={noop}
    onDeleteSession={noop}
    onRequestBatchArchive={noop}
    t={t}
  />,
);

test('a session with only background work running gets the purple dot, not the spinner, and is not processing', () => {
  const { container } = renderList(
    [conversation('s1'), conversation('s2')],
    { activeSessions: new Set(['s1']), backgroundSessionIds: new Set(['s1']) },
  );

  assert.equal(container.querySelectorAll('.animate-spin').length, 0, 'nothing spins while only background work runs');
  const dots = container.querySelectorAll('[role="status"].bg-purple-500');
  assert.ok(dots.length >= 1, 'the background row carries the purple dot');
  assert.equal(dots[0].getAttribute('aria-label'), 'tooltips.backgroundWorkIndicator');
  assert.ok(container.querySelectorAll('time').length >= 1, 'the other row shows its age');
});

test('a response in flight keeps the spinner and no purple dot', () => {
  const { container } = renderList(
    [conversation('s1')],
    { activeSessions: new Set(['s1']) },
  );

  // jsdom renders both layouts: exactly one spinner per layout (the fork's
  // right-edge one). A subtitle spinner next to the project name would
  // double this — the row must never spin in two places at once.
  assert.equal(container.querySelectorAll('.animate-spin').length, 2, 'a response in flight spins once per layout, at the row edge');
  assert.equal(container.querySelectorAll('[role="status"].bg-purple-500').length, 0);
});

test('a session needing attention gets the amber dot unless selected', () => {
  const { container } = renderList(
    [conversation('s1'), conversation('s2')],
    { attentionSessionIds: new Set(['s1', 's2']) },
  );

  const dots = container.querySelectorAll('[role="status"].bg-amber-500');
  assert.equal(dots.length, 2);
  assert.equal(dots[0].getAttribute('aria-label'), 'tooltips.attentionRequiredIndicator');
});

test('an idle session shows its age and nothing pulses', () => {
  const { container } = renderList([conversation('s1')]);

  assert.ok(container.querySelectorAll('time').length >= 1);
  assert.equal(container.querySelectorAll('[role="status"]').length, 0);
});
