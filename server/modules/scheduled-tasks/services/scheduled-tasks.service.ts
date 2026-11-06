import { homedir } from 'node:os';
import path from 'node:path';

import {
  scheduledTasksDb,
  type ScheduledTaskRow,
  type ScheduledTaskRunRow,
  type ScheduledTaskScheduleKind,
} from '@/modules/database/index.js';
import {
  assertValidTimezone,
  computeNextRun,
  parseSchedule,
  type ScheduledTaskSchedule,
} from '@/modules/scheduled-tasks/services/scheduled-task-schedule.service.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const MAX_NAME_LENGTH = 120;
const MAX_PROMPT_LENGTH = 100_000;
const MAX_PROJECT_PATH_LENGTH = 4096;
const DEFAULT_RUN_HISTORY_LIMIT = 20;
const MAX_RUN_HISTORY_LIMIT = 100;

/**
 * Working folder for a task that has no project of its own.
 *
 * Not the home folder, which would list the user's entire home directory as a
 * project in the sidebar, and not `/tmp`, which macOS and Linux clear on their
 * own schedule while the task is still saved.
 */
export const DEFAULT_SCHEDULED_TASK_PROJECT_PATH = path.join(homedir(), '.cloudcli', 'scheduled-tasks');

/** Keep in sync with `LLMProvider`; the list exists so a typo is a 400, not a failed run later. */
const SUPPORTED_PROVIDERS = new Set<LLMProvider>([
  'claude', 'codex', 'cursor', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp', 'openclaw',
]);

export type ScheduledTask = {
  id: string;
  name: string;
  prompt: string;
  provider: LLMProvider;
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  projectPath: string;
  schedule: ScheduledTaskSchedule;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
};

export type ScheduledTaskRun = {
  id: string;
  taskId: string;
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'completed' | 'failed' | 'skipped';
  sessionId: string | null;
  error: string | null;
  skippedReason: string | null;
  scheduledFor: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ScheduledTaskInput = {
  name: string;
  prompt: string;
  provider: LLMProvider;
  model?: string | null;
  effort?: string | null;
  permissionMode?: string | null;
  /** Optional: blank means "run in the user's home folder". */
  projectPath?: string | null;
  scheduleKind: ScheduledTaskScheduleKind;
  scheduleSpec: unknown;
  timezone: string;
};

function readSchedule(row: ScheduledTaskRow): ScheduledTaskSchedule {
  let spec: unknown = {};
  try {
    spec = JSON.parse(row.schedule_spec || '{}');
  } catch {
    // A corrupt spec must still render as a task the user can edit, rather
    // than 500 the whole list. Validation catches it the moment it is saved.
    spec = {};
  }
  return parseSchedule(row.schedule_kind, spec);
}

function toScheduledTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    provider: row.provider as LLMProvider,
    model: row.model,
    effort: row.effort,
    permissionMode: row.permission_mode,
    projectPath: row.project_path,
    schedule: readSchedule(row),
    timezone: row.timezone,
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  };
}

function toScheduledTaskRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
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

