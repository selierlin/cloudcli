import assert from 'node:assert/strict';

import { afterEach, beforeEach, test } from 'vitest';

import { buildChatSendOptions } from '@/modules/chat/utils/sendOptions';
import type { LLMProvider, PermissionMode, ProjectSession } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The side-question drawer sends through the same builder as the main composer.
 * `composerToolsSettingsResolution` proves the composer's lookup is
 * provider-scoped; this pins the two properties the drawer relies on: the
 * permission mode is always present (a missing one silently drops Claude to the
 * SDK default, stalling every tool on a prompt), and tool settings still follow
 * the sending provider.
 */

const SESSION: ProjectSession = { id: 'session-1', summary: 'Refactor the parser' };

type BuiltOptions = {
  model?: string;
  effort?: string;
  permissionMode?: string;
  skipPermissions?: boolean;
  toolsSettings?: { allowedTools?: string[]; disallowedTools?: string[]; skipPermissions?: boolean };
  sessionSummary?: string | null;
};

const resolveMode = (_provider: LLMProvider, mode: PermissionMode | string) => mode as PermissionMode;

const options = (provider: LLMProvider, input = 'why is this failing?'): BuiltOptions =>
  buildChatSendOptions({
    provider,
    model: 'claude-sonnet-4',
    effort: 'high',
    permissionMode: 'default',
    resolvePermissionModeForProvider: resolveMode,
    selectedSession: SESSION,
  }, input) as BuiltOptions;

beforeEach(() => {
  resetUserPreferences();
  localStorage.clear();
});

afterEach(() => {
  resetUserPreferences();
  localStorage.clear();
});

test('every drawer send carries the permission mode and the composer settings', () => {
  const built = options('claude');

  assert.equal(built.model, 'claude-sonnet-4');
  assert.equal(built.effort, 'high');
  assert.equal(built.permissionMode, 'default');
  assert.equal(built.skipPermissions, false);
  assert.deepEqual(built.toolsSettings, {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false,
  });
  assert.equal(built.sessionSummary, 'Refactor the parser');
});

test('skipPermissions follows the sending provider, not Claude', () => {
  writeUserPreference('claudePermissions', { allowedTools: ['Bash'], skipPermissions: true });
  writeUserPreference('opencodePermissions', { allowedTools: ['read'], skipPermissions: false });

  const claude = options('claude');
  assert.equal(claude.skipPermissions, true);
  assert.deepEqual(claude.toolsSettings?.allowedTools, ['Bash']);

  const opencode = options('opencode');
  assert.equal(opencode.skipPermissions, false);
  assert.deepEqual(opencode.toolsSettings?.allowedTools, ['read']);
});

test('the session summary falls back to the question when the title is empty', () => {
  const built = buildChatSendOptions({
    provider: 'claude',
    model: 'm',
    effort: 'low',
    permissionMode: 'default',
    resolvePermissionModeForProvider: resolveMode,
    selectedSession: { id: 'session-2' },
  }, '  a very   spaced question  ') as BuiltOptions;

  assert.equal(built.sessionSummary, 'a very spaced question');
});
