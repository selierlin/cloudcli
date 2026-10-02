import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, vi } from 'vitest';
import type { RefObject } from 'react';

import { useSlashCommands } from '@/modules/chat/hooks/useSlashCommands';
import {
  hydrateUserPreferences,
  readUserPreference,
  resetUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';
import type { Project } from '@/shared/types';

/**
 * Guards the move of the command/skill usage count out of the per-project
 * `command_history_<projectId>` localStorage key and into the synced
 * `commandUsage` preference.
 *
 * The load-bearing contract here is that "frequent" is derived from the
 * project's own scanned command list, never from the global usage map on its
 * own — that is what keeps a project-level skill, or a name recorded in some
 * other project, from surfacing where it does not belong.
 */

const mocks = vi.hoisted(() => ({
  listCommands: vi.fn(),
  listSkills: vi.fn(),
  preferences: vi.fn(),
  savePreferences: vi.fn(),
}));

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

vi.mock('@/shared/api', () => ({
  api: {
    commands: { list: mocks.listCommands, execute: vi.fn() },
    providers: { skills: mocks.listSkills },
    user: { preferences: mocks.preferences, savePreferences: mocks.savePreferences },
  },
}));

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

/** The scanned command + skill list every render starts from. */
const SCANNED_COMMANDS = [
  { name: '/help', description: 'Help' },
  { name: '/custom', description: 'A custom command' },
  { name: '/review', description: 'A project-level skill' },
];

beforeEach(() => {
  resetUserPreferences();
  localStorage.clear();

  mocks.listCommands.mockResolvedValue(
    jsonResponse({
      builtIn: [{ name: '/help', description: 'Help' }],
      custom: [{ name: '/custom', description: 'A custom command' }],
    }),
  );
  mocks.listSkills.mockResolvedValue(
    jsonResponse({
      success: true,
      data: { skills: [{ name: 'review', command: '/review', scope: 'project' }] },
    }),
  );
  mocks.preferences.mockResolvedValue(jsonResponse({ preferences: {} }));
  mocks.savePreferences.mockResolvedValue(jsonResponse({ success: true }));
});

const renderSlashCommands = async () => {
  const textareaRef = { current: null } as RefObject<HTMLTextAreaElement>;
  const { result, rerender } = renderHook(() =>
    useSlashCommands({
      selectedProject: PROJECT,
      provider: 'claude',
      input: '',
      setInput: vi.fn(),
      textareaRef,
      onExecuteCommand: vi.fn(),
    }),
  );

  await waitFor(() => {
    assert.equal(result.current.slashCommands.length, SCANNED_COMMANDS.length);
  });

  return { result, rerender };
};

describe('command usage sync', () => {
  it('keeps a recorded name out of the menu when this project does not expose it', async () => {
    // '/gone' was recorded elsewhere, or belongs to a project-level skill this
    // project does not have. It must not reach the frequent group.
    writeUserPreference('commandUsage', { '/gone': 9, '/review': 2 });

    const { result } = await renderSlashCommands();

    assert.deepEqual(
      result.current.frequentCommands.map((command) => command.name),
      ['/review'],
    );
    // Sorting only reorders the scanned list — it never adds an element.
    assert.equal(result.current.slashCommands.length, SCANNED_COMMANDS.length);
  });

  it('records repeated picks into the shared preference and flushes them to the server', async () => {
    const { result } = await renderSlashCommands();
    const review = result.current.slashCommands.find((command) => command.name === '/review');
    assert.ok(review, 'expected /review in the scanned command list');

    // Two picks, not one: the second is the one that matters. The store skips a
    // write whose value stringifies equal to the one it already holds, so a
    // writer that mutated the stored object in place would pass a mocked
    // assertion (and even the read-back below, since the object was changed in
    // memory) while never reaching the mirror or the server.
    act(() => {
      result.current.handleCommandSelect(review, 0, false);
      result.current.handleCommandSelect(review, 0, false);
    });

    assert.deepEqual(readUserPreference('commandUsage', {}), { '/review': 2 });

    // The mirrored blob is what the next page load paints from before the
    // server answers — and it is written only when the store accepts the value.
    const mirrored = JSON.parse(localStorage.getItem('user-preferences') ?? '{}') as {
      commandUsage?: unknown;
    };
    assert.deepEqual(mirrored.commandUsage, { '/review': 2 });

    // ...and the debounced PATCH carries the same payload.
    await waitFor(() => {
      assert.deepEqual(
        mocks.savePreferences.mock.calls.at(-1)?.[0],
        { commandUsage: { '/review': 2 } },
      );
    });
  });

  it('refreshes the frequent group once the server copy hydrates', async () => {
    const { result } = await renderSlashCommands();
    assert.equal(result.current.frequentCommands.length, 0);

    mocks.preferences.mockResolvedValue(
      jsonResponse({ preferences: { commandUsage: { '/custom': 5 } } }),
    );

    await act(async () => {
      await hydrateUserPreferences();
    });

    assert.deepEqual(
      result.current.frequentCommands.map((command) => command.name),
      ['/custom'],
    );
  });

  it('reflects a pick in the frequent group immediately', async () => {
    const { result } = await renderSlashCommands();
    assert.equal(result.current.frequentCommands.length, 0);

    const custom = result.current.slashCommands.find((command) => command.name === '/custom');
    assert.ok(custom, 'expected /custom in the scanned command list');

    act(() => {
      result.current.handleCommandSelect(custom, 0, false);
    });

    // The menu reflects the new count without waiting for the server round-trip.
    assert.deepEqual(
      result.current.frequentCommands.map((command) => command.name),
      ['/custom'],
    );
  });
});
