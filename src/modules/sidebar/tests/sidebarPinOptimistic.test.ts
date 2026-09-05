import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project, ProjectSession, RecentConversationListItem } from '@/shared/types';
import {
  applyOptimisticSessionPinState,
  reorderRecentConversationsForPin,
} from '@/modules/sidebar/utils/sidebarProjectFormatting';

const makeSession = (id: string, isPinned = false): ProjectSession => ({
  id,
  summary: `session ${id}`,
  __provider: 'claude',
  isPinned,
  lastActivity: '2026-09-04T10:00:00.000Z',
});

const makeProject = (projectId: string, sessions: ProjectSession[]): Project => ({
  projectId,
  displayName: projectId,
  path: `/tmp/${projectId}`,
  fullPath: `/tmp/${projectId}`,
  sessions,
});

const makeConversation = (
  sessionId: string,
  isPinned: boolean,
  order: number,
): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'p1',
  projectDisplayName: 'p1',
  sessionTitle: `title ${sessionId}`,
  lastActivity: `2026-09-0${order}T10:00:00.000Z`,
  isPinned,
});

test('applyOptimisticSessionPinState returns the input unchanged for an empty map', () => {
  const project = makeProject('p1', [makeSession('s1')]);
  const projects = [project];

  assert.equal(applyOptimisticSessionPinState(projects, new Map()), projects);
});

test('applyOptimisticSessionPinState only rebuilds the project that owns the session', () => {
  const projectA = makeProject('a', [makeSession('s1', false)]);
  const projectB = makeProject('b', [makeSession('s2', false)]);
  const projects = [projectA, projectB];

  const result = applyOptimisticSessionPinState(projects, new Map([['s1', true]]));

  assert.notEqual(result[0], projectA, 'owning project is rebuilt');
  assert.equal(result[0].sessions?.[0].id, 's1');
  assert.equal(result[0].sessions?.[0].isPinned, true);
  assert.equal(result[1], projectB, 'untouched project keeps its identity');
});

test('applyOptimisticSessionPinState keeps a session object when the server already agrees', () => {
  const project = makeProject('a', [makeSession('s1', true)]);
  const projects = [project];
  const originalSession = projects[0].sessions?.[0];

  const result = applyOptimisticSessionPinState(projects, new Map([['s1', true]]));

  assert.equal(result[0], project, 'agreed project keeps its identity');
  assert.equal(result[0].sessions?.[0], originalSession, 'agreed session keeps its identity');
});

test('reorderRecentConversationsForPin returns the input unchanged for a missing session', () => {
  const conversations = [makeConversation('s1', false, 1)];
  assert.equal(reorderRecentConversationsForPin(conversations, 'nope', true), conversations);
});

test('reorderRecentConversationsForPin pins a conversation and moves it above unpinned ones', () => {
  const conversations = [
    makeConversation('s1', false, 1),
    makeConversation('s2', true, 2),
    makeConversation('s3', false, 3),
  ];

  const result = reorderRecentConversationsForPin(conversations, 's1', true);

  assert.deepEqual(result.map((c) => c.sessionId), ['s1', 's2', 's3']);
  assert.equal(result.find((c) => c.sessionId === 's1')?.isPinned, true);
});

test('reorderRecentConversationsForPin unpins a conversation and moves it below pinned ones', () => {
  const conversations = [
    makeConversation('s2', true, 2),
    makeConversation('s1', true, 1),
    makeConversation('s3', false, 3),
  ];

  const result = reorderRecentConversationsForPin(conversations, 's1', false);

  assert.deepEqual(result.map((c) => c.sessionId), ['s2', 's1', 's3']);
  assert.equal(result.find((c) => c.sessionId === 's1')?.isPinned, false);
});
