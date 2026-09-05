import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project, SessionWithProvider } from '@/shared/types';
import {
  filterProjects,
  filterSessionsForProject,
} from '@/modules/sidebar/utils/sidebarProjectFormatting';

const makeProject = (projectId: string, sessionIds: string[], provider = 'claude'): Project => ({
  projectId,
  displayName: projectId,
  name: projectId,
  path: `/tmp/${projectId}`,
  fullPath: `/tmp/${projectId}`,
  sessions: sessionIds.map((id) => ({
    id,
    summary: `${provider} session about ${id}`,
    __provider: provider,
    lastActivity: '2026-09-04T10:00:00.000Z',
  })),
}) as unknown as Project;

test('filterProjects keeps projects matched by name or path', () => {
  const projects = [makeProject('alpha', ['a1']), makeProject('beta', ['b1'])];

  assert.deepEqual(filterProjects(projects, 'alpha').map((project) => project.projectId), ['alpha']);
  assert.deepEqual(filterProjects(projects, 'tmp/beta').map((project) => project.projectId), ['beta']);
});

test('filterProjects surfaces a project through its session title', () => {
  const projects = [makeProject('alpha', ['a1']), makeProject('beta', ['b1'])];

  // "b1" only appears in beta's session title; matching is case-insensitive.
  assert.deepEqual(filterProjects(projects, 'B1').map((project) => project.projectId), ['beta']);
});

test('filterProjects surfaces a project through its session provider', () => {
  const projects = [makeProject('alpha', ['a1'], 'claude'), makeProject('beta', ['b1'], 'workbuddy')];

  assert.deepEqual(filterProjects(projects, 'workbuddy').map((project) => project.projectId), ['beta']);
  assert.deepEqual(filterProjects(projects, 'Claude').map((project) => project.projectId), ['alpha']);
});

test('filterProjects returns everything for an empty query and nothing when nothing matches', () => {
  const projects = [makeProject('alpha', ['a1']), makeProject('beta', ['b1'])];

  assert.equal(filterProjects(projects, '').length, 2);
  assert.deepEqual(filterProjects(projects, 'no-such-token'), []);
});

test('filterSessionsForProject narrows to matching sessions only for session-matched projects', () => {
  const project = makeProject('alpha', ['a1', 'a2', 'b2']);

  // The project survived through a session match, so only matching sessions show.
  const narrowed = filterSessionsForProject(project, false, 'b2');
  assert.deepEqual(narrowed.map((session) => session.id), ['b2']);

  // The project matched by name/path, so every loaded session stays visible.
  const full = filterSessionsForProject(project, true, 'b2');
  assert.deepEqual(full.map((session) => session.id), ['a1', 'a2', 'b2']);

  // No query returns the full list.
  const noQuery = filterSessionsForProject(project, false, '  ');
  assert.deepEqual(noQuery.map((session) => session.id), ['a1', 'a2', 'b2']);
});

test('filterSessionsForProject matches sessions by title or provider', () => {
  const project = makeProject('alpha', ['a1', 'a2'], 'workbuddy');
  const sessions = project.sessions as unknown as SessionWithProvider[];

  assert.deepEqual(filterSessionsForProject(project, false, 'workbuddy').map((s) => s.id), ['a1', 'a2']);
  assert.deepEqual(filterSessionsForProject(project, false, 'about a1').map((s) => s.id), ['a1']);
  assert.equal(sessions.length, 2);
});
