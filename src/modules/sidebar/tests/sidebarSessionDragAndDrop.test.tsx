import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import { SESSION_OWNERSHIP_DRAG_MIME } from '@/shared/constants';
import type { Project, SessionAttentionLevel, SidebarProjectListProps } from '@/shared/types';

/**
 * Desktop drag & drop is the mouse shortcut for what the row menu's "file
 * under…" and "move to top level" do, so it has to reach the same callback with
 * the same arguments — and it must not fire for anything the menu cannot do: the
 * dragged row itself, a child row (only a top-level row can adopt), or a drag
 * that is not a session at all (a file from the desktop).
 *
 * There is no drag handle: the row *is* the drag source, so pressing the left
 * button and moving picks it up and nothing about the row changes on hover. The
 * list owns the drag state; the rows own the drop targets.
 */

const { SessionParentPickerProvider } = await import('@/modules/sidebar/context/SessionParentPickerContext');
const { default: SidebarProjectSessions } = await import('@/modules/sidebar/SidebarProjectSessions');
const { getAllSessions } = await import('@/modules/sidebar/utils/sidebarProjectFormatting');

const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};
const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NO_SESSION_IDS: ReadonlySet<string> = new Set<string>();
const NO_ATTENTION: ReadonlyMap<string, SessionAttentionLevel> = new Map();

// `a` owns `c`, so `a` can adopt a session but cannot itself be dragged; `b` is
// a plain top-level row and `c` is a child, which can only be moved out.
const PROJECT = {
  projectId: 'project-1',
  name: 'project-1',
  displayName: 'project one',
  fullPath: '/tmp/project-1',
  sessions: [
    { id: 'a', summary: 'session a', lastActivity: '2026-08-21T09:59:00.000Z' },
    { id: 'b', summary: 'session b', lastActivity: '2026-08-21T09:58:00.000Z' },
    { id: 'c', summary: 'session c', lastActivity: '2026-08-21T09:57:00.000Z', parentSessionId: 'a' },
  ],
} as unknown as Project;

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
  setSessionParent: (sessionId: string, parentSessionId: string | null) => void,
  { isManaging = false, withProvider = true }: { isManaging?: boolean; withProvider?: boolean } = {},
) => {
  const list = (
    <SidebarProjectSessions
      project={PROJECT}
      isExpanded
      isManaging={isManaging}
      onManagingChange={noop}
      sessions={getAllSessions(PROJECT)}
      selectedSession={null}
      initialSessionsLoaded
      hasMoreSessions={false}
      isLoadingMoreSessions={false}
      activeSessions={NO_SESSION_IDS}
      backgroundSessionIds={NO_SESSION_IDS}
      attentionSessions={NO_ATTENTION}
      currentTime={NOW}
      sessionRenameId={null}
      sessionRenameDraft=""
      onRenameDraftChange={noop}
      onStartEditingSession={noop}
      onCancelEditingSession={noop}
      onSaveEditingSession={noop}
      onProjectSelect={noop}
      onSessionSelect={noop}
      onDeleteSession={noop}
      onLoadMoreSessions={noop}
      onNewSession={noop}
      t={t}
    />
  );

  return render(withProvider
    ? (
      <SessionParentPickerProvider projects={[PROJECT]} setSessionParent={setSessionParent} t={t}>
        {list}
      </SessionParentPickerProvider>
    )
    : list);
};

const rowOf = (container: HTMLElement, sessionId: string) =>
  container.querySelector(`a[href="/session/${sessionId}"]`) as HTMLAnchorElement;
const listZoneOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="project-session-list"]') as HTMLElement;

test('dropping a dragged session on a top-level row files it under that row', () => {
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

  const target = rowOf(container, 'a');
  fireEvent.dragOver(target, { dataTransfer: data });
  assert.match(String(target.className), /ring-2/, 'the row under the drag marks itself as the drop target');

  fireEvent.drop(target, { dataTransfer: data });

  assert.deepEqual(setSessionParent.mock.calls, [['b', 'a']]);
});

test('the row being dragged fades, and stops fading once the drag ends', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();
  // `opacity-50` is also part of the button variant's `disabled:` utilities, so
  // the check has to be an exact class token, not a substring.
  const fades = (sessionId: string) => rowOf(container, sessionId).className.split(/\s+/).includes('opacity-50');

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });
  assert.ok(
    fades('b'),
    'the source row is the only in-flight signal, so it has to stand out from its siblings',
  );
  assert.ok(!fades('a'), 'a sibling that is not being dragged stays at full opacity');

  fireEvent.dragEnd(rowOf(container, 'b'), { dataTransfer: data });
  assert.ok(!fades('b'), 'the fade is dropped with the drag');
});

