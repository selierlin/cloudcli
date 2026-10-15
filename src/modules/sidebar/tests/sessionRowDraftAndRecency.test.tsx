import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, SessionAttentionLevel, SessionWithProvider, SidebarProjectListProps } from '@/shared/types';

/**
 * Two additions to the session row's right edge, both independent of the unread
 * channel.
 *
 * A pen marks a scope that holds input the user wrote but never sent; it is
 * sticky and, unlike the unread dot, is not consumed by opening the session —
 * only sending or clearing the draft removes it. A faint background tint marks
 * a row whose content changed very recently, so a session glanced at but not
 * answered stays findable; it decays on its own and never touches the dot.
 * Neither may be confused with the blue notice dot or the amber action capsule,
 * which is why the draft marker is a distinct shape on the right edge.
 */

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      drafts: async () => new Response(JSON.stringify({ success: true, drafts: [] }), { status: 200 }),
      saveDraft: async () => new Response('{}', { status: 200 }),
      deleteDraft: async () => new Response('{}', { status: 200 }),
    },
  },
}));

vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: () => null,
}));

const { default: SidebarSessionItem } = await import('@/modules/sidebar/SidebarSessionItem');
const { writeDraftText, writeQueuedMessage, resetChatDrafts } = await import('@/shared/chatDrafts');

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

/** `h-*`/`w-*` only take effect on a block-level box; Tooltip's wrapper does not blockify for us. */
const DISPLAY_TOKENS = new Set(['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root', 'table', 'contents']);
const ownDisplay = (el: Element): boolean =>
  String(el.className).split(/\s+/).some((token) => DISPLAY_TOKENS.has(token));

const PROJECT = { projectId: 'project-1', name: 'project-1', displayName: 'project one', fullPath: '/tmp/project-1', sessions: [] } as unknown as Project;

const renderRow = (state: {
  attentionLevel?: SessionAttentionLevel;
  selected?: boolean;
  contentUpdatedAt?: string | null;
} = {}) => {
  const session = {
    id: 's1',
    summary: 'session one',
    lastActivity: '2026-08-21T09:59:00.000Z',
    contentUpdatedAt: state.contentUpdatedAt ?? null,
    __provider: 'claude',
  } as unknown as SessionWithProvider;

  return render(
    React.createElement(SidebarSessionItem, {
      project: PROJECT,
      session,
      selectedSession: state.selected ? session : null,
      isManaging: false,
      isBatchSelected: false,
      attentionLevel: state.attentionLevel,
      currentTime: NOW,
      isEditing: false,
      renameDraft: '',
      onRenameDraftChange: noop,
      onStartEditingSession: noop,
      onCancelEditingSession: noop,
      onSaveEditingSession: noop,
      onProjectSelect: noop,
      onSessionSelect: noop,
      onTogglePinned: noop,
      onToggleBatchSelection: noop,
      onDeleteSession: noop,
      draggingSessionId: null,
      isDropHighlighted: false,
      onSessionDragStart: noop,
      onSessionDragEnd: noop,
      onSessionDragOver: noop,
      onSessionDropOnRow: noop,
      t,
    }),
  );
};

const rowElement = (container: HTMLElement): Element => {
  const row = container.querySelector('a');
  assert.ok(row, 'the desktop row is rendered');
  return row;
};

beforeEach(() => {
  resetChatDrafts();
});

afterEach(() => {
  resetChatDrafts();
});

test('an unsent draft draws a pen beside the unread dot, and the two coexist', () => {
  writeDraftText('s1', 'half a thought');

  const { container } = renderRow({ attentionLevel: 'notice' });

  assert.equal(container.querySelectorAll('[role="status"]').length, 2, 'the pen and the dot are separate markers');

  const pen = container.querySelector('[role="status"][aria-label="tooltips.draftIndicator"]');
  assert.ok(pen, 'the draft marker is drawn');
  assert.ok(pen.querySelector('svg'), 'the pen is a shape, not a bare colour');
  assert.ok(ownDisplay(pen), 'the marker lays out its own box inside the tooltip wrapper');

  assert.ok(container.querySelector('[role="status"].bg-blue-500'), 'the notice dot keeps its place');
});

test('opening the session hides the draft pen and the unread dot alike', () => {
  writeDraftText('s1', 'half a thought');

  const { container } = renderRow({ attentionLevel: 'notice', selected: true });

  assert.equal(container.querySelectorAll('[role="status"]').length, 0);
});

test('blank input never draws the pen', () => {
  writeDraftText('s1', '   ');

  const { container } = renderRow();

  assert.equal(container.querySelector('[aria-label="tooltips.draftIndicator"]'), null);
});

test('a queued message counts as an unsent draft', () => {
  writeQueuedMessage('s1', { content: 'queued' });

  const { container } = renderRow();

  assert.ok(container.querySelector('[aria-label="tooltips.draftIndicator"]'));
});

test('a session whose content just changed carries the faint recency tint', () => {
  const recent = renderRow({ contentUpdatedAt: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString() });
  assert.ok(rowElement(recent.container).className.includes('bg-primary/5'));
  recent.unmount();

  const stale = renderRow({ contentUpdatedAt: new Date(NOW.getTime() - 15 * 60 * 1000).toISOString() });
  assert.ok(!rowElement(stale.container).className.includes('bg-primary/5'));
});

test('a session with no content timestamp never tints', () => {
  const { container } = renderRow({ contentUpdatedAt: null });

  assert.ok(!rowElement(container).className.includes('bg-primary/5'));
});

test('the recency tint is withheld on the open row', () => {
  const { container } = renderRow({
    selected: true,
    contentUpdatedAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
  });

  assert.ok(!rowElement(container).className.includes('bg-primary/5'));
});

test('the recency tint never draws a marker of its own', () => {
  const { container } = renderRow({ contentUpdatedAt: new Date(NOW.getTime() - 60 * 1000).toISOString() });

  assert.equal(container.querySelectorAll('[role="status"]').length, 0, 'the tint is a background, not an indicator');
});
