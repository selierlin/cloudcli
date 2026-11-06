import { mkdirSync } from 'node:fs';

import { scheduledTasksDb, type ScheduledTaskRow, type ScheduledTaskRunRow } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { advanceTaskSchedule } from '@/modules/scheduled-tasks/services/scheduled-task-schedule.service.js';
import {
  DEFAULT_SCHEDULED_TASK_PROJECT_PATH,
  scheduledTasksService,
  type ScheduledTaskRun,
} from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
import { runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * How often due tasks are looked for.
 *
 * Matches the scheduled-messages poll: a minute is the granularity the rule
 * editor offers, and the due query is one indexed comparison.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * How many task runs may be in flight at once.
 *
 * A task may start a whole agent CLI, so an unbounded poll could otherwise
 * launch several on the same minute. Cycles over the ceiling are recorded as
 * skipped rather than queued: a repeating task gets another chance, and a
 * backlog of stale runs is worse than one missed cycle.
 */
const MAX_CONCURRENT_RUNS = 2;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let dispatchInFlight = false;

/** Task ids this process is currently executing, so a slow run does not overlap itself. */
const inFlightTaskIds = new Set<string>();

function formatRunLabel(task: ScheduledTaskRow, now: Date): string {
  // en-CA renders as "MM-DD, HH:mm"; the comma reads oddly in a sidebar title.
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: task.timezone,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now).replace(', ', ' ');
  return `${task.name} · ${stamp}`;
}

/**
 * Runs one task's prompt in a brand-new conversation.
 *
 * A fresh session per run is deliberate: a repeating job must not inherit last
 * week's context, and two users' runs of the same task must not share one.
 *
 * The conversation is named after the task so repeated runs are identifiable
 * in the sidebar. A failure to rename is logged and ignored — the run itself
 * has not failed.
 */
async function executeTask(
  task: ScheduledTaskRow,
  runId: string,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  let sessionId: string | null = null;

  try {
    if (!runtime.hasRuntime(task.provider)) {
      throw new Error(`Provider "${task.provider}" is not available.`);
    }

    // The database value was validated when the task was saved; the row type
    // stores it as a plain string because the column has no CHECK constraint.
    const provider = task.provider as LLMProvider;
    const created = sessionsService.createAppSession(provider, task.project_path, task.prompt);
    sessionId = created.sessionId;

    try {
      sessionsService.renameSessionById(sessionId, formatRunLabel(task, new Date()));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[ScheduledTasks] Could not name the run conversation', { sessionId, error: message });
    }

    const result = await runDetachedChatTurn(
      {
        sessionId,
        userId: task.user_id,
        content: task.prompt,
        options: {
          model: task.model ?? undefined,
          effort: task.effort ?? undefined,
          permissionMode: task.permission_mode ?? undefined,
        },
        unattended: true,
      },
      { runtime },
    );

    // A run that never started (provider vanished mid-flight, session swept)
    // is reported the same way as one that started and failed: silently
    // dropping a task the user scheduled is worse than saying it did not go.
    if (!result.started || result.error) {
      scheduledTasksDb.finishRun(runId, {
        status: 'failed',
        sessionId,
        error: result.error ?? 'The run could not be started.',
      });
      return;
    }

    scheduledTasksDb.finishRun(runId, { status: 'completed', sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scheduledTasksDb.finishRun(runId, { status: 'failed', sessionId, error: message });
  } finally {
    inFlightTaskIds.delete(task.id);
  }
}

/**
 * Starts a run unless this task is still going or the server is at capacity.
 *
 * Returns the skipped run when the cycle was dropped, or `null` when the work
 * was accepted and is now executing in the background.
 */
function startRun(
  task: ScheduledTaskRow,
  trigger: 'scheduled' | 'manual',
  runtime: ProviderRuntimeGateway,
  scheduledFor: Date | null,
): { run: ScheduledTaskRun | null; skipped: string | null } {
  if (inFlightTaskIds.has(task.id) || scheduledTasksDb.hasRunningRun(task.id)) {
    return { run: null, skipped: 'previous_run_still_running' };
  }
  if (scheduledTasksDb.countRunningRuns() >= MAX_CONCURRENT_RUNS) {
    return { run: null, skipped: 'concurrency_limit' };
  }

  const created = scheduledTasksDb.createRun({
    taskId: task.id,
    userId: task.user_id,
    trigger,
    scheduledFor,
  });

  inFlightTaskIds.add(task.id);
  void executeTask(task, created.id, runtime);

  return { run: toRun(created), skipped: null };
}

function toRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    trigger: row.trigger,
    status: row.status,
    sessionId: row.session_id,
    error: row.error,
    skippedReason: row.skipped_reason,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Runs one task on demand from the UI.
 *
 * Returns as soon as the run is registered: the provider turn can take
 * minutes, and holding the HTTP response open for it would time out on a
 * mobile client. The caller follows progress through the run history.
 */
export function runScheduledTaskNow(
  userId: number,
  taskId: string,
  runtime: ProviderRuntimeGateway,
): ScheduledTaskRun {
  const task = scheduledTasksService.getRow(userId, taskId);
  const outcome = startRun(task, 'manual', runtime, null);

  if (outcome.skipped === 'previous_run_still_running') {
    throw new AppError('This task is still running. Wait for it to finish.', {
      code: 'SCHEDULED_TASK_ALREADY_RUNNING',
      statusCode: 409,
    });
  }
  if (outcome.skipped === 'concurrency_limit') {
    throw new AppError('Too many scheduled tasks are running. Try again shortly.', {
      code: 'SCHEDULED_TASK_CONCURRENCY_LIMIT',
      statusCode: 429,
    });
  }
  return outcome.run as ScheduledTaskRun;
}

/**
 * Advances one claimed row's schedule.
 *
 * A corrupt or unsupported spec must not wedge the poll: the task is disabled
 * (the caller receives `null`) and the failure is logged, so the rest of the
 * due tasks still run.
 */
function advanceOrDisable(task: ScheduledTaskRow, now: Date): Date | null {
  try {
    return advanceTaskSchedule(task, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ScheduledTasks] Disabling a task with an invalid schedule', {
      taskId: task.id,
      error: message,
    });
    return null;
  }
}

