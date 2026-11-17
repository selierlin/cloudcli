import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type * as SharedApiModule from '@/shared/api';
import {
  getPermissionModeAppearance,
  PERMISSION_MODE_ACCENT_CLASSES,
} from '@/shared/permissionModeAppearance';
import type { ProviderModelsDefinition, ScheduledTask, ScheduledTaskInput } from '@/shared/types';
import ScheduledTaskDialog from '@/modules/scheduled-tasks/ScheduledTaskDialog';

/**
 * The dialog has to mirror how a new conversation picks its model, and it must
 * accept a task with no project path. Both used to be broken: the catalog was
 * read as an array so the model list never filled, and the path was mandatory.
 */

const CATALOG: ProviderModelsDefinition = {
  DEFAULT: 'claude-opus-4-5',
  OPTIONS: [
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5', effort: { values: [{ value: 'high' }] } },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  ],
};

const { availableMock, modelsMock, capabilitiesMock } = vi.hoisted(() => ({
  availableMock: vi.fn(),
  modelsMock: vi.fn(),
  capabilitiesMock: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApiModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      providers: {
        ...actual.api.providers,
        available: availableMock,
        models: modelsMock,
        capabilities: capabilitiesMock,
      },
    },
  };
});

vi.mock('@/shared/userSettings', () => ({
  readUserPreference: (key: string, fallback: unknown) => (
    key === 'providerModelSettings'
      ? { claude: { model: 'claude-opus-4-5', effort: 'high' } }
      : fallback
  ),
  writeUserPreference: vi.fn(),
  USER_PREFERENCES_CHANGED_EVENT: 'cloudcli:user-preferences-changed',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  availableMock.mockReset();
  modelsMock.mockReset();
  capabilitiesMock.mockReset();
  availableMock.mockResolvedValue(jsonResponse({ providers: ['claude'] }));
  modelsMock.mockResolvedValue(jsonResponse({ provider: 'claude', models: CATALOG }));
  capabilitiesMock.mockResolvedValue(jsonResponse({
    providers: [{
      provider: 'claude',
      permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
    }],
  }));
});

const EXISTING_TASK: ScheduledTask = {
  id: 'task-1',
  name: 'Nightly report',
  prompt: 'Summarize yesterday.',
  provider: 'claude',
  model: null,
  effort: null,
  permissionMode: null,
  projectPath: '/tmp/project',
  schedule: { kind: 'daily', time: '09:00' },
  timezone: 'Asia/Shanghai',
  enabled: true,
  nextRunAt: '2099-01-01T01:00:00.000Z',
  lastRunAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const PLAN_TASK: ScheduledTask = { ...EXISTING_TASK, id: 'task-2', permissionMode: 'plan' };

test('the model picker lists the catalog and starts on the last model used', async () => {
  render(<ScheduledTaskDialog isOpen task={null} onClose={() => {}} onSubmit={async () => {}} />);

  // The pickers are custom listboxes: the trigger carries the current label and
  // the rows only exist while the panel is open.
  const modelTrigger = await waitFor(() => {
    const trigger = screen.getByRole('button', { name: 'scheduledTasks.model' });
    assert.match(trigger.textContent ?? '', /Claude Opus 4\.5/);
    return trigger;
  });

  fireEvent.click(modelTrigger);
  assert.deepEqual(
    screen.getAllByRole('option').map((option) => option.textContent),
    ['Claude Opus 4.5', 'Claude Sonnet 4.5'],
  );
  assert.equal(
    screen.getByRole('option', { name: 'Claude Opus 4.5' }).getAttribute('aria-selected'),
    'true',
  );

  // The saved effort is restored against the selected model's own levels.
  assert.match(screen.getByRole('button', { name: 'scheduledTasks.effort' }).textContent ?? '', /high/);
  assert.match(screen.getByRole('button', { name: 'scheduledTasks.provider' }).textContent ?? '', /Claude/);

  // Picking a model without effort levels hides that picker instead of sending
  // the previous model's level with it.
  fireEvent.click(screen.getByRole('option', { name: 'Claude Sonnet 4.5' }));
  assert.match(
    screen.getByRole('button', { name: 'scheduledTasks.model' }).textContent ?? '',
    /Claude Sonnet 4\.5/,
  );
  assert.equal(screen.queryByRole('button', { name: 'scheduledTasks.effort' }), null);
  assert.equal(screen.queryAllByRole('option').length, 0);
});

test('the rule picker swaps the time field for weekday toggles on a weekly task', async () => {
  render(<ScheduledTaskDialog isOpen task={null} onClose={() => {}} onSubmit={async () => {}} />);

  fireEvent.click(screen.getByRole('button', { name: 'scheduledTasks.kindWeekly' }));

  // Monday to Friday are the defaults, so the picker is not empty when it appears.
  await waitFor(() => {
    const pressed = screen.getAllByRole('button', { pressed: true })
      .map((button) => button.textContent);
    assert.deepEqual(pressed, [
      'scheduledTasks.kindWeekly',
      'scheduledTasks.weekdayShort.1',
      'scheduledTasks.weekdayShort.2',
      'scheduledTasks.weekdayShort.3',
      'scheduledTasks.weekdayShort.4',
      'scheduledTasks.weekdayShort.5',
    ]);
  });
  assert.ok(screen.getByLabelText('scheduledTasks.timeOfDay'));
});

test('a task with no project path is submittable and sends a blank path', async () => {
  const submitted: ScheduledTaskInput[] = [];
  render(
    <ScheduledTaskDialog
      isOpen
      task={null}
      onClose={() => {}}
      onSubmit={async (input) => {
        submitted.push(input);
      }}
    />,
  );

  await waitFor(() => {
    assert.match(
      screen.getByRole('button', { name: 'scheduledTasks.model' }).textContent ?? '',
      /Claude Opus 4\.5/,
    );
  });

  fireEvent.change(screen.getByLabelText('scheduledTasks.name'), { target: { value: 'Morning digest' } });
  fireEvent.change(screen.getByLabelText('scheduledTasks.prompt'), { target: { value: 'Summarize yesterday.' } });
  fireEvent.click(screen.getByText('scheduledTasks.save'));

  await waitFor(() => assert.equal(submitted.length, 1));
  assert.equal(submitted[0].projectPath, null);
  assert.equal(submitted[0].model, 'claude-opus-4-5');
});

test('a new task starts on Full access, without plan mode, and submits that mode', async () => {
  const submitted: ScheduledTaskInput[] = [];
  render(
    <ScheduledTaskDialog
      isOpen
      task={null}
      onClose={() => {}}
      onSubmit={async (input) => {
        submitted.push(input);
      }}
    />,
  );

  const permissionTrigger = await waitFor(() => {
    const trigger = screen.getByRole('button', { name: 'scheduledTasks.permissionMode' });
    // An unattended run cannot answer a permission prompt, so the default is
    // the one mode that lets it finish on its own.
    assert.match(trigger.textContent ?? '', /permissions\.modes\.bypassPermissions\.title/);
    return trigger;
  });

  // The trigger wears Full access's accent, the same one chat's composer uses.
  const fullAccessAccent = PERMISSION_MODE_ACCENT_CLASSES[getPermissionModeAppearance('bypassPermissions').accent];
  assert.ok(permissionTrigger.className.includes(fullAccessAccent.foreground));

  fireEvent.click(permissionTrigger);
  const labels = screen.getAllByRole('option').map((option) => option.textContent ?? '');
  assert.ok(labels.some((label) => label.includes('permissions.modes.bypassPermissions.title')));
  // Plan mode is downgraded to the provider default when nobody is watching.
  assert.equal(labels.some((label) => label.includes('permissions.modes.plan.title')), false);

  // Each row carries its own mode colour, so the menu reads like chat's.
  const fullAccessRow = screen.getByRole('option', { name: /permissions\.modes\.bypassPermissions\.title/ });
  assert.ok(
    Array.from(fullAccessRow.querySelectorAll('span')).some((span) => span.className.includes(fullAccessAccent.label)),
  );

  fireEvent.click(screen.getByRole('option', { name: /permissions\.modes\.default\.title/ }));

  fireEvent.change(screen.getByLabelText('scheduledTasks.name'), { target: { value: 'Blog post' } });
  fireEvent.change(screen.getByLabelText('scheduledTasks.prompt'), { target: { value: 'Write it.' } });
  fireEvent.click(screen.getByText('scheduledTasks.save'));

  await waitFor(() => assert.equal(submitted.length, 1));
  assert.equal(submitted[0].permissionMode, 'default');
});

test('a task saved before the picker existed shows its mode as unset and keeps it unset', async () => {
  const submitted: ScheduledTaskInput[] = [];
  render(
    <ScheduledTaskDialog
      isOpen
      task={EXISTING_TASK}
      onClose={() => {}}
      onSubmit={async (input) => {
        submitted.push(input);
      }}
    />,
  );

  await waitFor(() => {
    assert.match(
      screen.getByRole('button', { name: 'scheduledTasks.permissionMode' }).textContent ?? '',
      /scheduledTasks\.permissionModeUnset/,
    );
  });
  assert.ok(screen.getByText('scheduledTasks.permissionModeUnsetWarning'));

  fireEvent.click(screen.getByText('scheduledTasks.save'));

  await waitFor(() => assert.equal(submitted.length, 1));
  assert.equal(submitted[0].permissionMode, null);
});

test('a task saved with plan keeps Plan only, warns, and submits the mode unchanged', async () => {
  const submitted: ScheduledTaskInput[] = [];
  render(
    <ScheduledTaskDialog
      isOpen
      task={PLAN_TASK}
      onClose={() => {}}
      onSubmit={async (input) => {
        submitted.push(input);
      }}
    />,
  );

  await waitFor(() => {
    assert.match(
      screen.getByRole('button', { name: 'scheduledTasks.permissionMode' }).textContent ?? '',
      /permissions\.modes\.plan\.title/,
    );
  });
  // Opening the dialog must not widen the task's permissions behind the user.
  assert.ok(screen.getByText('scheduledTasks.permissionModePlanUnattended'));

  fireEvent.click(screen.getByText('scheduledTasks.save'));

  await waitFor(() => assert.equal(submitted.length, 1));
  assert.equal(submitted[0].permissionMode, 'plan');
});

test('a new task on a provider without full access starts on auto', async () => {
  // DSH's `default` waits for a chat client a scheduled run does not have,
  // while `auto` answers its own permission requests.
  availableMock.mockResolvedValue(jsonResponse({ providers: ['dsh'] }));
  const submitted: ScheduledTaskInput[] = [];
  render(
    <ScheduledTaskDialog
      isOpen
      task={null}
      onClose={() => {}}
      onSubmit={async (input) => {
        submitted.push(input);
      }}
    />,
  );

  await waitFor(() => {
    assert.match(
      screen.getByRole('button', { name: 'scheduledTasks.permissionMode' }).textContent ?? '',
      /\.auto\.title/,
    );
  });

  fireEvent.change(screen.getByLabelText('scheduledTasks.name'), { target: { value: 'Nightly' } });
  fireEvent.change(screen.getByLabelText('scheduledTasks.prompt'), { target: { value: 'Do it.' } });
  fireEvent.click(screen.getByText('scheduledTasks.save'));

  await waitFor(() => assert.equal(submitted.length, 1));
  assert.equal(submitted[0].provider, 'dsh');
  assert.equal(submitted[0].permissionMode, 'auto');
});
