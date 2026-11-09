import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { SESSION_OWNERSHIP_DRAG_MIME } from '@/shared/constants';
import type {
  LLMProvider,
  Project,
  ProjectSession,
  RecentConversationListItem,
  SessionAttentionLevel,
  SidebarProjectListProps,
} from '@/shared/types';

/**
 * Drag & drop in the Conversations tab is the mouse shortcut for what the row
 * menu's "file under…" / "move out" already does, even though this feed draws
 * no indent tree: a filed session shows the same "derived from" line either way.
 *
 * Two things differ from the project list and are pinned here:
 * - The feed is cross-project, so a row only accepts a drop from a session of
 *   its own project. The server compares project paths and refuses the rest, and
 *   two null project ids are deliberately not a match.
 * - A drag can be cancelled (Escape) without any dragleave, so the highlight
 *   belongs to the list. Leaving the list or ending the drag must clear it.
 */

const { SessionParentPickerProvider } = await import('@/modules/sidebar/context/SessionParentPickerContext');
const { default: SidebarRecentConversations } = await import('@/modules/sidebar/SidebarRecentConversations');

const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};
const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NO_SESSION_IDS: ReadonlySet<string> = new Set<string>();
const NO_ATTENTION: ReadonlyMap<string, SessionAttentionLevel> = new Map();

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

// `a` owns `c` in the project payloads, which is where this list derives the
// one-level rule from: `a` can adopt a child but cannot itself be dragged, `c`
// is a child and can only be dragged out. `x` lives in another project.
const PROJECTS = [
  {
    projectId: 'project-1',
    name: 'project-1',
    displayName: 'project one',
    fullPath: '/tmp/project-1',
    sessions: [
      { id: 'a', summary: 'session a' },
      { id: 'b', summary: 'session b' },
      { id: 'c', summary: 'session c', parentSessionId: 'a' },
    ],
  },
] as unknown as Project[];

const CONVERSATIONS: RecentConversationListItem[] = [
  conversation('a'),
  conversation('b'),
  conversation('c', { parentSessionId: 'a', parentTitle: 'title of a' }),
  conversation('x', { projectId: 'project-2', projectDisplayName: 'project two' }),
];

/** The DataTransfer jsdom does not implement; only what the handlers read. */
const dragData = (types: string[] = [SESSION_OWNERSHIP_DRAG_MIME]) => {
  const setDataCalls: Array<[string, string]> = [];
  return {
    types,
    setData: (format: string, value: string) => setDataCalls.push([format, value]),
    setDataCalls,
    effectAllowed: '',
    dropEffect: '',
  };
};

const renderList = (
  setSessionParent: (sessionId: string, parentSessionId: string | null) => void = noop,
  { withProvider = true }: { withProvider?: boolean } = {},
) => {
  const list = (
    <SidebarRecentConversations
      conversations={CONVERSATIONS}
      total={CONVERSATIONS.length}
      hasMore={false}
      isLoading={false}
      isLoadingMore={false}
      hasError={false}
      selectedSession={null as unknown as ProjectSession | null}
      activeSessions={NO_SESSION_IDS}
      backgroundSessionIds={NO_SESSION_IDS}
      attentionSessions={NO_ATTENTION}
      currentTime={NOW}
      onConversationSelect={noop}
      onLoadMore={noop}
      onRetry={noop}
      onRenameSession={noop}
      onTogglePinned={noop}
      onDeleteSession={noop}
      onRequestBatchArchive={noop}
      projects={PROJECTS}
      selectedProject={null}
      onNewSession={noop}
      t={t}
    />
  );

  return render(withProvider
    ? (
      <SessionParentPickerProvider projects={PROJECTS} setSessionParent={setSessionParent} t={t}>
        {list}
      </SessionParentPickerProvider>
    )
    : list);
};

const rowOf = (container: HTMLElement, sessionId: string) =>
  container.querySelector(`a[href="/session/${sessionId}"]`) as HTMLAnchorElement;
const listZoneOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="recent-conversations-list"]') as HTMLElement;

test('dropping a dragged conversation on another top-level row files it under that row', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  const source = rowOf(container, 'b');
  fireEvent.dragStart(source, { dataTransfer: data });
  assert.deepEqual(
    data.setDataCalls,
    [[SESSION_OWNERSHIP_DRAG_MIME, 'b']],
    'the drag carries a session payload so Firefox will start it',
  );
  assert.match(String(source.className), /opacity-50/, 'the row in flight fades');

  const target = rowOf(container, 'a');
  fireEvent.dragOver(target, { dataTransfer: data });
  assert.match(String(target.className), /ring-2/, 'the row under the drag marks itself as the drop target');

  fireEvent.drop(target, { dataTransfer: data });
  assert.deepEqual(setSessionParent.mock.calls, [['b', 'a']]);
  assert.doesNotMatch(String(rowOf(container, 'a').className), /ring-2/, 'the highlight clears once the drop lands');
});

