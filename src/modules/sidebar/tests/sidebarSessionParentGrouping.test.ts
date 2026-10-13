import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project, SessionWithProvider } from '@/shared/types';
import {
  applyOptimisticSessionParentState,
  groupSessionsByParent,
} from '@/modules/sidebar/utils/sidebarProjectFormatting';

const makeSession = (id: string, parentSessionId: string | null = null): SessionWithProvider => ({
  id,
  summary: `session ${id}`,
  __provider: 'claude',
  parentSessionId,
  lastActivity: '2026-09-04T10:00:00.000Z',
});

const makeProject = (projectId: string, sessions: SessionWithProvider[]): Project => ({
  projectId,
  displayName: projectId,
  path: `/tmp/${projectId}`,
  fullPath: `/tmp/${projectId}`,
  sessions,
});

test('groupSessionsByParent nests a child under its parent and keeps input order', () => {
  const tree = groupSessionsByParent([
    makeSession('a'),
    makeSession('b'),
    makeSession('b-child', 'b'),
    makeSession('c'),
  ]);

  assert.deepEqual(
    tree.map((row) => row.session.id),
    ['a', 'b', 'c'],
    'roots keep their input order',
  );
  assert.deepEqual(
    tree[1].children.map((session) => session.id),
    ['b-child'],
    'the child hangs off its parent',
  );
  assert.deepEqual(tree[0].children, []);
});

test('groupSessionsByParent keeps sibling order as given', () => {
  const tree = groupSessionsByParent([
    makeSession('parent'),
    makeSession('child-2', 'parent'),
    makeSession('child-1', 'parent'),
  ]);

  assert.deepEqual(
    tree[0].children.map((session) => session.id),
    ['child-2', 'child-1'],
    'siblings are not re-sorted; the caller passes them in display order',
  );
});

test('groupSessionsByParent renders a child as a root when its parent is absent', () => {
  // Covers an unloaded page, an archived or deleted parent, and a parent
  // removed by the active search: all reduce to "the parent is not in the list".
  const tree = groupSessionsByParent([makeSession('orphan', 'missing-parent'), makeSession('a')]);

  assert.deepEqual(tree.map((row) => row.session.id), ['orphan', 'a']);
  assert.deepEqual(tree[0].children, []);
});

test('groupSessionsByParent does not nest below a session that is itself a child', () => {
  // The server keeps the tree one level deep, so this shape is defensive only —
  // the grandchild must not render indented under a non-root parent.
  const tree = groupSessionsByParent([
    makeSession('a'),
    makeSession('b', 'a'),
    makeSession('c', 'b'),
  ]);

  assert.deepEqual(tree.map((row) => row.session.id), ['a', 'c']);
  assert.deepEqual(tree[0].children.map((session) => session.id), ['b']);
  assert.deepEqual(tree[1].children, []);
});

test('groupSessionsByParent returns an empty tree for an empty list', () => {
  assert.deepEqual(groupSessionsByParent([]), []);
});

test('applyOptimisticSessionParentState returns the input unchanged for an empty map', () => {
  const projects = [makeProject('p1', [makeSession('s1')])];

  assert.equal(applyOptimisticSessionParentState(projects, new Map()), projects);
});

test('applyOptimisticSessionParentState only rebuilds the project that owns the session', () => {
  const projectA = makeProject('a', [makeSession('s1')]);
  const projectB = makeProject('b', [makeSession('s2')]);
  const projects = [projectA, projectB];

  const result = applyOptimisticSessionParentState(projects, new Map([['s1', 's9']]));

  assert.notEqual(result[0], projectA, 'owning project is rebuilt');
  assert.equal(result[0].sessions?.[0].parentSessionId, 's9');
  assert.equal(result[1], projectB, 'untouched project keeps its identity');
});

test('applyOptimisticSessionParentState treats null as a real override (make it a root)', () => {
  const project = makeProject('a', [makeSession('s1', 'p1')]);

  const result = applyOptimisticSessionParentState([project], new Map([['s1', null]]));

  assert.equal(result[0].sessions?.[0].parentSessionId, null);
});

test('applyOptimisticSessionParentState keeps a session object when the server already agrees', () => {
  const project = makeProject('a', [makeSession('s1', null)]);
  const originalSession = project.sessions?.[0];

  const result = applyOptimisticSessionParentState([project], new Map([['s1', null]]));

  assert.equal(result[0], project, 'agreed project keeps its identity');
  assert.equal(result[0].sessions?.[0], originalSession, 'agreed session keeps its identity');
});