test('dropping a dragged session on the list blank space moves it back to the top level', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'c'), { dataTransfer: data });
  fireEvent.drop(listZoneOf(container), { dataTransfer: data });

  assert.deepEqual(setSessionParent.mock.calls, [['c', null]]);
});

test('a child row is inert: dropping onto it neither files nor moves the session out', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });

  const child = rowOf(container, 'c');
  fireEvent.dragOver(child, { dataTransfer: data });
  fireEvent.drop(child, { dataTransfer: data });

  assert.equal(
    setSessionParent.mock.calls.length,
    0,
    'the drag stops at the child row instead of reaching the list\'s move-out zone',
  );
});

test('a row is not a drop target for its own drag', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  const self = rowOf(container, 'b');
  fireEvent.dragStart(self, { dataTransfer: data });
  fireEvent.dragOver(self, { dataTransfer: data });
  fireEvent.drop(self, { dataTransfer: data });

  assert.equal(setSessionParent.mock.calls.length, 0, 'a session is never filed under itself');
});

test('a drag that carries no session payload is ignored', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const files = dragData(['Files']);

  const target = rowOf(container, 'b');
  fireEvent.dragOver(target, { dataTransfer: files });
  fireEvent.drop(target, { dataTransfer: files });
  fireEvent.drop(listZoneOf(container), { dataTransfer: files });

  assert.equal(setSessionParent.mock.calls.length, 0, 'a desktop file drop must not re-parent a session');
});

test('moving off a row onto the blank space drops the highlight without filing anything', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });
  const target = rowOf(container, 'a');
  fireEvent.dragOver(target, { dataTransfer: data });
  assert.match(String(target.className), /ring-2/);

  fireEvent.dragOver(listZoneOf(container), { dataTransfer: data });
  assert.doesNotMatch(
    String(target.className),
    /ring-2/,
    'only the row under the pointer stays highlighted, so the blank space has to clear the previous one',
  );
  assert.equal(setSessionParent.mock.calls.length, 0);
});

test('a cancelled drag clears the highlight instead of stranding it', () => {
  const setSessionParent = vi.fn();
  const { container } = renderList(setSessionParent);
  const data = dragData();

  fireEvent.dragStart(rowOf(container, 'b'), { dataTransfer: data });
  const target = rowOf(container, 'a');
  fireEvent.dragOver(target, { dataTransfer: data });
  assert.match(String(target.className), /ring-2/);

  // Escape (and any drop outside a target) ends the drag with no dragleave at
  // all, so the highlight cannot be owned by the row.
  fireEvent.dragEnd(rowOf(container, 'b'), { dataTransfer: data });

  assert.doesNotMatch(String(target.className), /ring-2/, 'an abandoned drag must not leave a ring behind');
  assert.equal(setSessionParent.mock.calls.length, 0);
});

test('a session that owns children is not a drag source', () => {
  const { container } = renderList(vi.fn());

  assert.equal(rowOf(container, 'b').getAttribute('draggable'), 'true', 'a plain top-level row drags');
  assert.equal(rowOf(container, 'c').getAttribute('draggable'), 'true', 'a child row can be dragged out from under its parent');
  assert.equal(
    rowOf(container, 'a').getAttribute('draggable'),
    'false',
    'a session that owns children cannot be filed under another — the tree is one level deep',
  );
});

test('manage mode makes no row a drag source', () => {
  const { container } = renderList(vi.fn(), { isManaging: true });

  for (const id of ['a', 'b', 'c']) {
    assert.equal(rowOf(container, id).getAttribute('draggable'), 'false');
  }
});

test('without the picker provider there is nothing to drag with', () => {
  const { container } = renderList(vi.fn(), { withProvider: false });

  for (const id of ['a', 'b', 'c']) {
    assert.equal(rowOf(container, id).getAttribute('draggable'), 'false');
  }
});

test('a row carries no drag affordance of its own: no handle and no hover layout shift', () => {
  const { container } = renderList(vi.fn());

  assert.equal(
    container.querySelectorAll('[data-testid="session-drag-handle"]').length,
    0,
    'the handle is gone — the row is the drag source',
  );
  assert.doesNotMatch(
    String(rowOf(container, 'b').className),
    /group-hover:pl-7/,
    'nothing about the row shifts on hover any more',
  );
});