/**
 * Runs every task whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledTasks(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them starts, so a long run cannot let the next poll
  // pick the same cycle up again.
  const due = scheduledTasksDb.claimDueTasks(now, advanceOrDisable);
  if (due.length === 0) {
    return 0;
  }

  for (const task of due) {
    const outcome = startRun(task, 'scheduled', runtime, new Date(task.next_run_at));
    if (outcome.skipped) {
      // Recorded rather than dropped: the user needs to see that a cycle was
      // missed and why, next to the runs it should have produced.
      const skipped = scheduledTasksDb.createRun({
        taskId: task.id,
        userId: task.user_id,
        trigger: 'scheduled',
        scheduledFor: new Date(task.next_run_at),
      });
      scheduledTasksDb.finishRun(skipped.id, { status: 'skipped', skippedReason: outcome.skipped });
    }
  }

  return due.length;
}

/**
 * Starts the poll that runs scheduled tasks.
 *
 * The schedule lives in the database, so it survives a restart. Interrupted
 * runs from the previous process are closed here, because a row left `running`
 * would both block its task and inflate the concurrency count.
 */
export function initializeScheduledTaskDispatcher(runtime: ProviderRuntimeGateway): void {
  if (pollTimer) {
    return;
  }

  scheduledTasksDb.failInterruptedRuns('The server restarted before this run finished.');

  // The default working folder has to exist before a runtime is spawned in it.
  // A path the user typed is left alone, so a typo still fails loudly instead
  // of silently growing an empty directory.
  mkdirSync(DEFAULT_SCHEDULED_TASK_PROJECT_PATH, { recursive: true });

  const poll = () => {
    // A pass that overruns the interval must not run underneath itself.
    if (dispatchInFlight) {
      return;
    }
    dispatchInFlight = true;
    void dispatchDueScheduledTasks(runtime)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ScheduledTasks] Dispatch pass failed', { error: message });
      })
      .finally(() => {
        dispatchInFlight = false;
      });
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled tasks.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledTaskDispatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
