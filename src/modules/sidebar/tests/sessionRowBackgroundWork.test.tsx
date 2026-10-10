import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, SessionAttentionLevel, SessionWithProvider, SidebarProjectListProps } from '@/shared/types';

/**
 * A session row carries two independent channels. The left edge only answers
 * "is it doing something?" — a spinning ring while a response is in flight, the
 * purple pulse of the workflow and agent cards while only background work runs.
 * The right edge only answers "is something waiting on me?" — an amber capsule
 * for a permission request, a blue dot for passive activity. They are drawn on
 * opposite ends so neither can displace the other; opening the session (it
 * becomes selected) silences both. The destructive-action lockout stays
 * reserved for a response in flight.
 */

const recordedOptionsProps: Record<string, unknown>[] = [];

vi.mock('@/modules/sidebar/SessionOptions', () => ({
  default: (props: Record<string, unknown>) => {
    recordedOptionsProps.push(props);
    return null;
  },
}));

const { default: SidebarSessionItem } = await import('@/modules/sidebar/SidebarSessionItem');

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

/**
 * A marker's `h-*`/`w-*` only takes effect on a block-level box. Inside
 * Tooltip's `inline-block` wrapper the marker is not blockified for us, so a
 * bare `<span>` collapses to nothing and the indicator silently vanishes.
 * Tokenised so `flex-shrink-0` cannot pass itself off as `flex`.
 */
const DISPLAY_TOKENS = new Set(['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'flow-root', 'table', 'contents']);
const ownDisplay = (el: Element): boolean =>
  String(el.className).split(/\s+/).some((token) => DISPLAY_TOKENS.has(token));

const PROJECT = { projectId: 'project-1', name: 'project-1', displayName: 'project one', fullPath: '/tmp/project-1', sessions: [] } as unknown as Project;
const SESSION = { id: 's1', summary: 'session one', lastActivity: '2026-08-21T09:59:00.000Z', __provider: 'claude' } as unknown as SessionWithProvider;

const renderRow = (state: { isProcessing: boolean; hasBackgroundWork: boolean; attentionLevel?: SessionAttentionLevel; selected?: boolean }) => render(
  React.createElement(SidebarSessionItem, {
    project: PROJECT,
    session: SESSION,
    selectedSession: state.selected ? SESSION : null,
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
    t,
    ...state,
  }),
);

beforeEach(() => {
  recordedOptionsProps.length = 0;
});

test('background work shows as a purple dot on the left edge, with nothing spinning', () => {
  const { container } = renderRow({ isProcessing: false, hasBackgroundWork: true });

  const dot = container.querySelector('[role="status"].bg-purple-500');
  assert.ok(dot, 'the background row carries the purple dot');
  assert.ok(ownDisplay(dot), 'the purple dot lays out its own box');
  assert.equal(dot.getAttribute('aria-label'), 'tooltips.backgroundWorkIndicator');
  assert.equal(container.querySelectorAll('.animate-spin').length, 0);
  assert.equal(recordedOptionsProps.at(-1)?.isProcessing, false, 'the row is not locked the way a responding one is');
});

test('a response in flight shows a spinning ring instead of the purple dot', () => {
  const { container } = renderRow({ isProcessing: true, hasBackgroundWork: false });

  assert.ok(container.querySelector('[role="status"].bg-purple-500') === null, 'the ring replaces the dot');
  const ring = container.querySelector('[role="status"]');
  assert.ok(ring);
  assert.equal(ring.getAttribute('aria-label'), 'tooltips.processingSessionIndicator');
  assert.equal(container.querySelectorAll('.animate-spin').length, 1);
  assert.equal(recordedOptionsProps[0].isProcessing, true);
});

test('a response in flight outranks background work on the single left slot', () => {
  const { container } = renderRow({ isProcessing: true, hasBackgroundWork: true });

  assert.ok(container.querySelector('[role="status"].bg-purple-500') === null, 'the ring wins over the dot');
  assert.equal(container.querySelectorAll('.animate-spin').length, 1);
});

test('a selected row shows neither channel — the content area already owns it', () => {
  const { container } = renderRow({
    isProcessing: true,
    hasBackgroundWork: true,
    attentionLevel: 'action',
    selected: true,
  });

  // assert.equal(<jsdom node>, null) would try to describe the node on failure
  // and kill the vitest worker — assert.ok keeps the failure a plain red.
  assert.ok(container.querySelector('[role="status"]') === null, 'a selected row must not render a status marker');
});

test('the activity and unread channels coexist on opposite edges', () => {
  const { container } = renderRow({ isProcessing: false, hasBackgroundWork: true, attentionLevel: 'action' });

  assert.ok(container.querySelector('[role="status"].bg-purple-500'), 'the left-edge activity dot keeps its place');
  assert.ok(container.querySelector('[role="status"].bg-amber-500'), 'the right-edge unread capsule is drawn too');
});

test('the action level draws an amber capsule and the notice level a blue dot', () => {
  const action = renderRow({ isProcessing: false, hasBackgroundWork: false, attentionLevel: 'action' });
  const capsule = action.container.querySelector('[role="status"].bg-amber-500');
  assert.ok(capsule, 'action is an amber capsule');
  assert.ok(ownDisplay(capsule), 'the capsule lays out its own box');
  assert.ok(capsule.querySelector('svg'), 'the capsule carries an icon so colour is not the only cue');
  assert.equal(capsule.getAttribute('aria-label'), 'tooltips.attentionActionIndicator');
  action.unmount();

  const notice = renderRow({ isProcessing: false, hasBackgroundWork: false, attentionLevel: 'notice' });
  const dot = notice.container.querySelector('[role="status"].bg-blue-500');
  assert.ok(dot, 'notice is a blue dot, distinct from the amber capsule');
  assert.ok(ownDisplay(dot), 'the notice dot lays out its own box');
  assert.ok(!dot.className.includes('animate-pulse'), 'the notice dot is static');
});

test('an unread row bolds its title, a read one does not', () => {
  const read = renderRow({ isProcessing: false, hasBackgroundWork: false });
  assert.ok(read.container.querySelector('.truncate.text-sm')?.className.includes('font-normal'));
  read.unmount();

  const unread = renderRow({ isProcessing: false, hasBackgroundWork: false, attentionLevel: 'notice' });
  assert.ok(unread.container.querySelector('.truncate.text-sm')?.className.includes('font-bold'));
});