function readText(value: unknown, field: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AppError(`${field} is required.`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  if (text.length > maxLength) {
    throw new AppError(`${field} is too long.`, {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return text;
}

function readProvider(value: unknown): LLMProvider {
  const provider = typeof value === 'string' ? value.trim() : '';
  if (!SUPPORTED_PROVIDERS.has(provider as LLMProvider)) {
    throw new AppError(`Unknown provider "${provider}".`, {
      code: 'UNSUPPORTED_PROVIDER',
      statusCode: 400,
    });
  }
  return provider as LLMProvider;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Resolves the folder a run works in.
 *
 * The field is optional: a task that only summarizes something does not need a
 * project, so a blank value runs in the user's home folder. A leading `~` is
 * expanded because that is what people type when they do name one.
 */
function readProjectPath(value: unknown): string {
  const raw = optionalText(value);
  if (!raw) {
    return DEFAULT_SCHEDULED_TASK_PROJECT_PATH;
  }

  const expanded = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
    ? path.join(homedir(), raw.slice(1))
    : raw;

  if (expanded.length > MAX_PROJECT_PATH_LENGTH) {
    throw new AppError('projectPath is too long.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }
  return expanded;
}

/** Reads a task by id for its owner, or reports the same 404 every caller expects. */
function readRowOrThrow(userId: number, id: string): ScheduledTaskRow {
  const row = scheduledTasksDb.getTask(userId, id);
  if (!row) {
    throw new AppError('That scheduled task was not found.', {
      code: 'SCHEDULED_TASK_NOT_FOUND',
      statusCode: 404,
    });
  }
  return row;
}

/** Allocates the next run, refusing schedules that would never fire. */
function resolveNextRun(
  schedule: ScheduledTaskSchedule,
  timezone: string,
  now: Date,
): Date {
  const next = computeNextRun(schedule, timezone, now);
  if (!next) {
    throw new AppError('That schedule has no upcoming run; pick a future time.', {
      code: 'SCHEDULE_IN_PAST',
      statusCode: 400,
    });
  }
  return next;
}

/**
 * Task definitions and validation.
 *
 * Used by the Scheduled Tasks routes and dispatcher. Execution itself lives in
 * the dispatcher: this service never starts a provider turn, so it stays usable
 * from request handlers and tests without a runtime.
 */
export const scheduledTasksService = {
  create(userId: number, input: ScheduledTaskInput): ScheduledTask {
    const name = readText(input.name, 'name', MAX_NAME_LENGTH);
    const prompt = readText(input.prompt, 'prompt', MAX_PROMPT_LENGTH);
    const projectPath = readProjectPath(input.projectPath);
    const timezone = readText(input.timezone, 'timezone', 100);
    assertValidTimezone(timezone);

    const schedule = parseSchedule(input.scheduleKind, input.scheduleSpec);
    const nextRunAt = resolveNextRun(schedule, timezone, new Date());

    return toScheduledTask(scheduledTasksDb.createTask({
      userId,
      name,
      prompt,
      provider: readProvider(input.provider),
      model: optionalText(input.model),
      effort: optionalText(input.effort),
      permissionMode: optionalText(input.permissionMode),
      projectPath,
      scheduleKind: schedule.kind,
      scheduleSpec: schedule,
      timezone,
      nextRunAt,
    }));
  },

  list(userId: number): ScheduledTask[] {
    return scheduledTasksDb.listTasksForUser(userId).map(toScheduledTask);
  },

  get(userId: number, id: string): ScheduledTask {
    return toScheduledTask(readRowOrThrow(userId, id));
  },

  /**
   * Applies a partial edit. Any change to the rule (kind, spec, or zone) moves
   * the next run from now, because the old timestamp belongs to the old rule.
   */
  update(
    userId: number,
    id: string,
    patch: Partial<ScheduledTaskInput>,
  ): ScheduledTask {
    const existing = readRowOrThrow(userId, id);

    const scheduleKind = patch.scheduleKind ?? existing.schedule_kind;
    const timezone = patch.timezone !== undefined
      ? readText(patch.timezone, 'timezone', 100)
      : existing.timezone;
    if (patch.timezone !== undefined) {
      assertValidTimezone(timezone);
    }

    const scheduleTouched =
      patch.scheduleKind !== undefined
      || patch.scheduleSpec !== undefined
      || patch.timezone !== undefined;

    let schedule: ScheduledTaskSchedule | null = null;
    if (scheduleTouched) {
      let previousSpec: unknown = {};
      try {
        previousSpec = JSON.parse(existing.schedule_spec || '{}');
      } catch {
        // Same fallback as readSchedule: validation below rejects the result
        // when the caller did not supply a usable spec either.
        previousSpec = {};
      }
      schedule = parseSchedule(scheduleKind, patch.scheduleSpec ?? previousSpec);
    }

    const nextRunAt = schedule
      ? resolveNextRun(schedule, timezone, new Date())
      : undefined;

    const row = scheduledTasksDb.updateTask(userId, id, {
      name: patch.name !== undefined ? readText(patch.name, 'name', MAX_NAME_LENGTH) : undefined,
      prompt: patch.prompt !== undefined ? readText(patch.prompt, 'prompt', MAX_PROMPT_LENGTH) : undefined,
      provider: patch.provider !== undefined ? readProvider(patch.provider) : undefined,
      model: patch.model !== undefined ? optionalText(patch.model) : undefined,
      effort: patch.effort !== undefined ? optionalText(patch.effort) : undefined,
      permissionMode: patch.permissionMode !== undefined ? optionalText(patch.permissionMode) : undefined,
      projectPath: patch.projectPath !== undefined
        ? readProjectPath(patch.projectPath)
        : undefined,
      scheduleKind: schedule ? schedule.kind : undefined,
      scheduleSpec: schedule ?? undefined,
      timezone: patch.timezone !== undefined ? timezone : undefined,
      nextRunAt,
    });

    if (!row) {
      throw new AppError('That scheduled task was not found.', {
        code: 'SCHEDULED_TASK_NOT_FOUND',
        statusCode: 404,
      });
    }
    return toScheduledTask(row);
  },

  /**
   * Enabling recomputes the next run from now; a one-shot whose time has passed
   * cannot be turned back on without editing it, which is reported instead of
   * silently firing it in a loop.
   */
  setEnabled(userId: number, id: string, enabled: boolean): ScheduledTask {
    const existing = readRowOrThrow(userId, id);

    const nextRunAt = enabled
      ? resolveNextRun(readSchedule(existing), existing.timezone, new Date())
      : null;

    const row = scheduledTasksDb.setEnabled(userId, id, enabled, nextRunAt);
    if (!row) {
      throw new AppError('That scheduled task was not found.', {
        code: 'SCHEDULED_TASK_NOT_FOUND',
        statusCode: 404,
      });
    }
    return toScheduledTask(row);
  },

  remove(userId: number, id: string): void {
    if (!scheduledTasksDb.deleteTask(userId, id)) {
      throw new AppError('That scheduled task was not found.', {
        code: 'SCHEDULED_TASK_NOT_FOUND',
        statusCode: 404,
      });
    }
  },

  listRuns(userId: number, taskId: string, limit?: number): ScheduledTaskRun[] {
    // Ownership is checked through the task, so one user cannot read another's history.
    readRowOrThrow(userId, taskId);
    const bounded = Math.min(
      Math.max(Math.trunc(limit ?? DEFAULT_RUN_HISTORY_LIMIT) || DEFAULT_RUN_HISTORY_LIMIT, 1),
      MAX_RUN_HISTORY_LIMIT,
    );
    return scheduledTasksDb.listRuns(taskId, bounded).map(toScheduledTaskRun);
  },

  /** Exposed for the dispatcher, which needs the raw row (user id, rule, zone). */
  getRow(userId: number, id: string): ScheduledTaskRow {
    return readRowOrThrow(userId, id);
  },
};
