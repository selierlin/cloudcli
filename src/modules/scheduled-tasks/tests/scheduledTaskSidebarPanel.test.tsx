import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type * as SharedApiModule from '@/shared/api';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import type { ScheduledTask, ScheduledTaskRun } from '@/shared/types';
import ScheduledTaskSidebarPanel from '@/modules/scheduled-tasks/ScheduledTaskSidebarPanel';

/**
 * The sidebar section is read at 220px, so it shows a compact row instead of
 * the settings card. These tests pin what that row must still say: the task's
 * name, its rule, and a way into the conversation a run produced.
 */

const { listMock, runsMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  runsMock: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApiModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      scheduledTasks: {
        list: listMock,
        runs: runsMock,
        run: vi.fn(),
        setEnabled: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
    },
  };
});

/** Resolves a `scheduledTasks.*` key from the shipped English file, interpolating `{{placeholders}}`. */
function translate(key: string, options: Record<string, unknown> = {}): string {
  let node: unknown = enSettings;
  for (const part of key.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node !== 'string') {
    return key;
  }
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
}));

const TASK: ScheduledTask = {
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

const RUN: ScheduledTaskRun = {
  id: 'run-1',
  taskId: TASK.id,
  trigger: 'scheduled',
  status: 'completed',
  sessionId: 'session-1',
  error: null,
  skippedReason: null,
  scheduledFor: null,
  startedAt: '2026-11-04T01:00:00.000Z',
  finishedAt: '2026-11-04T01:05:00.000Z',
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPanel() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ScheduledTaskSidebarPanel />} />
        <Route path="/session/:id" element={<div>session view</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  runsMock.mockReset();
  listMock.mockResolvedValue(jsonResponse([TASK]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('a task row carries its rule and next run on one line', async () => {
  renderPanel();

  await waitFor(() => {
    assert.ok(screen.getByText('Nightly report'));
  });
  assert.ok(screen.getByText(/Daily at 09:00/, { exact: false }));
});

test('expanding a row reads its runs and opens the conversation', async () => {
  runsMock.mockResolvedValue(jsonResponse([RUN]));
  renderPanel();

  await waitFor(() => {
    assert.ok(screen.getByText('Nightly report'));
  });

  fireEvent.click(screen.getByText('Nightly report'));

  await waitFor(() => {
    assert.equal(runsMock.mock.calls.length, 1);
    assert.equal(runsMock.mock.calls[0][0], TASK.id);
  });

  fireEvent.click(await screen.findByText(translate('scheduledTasks.openConversation')));

  await waitFor(() => {
    assert.ok(screen.getByText('session view'));
  });
});

test('an empty list explains what a scheduled task is for', async () => {
  listMock.mockResolvedValue(jsonResponse([]));

  renderPanel();

  await waitFor(() => {
    assert.ok(screen.getByText(translate('scheduledTasks.emptyTitle')));
  });
});
