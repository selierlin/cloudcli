import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

// The header pulls in the server/account menus and their auth context, which
// have nothing to do with the search rows under test.
vi.mock('@/modules/sidebar/SidebarHeader', () => ({ default: () => null }));

import type {
  ArchivedProjectListItem,
  ArchivedSessionListItem,
  Project,
  ProjectSession,
  SessionTitleSearchResult,
  SidebarProjectListProps,
  SidebarSearchMode,
} from '@/shared/types';

/**
 * A conversation-search hit is a temporary view of a session, not a stable
 * sidebar row, so it only earns the same "file under…/move to top level" actions
 * the project and conversations rows carry — never for an archived hit, and
 * never for a hit that already owns children (the tree is one level deep).
 *
 * `sessionOwnsChildren` has to come from the loaded projects, because a hit
 * holds no session list of its own.
 */

const { SessionParentPickerProvider } = await import('@/modules/sidebar/context/SessionParentPickerContext');
const { default: SidebarContent } = await import('@/modules/sidebar/SidebarContent');

const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};
// Echo the key so the assertions read the i18n key instead of a translation.
const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];

const hit = (
  sessionId: string,
  overrides: Partial<SessionTitleSearchResult> = {},
): SessionTitleSearchResult => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'project one',
  sessionTitle: `title of ${sessionId}`,
  lastActivity: '2026-08-21T09:30:00.000Z',
  ...overrides,
});

const projectWith = (sessions: Partial<ProjectSession>[]): Project => ({
  projectId: 'project-1',
  name: 'project-1',
  displayName: 'project one',
  fullPath: '/tmp/project-1',
  sessions: sessions as ProjectSession[],
}) as unknown as Project;

const renderSearch = (
  hits: SessionTitleSearchResult[],
  { projects = [] as Project[], setSessionParent = noop as (sessionId: string, parent: string | null) => void } = {},
) => render(
  <SessionParentPickerProvider projects={projects} setSessionParent={setSessionParent} t={t}>
    <SidebarContent
      isPWA={false}
      isMobile={false}
      isLoading={false}
      projects={projects}
      runningSessionsCount={0}
      archivedProjects={[] as ArchivedProjectListItem[]}
      archivedSessions={[] as ArchivedSessionListItem[]}
      archivedSessionsCount={0}
      isArchivedSessionsLoading={false}
      recentConversations={[]}
      recentConversationsTotal={0}
      recentConversationsHasMore={false}
      isRecentConversationsLoading={false}
      isLoadingMoreRecentConversations={false}
      recentConversationsError={false}
      searchFilter="release"
      onSearchFilterChange={noop}
      onClearSearchFilter={noop}
      searchMode={'conversations' as SidebarSearchMode}
      onSearchModeChange={noop}
      conversationResults={{ results: [], titleResults: hits, totalMatches: hits.length, query: 'release' }}
      isSearching={false}
      searchProgress={null}
      onRestoreArchivedProject={noop}
      onLoadMoreRecentConversations={noop}
      onRetryRecentConversations={noop}
      onArchivedSessionClick={noop}
      onRestoreArchivedSession={noop}
      onDeleteArchivedSession={noop}
      onConversationResultClick={noop}
      onRenameRecentSession={noop}
      onToggleSessionPinned={noop}
      onRequestBatchArchive={noop}
      onRequestBatchPermanentDelete={noop}
      onRefresh={noop}
      isRefreshing={false}
      onCreateProject={noop}
      onCollapseSidebar={noop}
      updateAvailable={false}
      restartRequired={false}
      releaseInfo={null}
      latestVersion={null}
      onShowVersionModal={noop}
      onShowSettings={noop}
      projectListProps={{ currentTime: NOW, onDeleteSession: noop } as unknown as SidebarProjectListProps}
      t={t}
    />
  </SessionParentPickerProvider>,
);

/** Opens the row's desktop "…" menu: the mobile trigger renders first, the ActionMenu second. */
const openDesktopMenu = () => {
  const triggers = screen.getAllByRole('button', { name: 'sessions.sessionOptionsFor' });
  fireEvent.click(triggers[triggers.length - 1]);
};

// The "file under…" item also carries a description, so its accessible name is
// the label plus that description — match on the item's text instead.
const hasMenuItem = (label: string) =>
  screen.queryAllByRole('menuitem').some((item) => item.textContent?.includes(label));

test('an active hit offers "file under…"', () => {
  renderSearch([hit('solo')]);

  openDesktopMenu();

  assert.ok(hasMenuItem('sessions.fileUnderSession'), 'the hit row can be filed under another session');
  assert.ok(!hasMenuItem('sessions.moveSessionToTopLevel'), 'a top-level hit has nothing to move out of');
});

test('a filed hit offers "move to top level" instead', () => {
  renderSearch([hit('child', { parentSessionId: 'parent' })]);

  openDesktopMenu();

  assert.ok(hasMenuItem('sessions.moveSessionToTopLevel'), 'a hit that already has a parent can be moved out');
});

test('a hit that owns children withholds "file under…"', () => {
  const projects = [projectWith([{ id: 'child-of-hit', parentSessionId: 'hit' }])];
  renderSearch([hit('hit')], { projects });

  openDesktopMenu();

  assert.ok(
    !hasMenuItem('sessions.fileUnderSession'),
    'the tree is one level deep, so a session that owns children cannot be filed under another',
  );
});

test('an archived hit is offered no ownership actions', () => {
  renderSearch([hit('archived-hit', { isArchived: true })]);

  openDesktopMenu();

  assert.ok(!hasMenuItem('sessions.fileUnderSession'));
  assert.ok(!hasMenuItem('sessions.moveSessionToTopLevel'), 'the archive area shows no ownership at all');
});

test('the mobile sheet carries the same ownership rows as the menu', () => {
  renderSearch([hit('child', { parentSessionId: 'parent' })]);

  const [mobileTrigger] = screen.getAllByRole('button', { name: 'sessions.sessionOptionsFor' });
  fireEvent.click(mobileTrigger);

  assert.ok(screen.queryByText('sessions.moveSessionToTopLevel'), 'the mobile sheet mirrors the desktop menu');
});

test('filing a hit opens the parent picker without persisting anything yet', () => {
  const setSessionParent = vi.fn();
  renderSearch([hit('child')], { setSessionParent });

  const [mobileTrigger] = screen.getAllByRole('button', { name: 'sessions.sessionOptionsFor' });
  fireEvent.click(mobileTrigger);
  fireEvent.click(screen.getByText('sessions.fileUnderSession'));

  assert.ok(screen.queryByText('sessions.fileUnderSessionTitle'), 'the picker opens for the hit');
  assert.equal(setSessionParent.mock.calls.length, 0, 'opening the picker does not persist a parent by itself');
});
