import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

/** The repeat rules the UI offers; `schedule_spec` is validated per kind in the service. */
export type ScheduledTaskScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';

export type ScheduledTaskRunStatus = 'running' | 'completed' | 'failed' | 'skipped';

export type ScheduledTaskRunTrigger = 'scheduled' | 'manual';

export type ScheduledTaskRow = {
  id: string;
  user_id: number;
  name: string;
  prompt: string;
  provider: string;
  model: string | null;
  effort: string | null;
  permission_mode: string | null;
  project_path: string;
  schedule_kind: ScheduledTaskScheduleKind;
  schedule_spec: string;
  timezone: string;
  enabled: number;
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ScheduledTaskRunRow = {
  id: string;
  task_id: string;
  user_id: number;
  trigger: ScheduledTaskRunTrigger;
  status: ScheduledTaskRunStatus;
  session_id: string | null;
  error: string | null;
  skipped_reason: string | null;
  scheduled_for: string | null;
  started_at: string;
  finished_at: string | null;
};

const TASK_COLUMNS =
  'id, user_id, name, prompt, provider, model, effort, permission_mode, project_path, schedule_kind, schedule_spec, timezone, enabled, next_run_at, last_run_at, created_at, updated_at';

const RUN_COLUMNS =
  'id, task_id, user_id, trigger, status, session_id, error, skipped_reason, scheduled_for, started_at, finished_at';

/** Reads one task after a write, so every mutation returns the persisted shape. */
function readTask(userId: number, id: string): ScheduledTaskRow | null {
  return (getConnection()
    .prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE id = ? AND user_id = ?`)
    .get(id, userId) as ScheduledTaskRow | undefined) ?? null;
}

/**
 * Persistence for scheduled tasks and their execution history.
 *
 * Used by the Scheduled Tasks module. The dispatcher's claim lives here rather
 * than in the service so that selecting due tasks and advancing their schedule
 * happen in one transaction: a second process polling the same database must
 * not be able to run the same cycle twice.
 */
export const scheduledTasksDb = {
  createTask(input: {
    userId: number;
    name: string;
    prompt: string;
    provider: string;
    model: string | null;
    effort: string | null;
    permissionMode: string | null;
    projectPath: string;
    scheduleKind: ScheduledTaskScheduleKind;
    scheduleSpec: unknown;
    timezone: string;
    nextRunAt: Date;
  }): ScheduledTaskRow {
    const db = getConnection();
    const id = randomUUID();

    db.prepare(
      `INSERT INTO scheduled_tasks
         (id, user_id, name, prompt, provider, model, effort, permission_mode,
          project_path, schedule_kind, schedule_spec, timezone, enabled, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      id,
      input.userId,
      input.name,
      input.prompt,
      input.provider,
      input.model,
      input.effort,
      input.permissionMode,
      input.projectPath,
      input.scheduleKind,
      JSON.stringify(input.scheduleSpec ?? {}),
      input.timezone,
      input.nextRunAt.toISOString(),
    );

    return db.prepare(`SELECT ${TASK_COLUMNS} FROM scheduled_tasks WHERE id = ?`).get(id) as ScheduledTaskRow;
  },

  listTasksForUser(userId: number): ScheduledTaskRow[] {
    return getConnection()
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM scheduled_tasks
         WHERE user_id = ?
         ORDER BY enabled DESC, next_run_at ASC`,
      )
      .all(userId) as ScheduledTaskRow[];
  },

  getTask(userId: number, id: string): ScheduledTaskRow | undefined {
    return readTask(userId, id) ?? undefined;
  },

  /** Applies only the fields given; every scheduling edit must pass the new `nextRunAt`. */
  updateTask(
    userId: number,
    id: string,
    patch: {
      name?: string;
      prompt?: string;
      provider?: string;
      model?: string | null;
      effort?: string | null;
      permissionMode?: string | null;
      projectPath?: string;
      scheduleKind?: ScheduledTaskScheduleKind;
      scheduleSpec?: unknown;
      timezone?: string;
      nextRunAt?: Date;
    },
  ): ScheduledTaskRow | null {
    const assignments: string[] = [];
    const values: unknown[] = [];

    const set = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (patch.name !== undefined) set('name', patch.name);
    if (patch.prompt !== undefined) set('prompt', patch.prompt);
    if (patch.provider !== undefined) set('provider', patch.provider);
    if (patch.model !== undefined) set('model', patch.model);
    if (patch.effort !== undefined) set('effort', patch.effort);
    if (patch.permissionMode !== undefined) set('permission_mode', patch.permissionMode);
    if (patch.projectPath !== undefined) set('project_path', patch.projectPath);
    if (patch.scheduleKind !== undefined) set('schedule_kind', patch.scheduleKind);
    if (patch.scheduleSpec !== undefined) set('schedule_spec', JSON.stringify(patch.scheduleSpec));
    if (patch.timezone !== undefined) set('timezone', patch.timezone);
    if (patch.nextRunAt !== undefined) set('next_run_at', patch.nextRunAt.toISOString());

    if (assignments.length === 0) {
      return readTask(userId, id);
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    const changed = getConnection()
      .prepare(`UPDATE scheduled_tasks SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...values).changes;

    return changed > 0 ? readTask(userId, id) : null;
  },

  /** Enabling recalculates the next run; the service supplies the instant. */
  setEnabled(userId: number, id: string, enabled: boolean, nextRunAt: Date | null): ScheduledTaskRow | null {
    const changed = getConnection()
      .prepare(
        `UPDATE scheduled_tasks
         SET enabled = ?, next_run_at = COALESCE(?, next_run_at), updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
      )
      .run(enabled ? 1 : 0, nextRunAt ? nextRunAt.toISOString() : null, id, userId).changes;

    return changed > 0 ? readTask(userId, id) : null;
  },

  deleteTask(userId: number, id: string): boolean {
    return getConnection()
      .prepare('DELETE FROM scheduled_tasks WHERE id = ? AND user_id = ?')
      .run(id, userId).changes > 0;
  },

  /**
   * Claims every enabled task whose time has come and advances it in the same
   * transaction.
   *
   * `advance` receives the claimed row and the poll's `now`, and returns the
   * next instant to run at, or `null` when the rule has no next occurrence
   * (a one-shot). The task is disabled in that case, so it stops appearing in
   * the poll instead of firing forever at a stale timestamp.
   *
   * Claiming instead of merely reading is what keeps two overlapping polls —
   * or two server processes sharing one database — from running one cycle
   * twice: the row is no longer due once this returns.
   */
  claimDueTasks(
    now: Date,
    advance: (task: ScheduledTaskRow, now: Date) => Date | null,
  ): ScheduledTaskRow[] {
    const db = getConnection();
    const nowIso = now.toISOString();

    return db.transaction(() => {
      const due = db
        .prepare(
          `SELECT ${TASK_COLUMNS} FROM scheduled_tasks
           WHERE enabled = 1 AND next_run_at <= ?
           ORDER BY next_run_at ASC`,
        )
        .all(nowIso) as ScheduledTaskRow[];

      const claimed: ScheduledTaskRow[] = [];
      for (const task of due) {
        const next = advance(task, now);
        db.prepare(
          `UPDATE scheduled_tasks
           SET next_run_at = COALESCE(?, next_run_at),
               enabled = ?,
               last_run_at = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(
          next ? next.toISOString() : null,
          next ? 1 : 0,
          task.next_run_at,
          task.id,
        );
        claimed.push(task);
      }

      return claimed;
    })();
  },

  createRun(input: {
    taskId: string;
    userId: number;
    trigger: ScheduledTaskRunTrigger;
    scheduledFor: Date | null;
  }): ScheduledTaskRunRow {
    const db = getConnection();
    const id = randomUUID();

    db.prepare(
      `INSERT INTO scheduled_task_runs
         (id, task_id, user_id, trigger, status, scheduled_for)
       VALUES (?, ?, ?, ?, 'running', ?)`,
    ).run(
      id,
      input.taskId,
      input.userId,
      input.trigger,
      input.scheduledFor ? input.scheduledFor.toISOString() : null,
    );

    return db
      .prepare(`SELECT ${RUN_COLUMNS} FROM scheduled_task_runs WHERE id = ?`)
      .get(id) as ScheduledTaskRunRow;
  },

  finishRun(
    id: string,
    input: {
      status: Exclude<ScheduledTaskRunStatus, 'running'>;
      sessionId?: string | null;
      error?: string | null;
      skippedReason?: string | null;
    },
  ): void {
    getConnection()
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = ?, session_id = ?, error = ?, skipped_reason = ?, finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        input.status,
        input.sessionId ?? null,
        input.error ? input.error.slice(0, 1000) : null,
        input.skippedReason ?? null,
        id,
      );
  },

  /** Newest first, limited because a task running every 15 minutes fills history quickly. */
  listRuns(taskId: string, limit: number): ScheduledTaskRunRow[] {
    return getConnection()
      .prepare(
        `SELECT ${RUN_COLUMNS} FROM scheduled_task_runs
         WHERE task_id = ?
         -- rowid breaks the tie between runs started in the same second, which
         -- happens whenever a skipped cycle and a real run share one.
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(taskId, limit) as ScheduledTaskRunRow[];
  },

  hasRunningRun(taskId: string): boolean {
    return Boolean(
      getConnection()
        .prepare("SELECT 1 FROM scheduled_task_runs WHERE task_id = ? AND status = 'running' LIMIT 1")
        .get(taskId),
    );
  },

  countRunningRuns(): number {
    const row = getConnection()
      .prepare("SELECT COUNT(*) AS count FROM scheduled_task_runs WHERE status = 'running'")
      .get() as { count: number };
    return row.count;
  },

  /**
   * Closes runs a previous process left open.
   *
   * A run is marked `running` before the provider turn starts and settled when
   * it ends. A crash or a restart in between leaves the row open forever, which
   * would both block that task and inflate the concurrency count. Anything
   * still running at startup belongs to a process that is gone.
   */
  failInterruptedRuns(reason: string): number {
    return getConnection()
      .prepare(
        `UPDATE scheduled_task_runs
         SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP
         WHERE status = 'running'`,
      )
      .run(reason).changes;
  },
};