test('dropping on blank space between the rows moves the session back to the top level', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });
  const listZone = listZoneOf(container);
  fireEvent.dragOver(listZone, { dataTransfer: data });
  assert.doesNotMatch(String(rowOf(container, 'a').className), /ring-2/, 'blank space is not a row');

  fireEvent.drop(listZone, { dataTransfer: data });
  assert.deepEqual(setSessionParent.mock.calls, [['b', null]]);
});

test('a child row is not a drop target and does not fall through to the move-out zone', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });
  const child = rowOf(container, 'c');
  fireEvent.dragOver(child, { dataTransfer: data });
  assert.doesNotMatch(String(child.className), /ring-2/, 'the tree is one level deep, so a child cannot adopt');

  fireEvent.drop(child, { dataTransfer: data });
  assert.equal(setSessionParent.mock.calls.length, 0, 'a row claims the drop, so it is not read as blank space');
});

test('a row cannot be dropped on itself', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  const row = rowOf(container, 'b');
  fireEvent.dragStart(row, { dataTransfer: data });
  fireEvent.dragOver(row, { dataTransfer: data });
  assert.doesNotMatch(String(row.className), /ring-2/);

  fireEvent.drop(row, { dataTransfer: data });
  assert.equal(setSessionParent.mock.calls.length, 0);
});

test('a row from another project never accepts the drop', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'x'), { dataTransfer: data });

  const foreignTarget = rowOf(container, 'a');
  fireEvent.dragOver(foreignTarget, { dataTransfer: data });
  assert.doesNotMatch(String(foreignTarget.className), /ring-2/, 'cross-project filing is refused by the server');

  fireEvent.drop(foreignTarget, { dataTransfer: data });
  assert.equal(setSessionParent.mock.calls.length, 0);
});

test('a cross-project row clears the highlight the earlier target held', () => {
  const { container } = renderList();
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });
  fireEvent.dragOver(rowOf(container, 'a'), { dataTransfer: data });
  assert.match(String(rowOf(container, 'a').className), /ring-2/);

  const foreign = rowOf(container, 'x');
  fireEvent.dragOver(foreign, { dataTransfer: data });
  assert.doesNotMatch(String(foreign.className), /ring-2/, 'a row of another project never offers itself');
  assert.doesNotMatch(
    String(rowOf(container, 'a').className),
    /ring-2/,
    'and the row the pointer left stops looking like a target',
  );
});

test('rows report whether they can be picked up', () => {
  const { container } = renderList();

  assert.equal(rowOf(container, 'b').getAttribute('draggable'), 'true', 'a plain top-level row drags');
  assert.equal(rowOf(container, 'c').getAttribute('draggable'), 'true', 'a child can be dragged back out');
  assert.equal(rowOf(container, 'a').getAttribute('draggable'), 'false', 'a row that owns children cannot be filed');
});

test('leaving the list during a drag clears the highlight', () => {
  const { container } = renderList();
  const data = dragData();

  const source = rowOf(container, 'b');
  fireEvent.dragStart(source, { dataTransfer: data });
  fireEvent.dragOver(rowOf(container, 'a'), { dataTransfer: data });
  assert.match(String(rowOf(container, 'a').className), /ring-2/);

  // A cancelled drag (Escape) fires no dragleave, so the end of the drag is
  // what has to drop the flag.
  fireEvent.dragEnd(source, { dataTransfer: data });
  assert.doesNotMatch(String(rowOf(container, 'a').className), /ring-2/, 'the highlight must not outlive the drag');
});

test('manage mode withdraws the drag from every row', () => {
  const { container } = renderList();

  fireEvent.click(screen.getByText('sessions.manageSessions'));

  assert.equal(rowOf(container, 'b').getAttribute('draggable'), 'false', 'dragging would fight batch selection');
  assert.equal(rowOf(container, 'a').getAttribute('draggable'), 'false');
});

test('without a parent-picker provider no row is draggable', () => {
  const { container } = renderList(noop, { withProvider: false });

  assert.equal(rowOf(container, 'b').getAttribute('draggable'), 'false');
});
