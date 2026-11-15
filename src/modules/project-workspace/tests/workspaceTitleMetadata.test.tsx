import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { AppTab, Project, ProjectSession } from '@/shared/types';

/**
 * The workspace header's second line carries what the sidebar used to say
 * before it slid away on a phone: the project, the branch/handful-of-changes
 * the working tree is on, and how old the open conversation is. Each field is
 * optional, so the cases below pin both what shows and what stays hidden.
 */

const state = vi.hoisted(() => ({
  gitSummary: null as { branch: string; changedFileCount: number } | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (
      key === 'mainContent.changedFiles' ? `${options?.count} changed files` : key
    ),
  }),
}));

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [] }),
}));

vi.mock('@/shared/ui', () => ({
  LLMProviderLogo: () => null,
}));

vi.mock('@/modules/project-workspace/hooks/useProjectGitSummary', () => ({
  useProjectGitSummary: () => state.gitSummary,
}));

const { default: WorkspaceTitle } = await import('@/modules/project-workspace/WorkspaceTitle');

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: [],
  sessionMeta: { hasMore: false, total: 0 },
};

const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const session: ProjectSession = {
  id: 'session-1',
  summary: 'A conversation',
  lastActivity: twoHoursAgo,
  __provider: 'claude',
  __projectId: 'project-1',
};

const renderTitle = (overrides: {
  activeTab?: AppTab;
  selectedSession?: ProjectSession | null;
} = {}) => render(
  <WorkspaceTitle
    activeTab={overrides.activeTab ?? 'chat'}
    selectedProject={project}
    selectedSession={overrides.selectedSession === undefined ? session : overrides.selectedSession}
    shouldShowTasksTab={false}
    onRenameSession={async () => true}
  />,
);

const metadataText = () => screen.getByRole('heading', { level: 2 }).nextElementSibling?.textContent ?? '';
const timeElement = () => document.querySelector('time');

test('the chat header names the project, its branch, the change count and the conversation age', () => {
  state.gitSummary = { branch: 'cloudcli-dev', changedFileCount: 7 };
  renderTitle();

  assert.equal(screen.getByText('repo').textContent, 'repo');
  assert.equal(screen.getByTitle('cloudcli-dev').textContent, 'cloudcli-dev');
  assert.ok(screen.getByText('7 changed files'));

  const time = timeElement();
  assert.equal(time?.textContent, '2hr');
  assert.equal(time?.getAttribute('datetime'), twoHoursAgo);
});

test('a project outside a repository keeps just its name', () => {
  state.gitSummary = null;
  // No activity stamp either, so the line is the project name and nothing else.
  renderTitle({ selectedSession: { id: 'session-1', summary: 'A conversation' } });

  assert.equal(metadataText(), 'repo');
  assert.equal(screen.queryByTitle('cloudcli-dev'), null);
  assert.equal(timeElement(), null);
});

test('a clean working tree shows the branch but not a zero count', () => {
  state.gitSummary = { branch: 'main', changedFileCount: 0 };
  renderTitle();

  assert.equal(screen.getByTitle('main').textContent, 'main');
  assert.equal(screen.queryByText('0 changed files'), null);
  assert.ok(!metadataText().includes('0'));
});

test('the conversation age is chat-only; other tabs still show the branch', () => {
  state.gitSummary = { branch: 'main', changedFileCount: 0 };
  renderTitle({ activeTab: 'files' });

  assert.equal(screen.getByTitle('main').textContent, 'main');
  assert.equal(timeElement(), null);
});
