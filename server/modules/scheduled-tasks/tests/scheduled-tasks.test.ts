import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  scheduledTasksDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';
import {
  dispatchDueScheduledTasks,
  runScheduledTaskNow,
} from '@/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.js';
import {
  DEFAULT_SCHEDULED_TASK_PROJECT_PATH,
  scheduledTasksService,
} from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

type RunCall = {
  provider: string;
  command: string;
  options: Record<string, unknown>;
};

async function withIsolatedDatabase(runTest: (userId: number, projectPath: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-tasks-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('taskrunner', 'hash');
    await runTest(Number(user.id), tempDirectory);
  } finally {
    chatRunRegistry.clearAll();
    connectedClients.clear();
    scheduledTasksDb.failInterruptedRuns('test cleanup');
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createRuntime(
  runs: RunCall[],
  behaviour: 'ok' | 'throw' | 'complete-with-failure' = 'ok',
): ProviderRuntimeGateway {
  return {
    hasRuntime: () => true,
    run: async (
      provider: string,
      command: string,
      options: Record<string, unknown>,
      writer: { send: (message: unknown) => void },
    ) => {
      runs.push({ provider, command, options });
      if (behaviour === 'throw') {
        throw new Error('provider exploded');
      }
      if (behaviour === 'complete-with-failure') {
        // What Claude and DSH actually do on a failed turn: report the error,
        // emit a terminal complete with a non-zero exit code, and return
        // normally instead of throwing.
        writer.send(createNormalizedMessage({
          kind: 'error',
          content: 'Authentication expired.',
          sessionId: String(options.sessionId),
          provider: 'claude',
        }));
        writer.send(createCompleteMessage({
          provider: 'claude',
          sessionId: String(options.sessionId),
          exitCode: 1,
        }));
        return undefined;
      }
      writer.send(createCompleteMessage({
        provider: 'claude',
        sessionId: String(options.sessionId),
        exitCode: 0,
      }));
      return undefined;
    },
    abort: async () => true,
    stopBackgroundTask: async () => true,
    hasBackgroundWork: () => false,
    resolveToolApproval: () => undefined,
    getPendingApprovalsForSession: () => [],
  };
}

/** Waits for the fire-and-forget run to settle, since dispatches intentionally do not block. */
async function waitForRunToSettle(taskId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!scheduledTasksDb.hasRunningRun(taskId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The scheduled run did not settle in time.');
}

function createOnceTask(userId: number, projectPath: string, at: Date): string {
  return scheduledTasksService.create(userId, {
    name: 'Nightly report',
    prompt: 'Summarize yesterday and write REPORT.md.',
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    effort: 'high',
    permissionMode: 'acceptEdits',
    projectPath,
    scheduleKind: 'once',
    scheduleSpec: { at: at.toISOString() },
    timezone: 'UTC',
  }).id;
}

test('a task rejects a one-time schedule that has already passed', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    assert.throws(() => createOnceTask(userId, projectPath, new Date(Date.now() - 60_000)), /no upcoming run/);
  });
});

test('a daily task stores the next run in its own time zone', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const task = scheduledTasksService.create(userId, {
      name: 'Morning triage',
      prompt: 'Check issues.',
      provider: 'claude',
      projectPath,
      scheduleKind: 'daily',
      scheduleSpec: { time: '09:00' },
      timezone: 'Asia/Shanghai',
    });

    assert.equal(task.schedule.kind, 'daily');
    assert.ok(task.nextRunAt);
    assert.match(task.nextRunAt, /T01:00:00\.000Z$/);
  });
});

test('a blank project path falls back to the app folder, and ~ is expanded', async () => {
  await withIsolatedDatabase(async (userId) => {
    const blank = scheduledTasksService.create(userId, {
      name: 'Inbox digest',
      prompt: 'Summarize my day.',
      provider: 'claude',
      projectPath: '',
      scheduleKind: 'daily',
      scheduleSpec: { time: '09:00' },
      timezone: 'UTC',
    });
    // Not the home folder: that would list the whole home directory as a
    // project, the same reason /tmp is not used.
    assert.equal(blank.projectPath, DEFAULT_SCHEDULED_TASK_PROJECT_PATH);
    assert.equal(blank.projectPath, path.join(homedir(), '.cloudcli', 'scheduled-tasks'));

    const tilde = scheduledTasksService.create(userId, {
      name: 'Notes sweep',
      prompt: 'Tidy my notes.',
      provider: 'claude',
      projectPath: '~/notes',
      scheduleKind: 'daily',
      scheduleSpec: { time: '10:00' },
      timezone: 'UTC',
    });
    assert.equal(tilde.projectPath, path.join(homedir(), 'notes'));
  });
});

