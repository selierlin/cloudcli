import assert from 'node:assert/strict';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import QuickSettingsCommandsTab from '@/modules/quick-settings-panel/QuickSettingsCommandsTab';
import { readCommandUsage } from '@/shared/commandUsage';
import type { SlashCommand } from '@/shared/types';
import { writeUserPreference } from '@/shared/userSettings';

/**
 * The Commands tab is ordered the way the composer's `/` menu is: what the user
 * picks most, then skills by scope (project before user before plugin), then
 * what ships with the app. These tests pin that order because the tab used to
 * render built-in first and lump every skill into one group.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const BUILT_IN: SlashCommand = { name: '/status', description: 'system status', type: 'built-in' };
const CUSTOM: SlashCommand = { name: '/ship', description: 'release checklist', type: 'custom' };
const PROJECT_SKILL: SlashCommand = {
  name: '/deploy-cloudcli',
  type: 'skill',
  namespace: 'project',
  metadata: { type: 'project', scope: 'project' },
};
const USER_SKILL: SlashCommand = {
  name: '/smart-review',
  type: 'skill',
  namespace: 'user',
  metadata: { type: 'user', scope: 'user' },
};
const PLUGIN_SKILL: SlashCommand = {
  name: '/lark-doc',
  type: 'skill',
  namespace: 'skill',
  metadata: { type: 'plugin', scope: 'plugin' },
};

const COMMANDS = [BUILT_IN, CUSTOM, PROJECT_SKILL, USER_SKILL, PLUGIN_SKILL];

const renderTab = (commands: SlashCommand[] = COMMANDS) => render(
  <QuickSettingsCommandsTab
    hasProject
    commands={commands}
    isLoading={false}
    hasError={false}
    onInsertCommand={() => undefined}
  />,
);

const headingNames = () => screen.queryAllByRole('heading').map((heading) => heading.textContent);

const groupOf = (labelKey: string) => {
  const heading = screen.getByRole('heading', { name: labelKey });
  const group = heading.parentElement;
  assert.ok(group, `the ${labelKey} heading sits in a group`);
  return within(group);
};

beforeEach(() => {
  writeUserPreference('commandUsage', {});
});

test('groups run frequent, project skills, user skills, other skills, built-in, custom', () => {
  renderTab();

  assert.deepEqual(headingNames(), [
    'quickSettings.commands.groups.projectSkills',
    'quickSettings.commands.groups.userSkills',
    'quickSettings.commands.groups.otherSkills',
    'quickSettings.commands.groups.builtIn',
    'quickSettings.commands.groups.custom',
  ]);
});

test('the most-used commands move to the top and leave their own group', () => {
  writeUserPreference('commandUsage', { '/ship': 4, '/deploy-cloudcli': 2 });

  renderTab();

  assert.equal(headingNames()[0], 'quickSettings.commands.groups.frequent');
  assert.deepEqual(
    groupOf('quickSettings.commands.groups.frequent').getAllByRole('button').map((row) => row.textContent),
    ['/shiprelease checklist', '/deploy-cloudcli'],
  );
  // Still exactly once each, not repeated under their original headings.
  assert.equal(screen.getAllByText('/ship').length, 1);
  assert.equal(screen.getAllByText('/deploy-cloudcli').length, 1);
});

test('usage recorded for a command this project does not offer is ignored', () => {
  writeUserPreference('commandUsage', { '/from-another-project': 9 });

  renderTab();

  assert.equal(headingNames()[0], 'quickSettings.commands.groups.projectSkills');
  assert.equal(screen.queryByText('/from-another-project'), null);
});

test('a search drops the frequent group and filters what is left', () => {
  writeUserPreference('commandUsage', { '/deploy-cloudcli': 2 });

  renderTab();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'smart' } });

  assert.deepEqual(headingNames(), ['quickSettings.commands.groups.userSkills']);
  assert.ok(screen.getByText('/smart-review'));
});

test('picking a command records the pick, the way the composer menu does', () => {
  renderTab();

  fireEvent.click(screen.getByText('/deploy-cloudcli'));

  assert.deepEqual(readCommandUsage(), { '/deploy-cloudcli': 1 });
  // …but the list does not reshuffle under the pointer: the new "frequent"
  // group shows up the next time the tab is opened.
  assert.equal(headingNames()[0], 'quickSettings.commands.groups.projectSkills');
  assert.deepEqual(
    groupOf('quickSettings.commands.groups.projectSkills').getAllByRole('button').map((row) => row.textContent),
    ['/deploy-cloudcli'],
  );
});
