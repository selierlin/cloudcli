import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { LLMProvider, ProjectSession, RecentConversationListItem, SessionAttentionLevel, SidebarProjectListProps } from '@/shared/types';

/**
 * The Conversations feed is flat, so a filed session carries a "derived from"
 * reference line instead of an indent. The line opens the parent, which may sit
 * off the current page; when its title cannot be resolved (the parent was
 * permanently deleted) the line degrades to plain text rather than a dead click.
 */

const { default: SidebarRecentConversations } = await import('@/modules/sidebar/SidebarRecentConversations');

const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};
// Echo the key and the interpolated title so the assertions can see both.
const t = ((key: string, options?: { title?: string }) =>
  options && typeof options.title === 'string' ? `${key}(${options.title})` : key
) as unknown as SidebarProjectListProps['t'];

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

const renderList = (
  conversations: RecentConversationListItem[],
  onConversationSelect: (
    projectId: string | null,
    sessionId: string,
    provider: string,
  ) => void = noop,
) => render(
  <SidebarRecentConversations
    conversations={conversations}
    total={conversations.length}
    hasMore={false}
    isLoading={false}
    isLoadingMore={false}
    hasError={false}
    selectedSession={null as unknown as ProjectSession | null}
    activeSessions={new Set<string>()}
    backgroundSessionIds={new Set<string>()}
    attentionSessions={new Map<string, SessionAttentionLevel>()}
    currentTime={NOW}
    onConversationSelect={onConversationSelect}
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

test('a filed session shows a clickable "derived from" line naming its parent', () => {
  const { container } = renderList([
    conversation('child', { parentSessionId: 'parent', parentTitle: 'Parent title' }),
  ]);

  const lines = container.querySelectorAll('[data-testid="conversation-parent-reference"]');
  assert.equal(lines.length, 2, 'both responsive layouts carry the reference line');
  const links = container.querySelectorAll('[data-testid="conversation-parent-reference"] [role="button"]');
  assert.equal(links.length, 2, 'a resolvable parent is a click target');
  assert.match(links[0].textContent ?? '', /sessions\.derivedFrom\(Parent title\)/);
});

test('a session whose parent is gone shows a non-clickable fallback line', () => {
  const { container } = renderList([
    conversation('child', { parentSessionId: 'ghost', parentTitle: null }),
  ]);

  const lines = container.querySelectorAll('[data-testid="conversation-parent-reference"]');
  assert.equal(lines.length, 2);
  assert.equal(
    container.querySelectorAll('[data-testid="conversation-parent-reference"] [role="button"]').length,
    0,
    'a deleted parent must not present a dead click target',
  );
  assert.match(lines[0].textContent ?? '', /sessions\.derivedSessionFallback/);
});

test('a top-level session shows no reference line', () => {
  const { container } = renderList([conversation('root')]);

  assert.equal(
    container.querySelectorAll('[data-testid="conversation-parent-reference"]').length,
    0,
  );
});

test('clicking the line opens the parent with its own row identity when it is on the page', () => {
  const onConversationSelect = vi.fn();
  const { container } = renderList(
    [
      conversation('parent', { projectId: 'project-1', provider: 'codex' as LLMProvider }),
      conversation('child', {
        projectId: 'project-1',
        parentSessionId: 'parent',
        parentTitle: 'Parent title',
      }),
    ],
    onConversationSelect,
  );

  const link = container.querySelector('[data-testid="conversation-parent-reference"] [role="button"]');
  assert.ok(link);
  fireEvent.click(link);

  assert.equal(onConversationSelect.mock.calls.length, 1, 'the row itself must not also navigate');
  assert.deepEqual(onConversationSelect.mock.calls[0], ['project-1', 'parent', 'codex']);
});

test('clicking the line falls back to the row identity when the parent is off the page', () => {
  const onConversationSelect = vi.fn();
  const { container } = renderList(
    [
      conversation('child', {
        projectId: 'project-9',
        provider: 'claude' as LLMProvider,
        parentSessionId: 'off-page-parent',
        parentTitle: 'Elsewhere',
      }),
    ],
    onConversationSelect,
  );

  const link = container.querySelector('[data-testid="conversation-parent-reference"] [role="button"]');
  assert.ok(link);
  fireEvent.click(link);

  assert.deepEqual(onConversationSelect.mock.calls[0], ['project-9', 'off-page-parent', 'claude']);
});