test('a due task starts a fresh conversation with the saved model and unattended flag', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const dueAt = new Date(Date.now() + 60 * 60_000);
    const taskId = createOnceTask(userId, projectPath, dueAt);
    const runs: RunCall[] = [];

    await dispatchDueScheduledTasks(createRuntime(runs), new Date(dueAt.getTime() + 1_000));
    await waitForRunToSettle(taskId);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'Summarize yesterday and write REPORT.md.');
    assert.equal(runs[0].options.model, 'claude-sonnet-4-5');
    assert.equal(runs[0].options.effort, 'high');
    assert.equal(runs[0].options.permissionMode, 'acceptEdits');
    assert.equal(runs[0].options.unattended, true);

    const [run] = scheduledTasksService.listRuns(userId, taskId);
    assert.equal(run.status, 'completed');
    assert.ok(run.sessionId);
    assert.ok(sessionsDb.getSessionById(run.sessionId!));

    // A one-shot has no next occurrence, so it turns itself off instead of
    // firing again at a stale timestamp.
    const task = scheduledTasksService.get(userId, taskId);
    assert.equal(task.enabled, false);
  });
});

test('a failing provider turn is recorded as a failed run, not a lost one', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const dueAt = new Date(Date.now() + 60 * 60_000);
    const taskId = createOnceTask(userId, projectPath, dueAt);

    await dispatchDueScheduledTasks(createRuntime([], 'throw'), new Date(dueAt.getTime() + 1_000));
    await waitForRunToSettle(taskId);

    const [run] = scheduledTasksService.listRuns(userId, taskId);
    assert.equal(run.status, 'failed');
    assert.match(run.error ?? '', /provider exploded/);
  });
});

test('a turn that reports failure and returns normally is still recorded as failed', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const dueAt = new Date(Date.now() + 60 * 60_000);
    const taskId = createOnceTask(userId, projectPath, dueAt);

    // Providers do not throw on a failed turn: they emit `error` plus
    // `complete(exitCode: 1)` and resolve. Recording that as completed hid
    // every broken scheduled task, because the run history was the only
    // signal the user had.
    await dispatchDueScheduledTasks(
      createRuntime([], 'complete-with-failure'),
      new Date(dueAt.getTime() + 1_000),
    );
    await waitForRunToSettle(taskId);

    const [run] = scheduledTasksService.listRuns(userId, taskId);
    assert.equal(run.status, 'failed');
    assert.match(run.error ?? '', /Authentication expired/);

    // The session the run created still exists, so the user can open it and
    // read the provider's own error message.
    assert.ok(run.sessionId);
    assert.ok(sessionsDb.getSessionById(run.sessionId!));
  });
});

test('a cycle that arrives while the same task is running is recorded as skipped', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const taskId = createOnceTask(userId, projectPath, new Date(Date.now() + 60 * 60_000));

    // Hold the task's run open so the next cycle sees it as busy.
    scheduledTasksDb.createRun({ taskId, userId, trigger: 'scheduled', scheduledFor: new Date() });
    assert.equal(scheduledTasksDb.hasRunningRun(taskId), true);

    const runs: RunCall[] = [];
    await dispatchDueScheduledTasks(createRuntime(runs), new Date(Date.now() + 2 * 60 * 60_000));

    assert.equal(runs.length, 0);
    const history = scheduledTasksService.listRuns(userId, taskId);
    const skipped = history.find((run) => run.status === 'skipped');
    assert.ok(skipped, 'the cycle should be recorded as skipped');
    assert.equal(skipped.skippedReason, 'previous_run_still_running');
  });
});

test('run-now starts immediately and is rejected while the task is busy', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const taskId = createOnceTask(userId, projectPath, new Date(Date.now() + 60 * 60_000));
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);

    const started = runScheduledTaskNow(userId, taskId, runtime);
    assert.equal(started.trigger, 'manual');
    await waitForRunToSettle(taskId);
    assert.equal(scheduledTasksService.listRuns(userId, taskId)[0].status, 'completed');

    // A second call while a run is open is refused with the conflict the UI
    // shows, rather than silently queued.
    scheduledTasksDb.createRun({ taskId, userId, trigger: 'manual', scheduledFor: null });
    assert.throws(() => runScheduledTaskNow(userId, taskId, runtime), /still running/);
  });
});

test('tasks are scoped to their owner', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const taskId = createOnceTask(userId, projectPath, new Date(Date.now() + 60 * 60_000));
    const otherUser = userDb.createUser('intruder', 'hash');

    assert.throws(() => scheduledTasksService.get(Number(otherUser.id), taskId), /not found/);
    assert.throws(() => scheduledTasksService.remove(Number(otherUser.id), taskId), /not found/);
    assert.equal(scheduledTasksService.list(Number(otherUser.id)).length, 0);
  });
});

test('editing the rule moves the next run, and disabling leaves it inert', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const task = scheduledTasksService.create(userId, {
      name: 'Hourly check',
      prompt: 'Check the queue.',
      provider: 'claude',
      projectPath,
      scheduleKind: 'interval',
      scheduleSpec: { everyMinutes: 60 },
      timezone: 'UTC',
    });

    const edited = scheduledTasksService.update(userId, task.id, {
      scheduleKind: 'daily',
      scheduleSpec: { time: '03:00' },
    });
    assert.equal(edited.schedule.kind, 'daily');
    assert.match(edited.nextRunAt!, /T03:00:00\.000Z$/);

    const disabled = scheduledTasksService.setEnabled(userId, task.id, false);
    assert.equal(disabled.enabled, false);

    const runs: RunCall[] = [];
    await dispatchDueScheduledTasks(createRuntime(runs), new Date(Date.now() + 30 * 60 * 60_000));
    assert.equal(runs.length, 0);
  });
});
