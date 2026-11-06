import type {
  ScheduledTaskRow,
  ScheduledTaskScheduleKind,
} from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

// --------------------------- SCHEDULE SHAPE AND VALIDATION ---------------------------

/** The wall-clock fields a repeat rule is written in; `kind` names which ones apply. */
export type ScheduledTaskSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] };

const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validated once at task creation and again at every claim, so a hand-edited row cannot loop forever. */
export function parseSchedule(kind: ScheduledTaskScheduleKind, spec: unknown): ScheduledTaskSchedule {
  const record = spec && typeof spec === 'object' ? spec as Record<string, unknown> : {};

  if (kind === 'once') {
    const at = typeof record.at === 'string' ? record.at : '';
    const parsed = new Date(at);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('A one-time task needs a valid run time.', {
        code: 'INVALID_SCHEDULE_SPEC',
        statusCode: 400,
      });
    }
    return { kind, at: parsed.toISOString() };
  }

  if (kind === 'interval') {
    const everyMinutes = Number(record.everyMinutes);
    if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > MAX_INTERVAL_MINUTES) {
      throw new AppError('A repeating task needs an interval between 1 minute and 7 days.', {
        code: 'INVALID_SCHEDULE_SPEC',
        statusCode: 400,
      });
    }
    return { kind, everyMinutes };
  }

  const time = typeof record.time === 'string' ? record.time : '';
  if (!TIME_OF_DAY_PATTERN.test(time)) {
    throw new AppError('A daily task needs a time of day in HH:mm form.', {
      code: 'INVALID_SCHEDULE_SPEC',
      statusCode: 400,
    });
  }

  if (kind === 'daily') {
    return { kind, time };
  }

  const weekdays = Array.isArray(record.weekdays)
    ? Array.from(new Set(record.weekdays.map(Number))).sort((a, b) => a - b)
    : [];
  if (weekdays.length === 0 || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new AppError('A weekly task needs at least one weekday between Sunday (0) and Saturday (6).', {
      code: 'INVALID_SCHEDULE_SPEC',
      statusCode: 400,
    });
  }

  return { kind, time, weekdays };
}

/** Rejects a zone the runtime does not know, at the point the user typed it. */
export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new AppError(`Unknown time zone "${timezone}".`, {
      code: 'INVALID_TIMEZONE',
      statusCode: 400,
    });
  }
}

// --------------------------- TIME-ZONE ARITHMETIC ---------------------------

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function readZonedParts(instant: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // `en-US` with hour12:false can render midnight as 24 on some ICU versions.
  const hour = read('hour') % 24;

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  };
}

/** Offset of `timezone` from UTC at one instant, in milliseconds. */
function readZoneOffsetMs(instant: Date, timezone: string): number {
  const parts = readZonedParts(instant, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  // The parts only carry minutes, so compare against the instant truncated to
  // the same precision.
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * Turns a wall-clock time in `timezone` into an instant.
 *
 * Two passes, because the zone offset of the candidate instant is not known
 * before the instant is. A time skipped by a spring-forward transition resolves
 * to the instant just after the gap, and a time repeated by a fall-back
 * transition resolves to the first occurrence — either is a reasonable reading
 * of "09:00" on that day, and both keep the job running once.
 */
function zonedWallClockToInstant(parts: ZonedParts, timezone: string): Date {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const firstOffset = readZoneOffsetMs(new Date(guess), timezone);
  const first = guess - firstOffset;
  const secondOffset = readZoneOffsetMs(new Date(first), timezone);
  return new Date(guess - secondOffset);
}

// --------------------------- NEXT-OCCURRENCE ---------------------------

function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const [, hour, minute] = TIME_OF_DAY_PATTERN.exec(time) ?? ['', '0', '0'];
  return { hour: Number(hour), minute: Number(minute) };
}

/**
 * Returns the next instant this schedule should run at, strictly after
 * `after`, or `null` when it has no further occurrence.
 *
 * `previousScheduledFor` anchors interval rules: the next run is measured from
 * the previous *planned* time, not from "now", so a job that fires late keeps
 * its original phase instead of drifting a little on every pass. Daily and
 * weekly rules ignore it — they are defined by wall-clock time and skip missed
 * occurrences rather than making them up.
 */
export function computeNextRun(
  schedule: ScheduledTaskSchedule,
  timezone: string,
  after: Date,
  previousScheduledFor: Date | null = null,
): Date | null {
  if (schedule.kind === 'once') {
    const at = new Date(schedule.at);
    return at.getTime() > after.getTime() ? at : null;
  }

  if (schedule.kind === 'interval') {
    const stepMs = schedule.everyMinutes * 60_000;
    const anchor = previousScheduledFor?.getTime() ?? after.getTime();
    // Jump whole steps rather than iterating: a server that was down for a
    // month must not walk a month of missed cycles.
    const elapsed = after.getTime() - anchor;
    const steps = elapsed >= 0 ? Math.floor(elapsed / stepMs) + 1 : 1;
    return new Date(anchor + steps * stepMs);
  }

  const { hour, minute } = parseTimeOfDay(schedule.time);
  const now = readZonedParts(after, timezone);
  const nowMinuteOfDay = now.hour * 60 + now.minute;

  // At most 8 days: today plus one full week covers every weekday rule.
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidateDay = new Date(Date.UTC(now.year, now.month - 1, now.day + dayOffset));
    const weekday = candidateDay.getUTCDay();

    if (schedule.kind === 'weekly' && !schedule.weekdays.includes(weekday)) {
      continue;
    }
    // Today only counts when the time has not already passed to the minute.
    if (dayOffset === 0 && nowMinuteOfDay >= hour * 60 + minute) {
      continue;
    }

    return zonedWallClockToInstant(
      {
        year: candidateDay.getUTCFullYear(),
        month: candidateDay.getUTCMonth() + 1,
        day: candidateDay.getUTCDate(),
        hour,
        minute,
      },
      timezone,
    );
  }

  return null;
}

/**
 * Advances one claimed task row to its next occurrence.
 *
 * Used by the dispatcher as the `advance` callback of `claimDueTasks`, so the
 * rule interpretation lives with the schedule model instead of the repository.
 */
export function advanceTaskSchedule(task: ScheduledTaskRow, now: Date): Date | null {
  const schedule = parseSchedule(task.schedule_kind, JSON.parse(task.schedule_spec || '{}'));
  return computeNextRun(schedule, task.timezone, now, new Date(task.next_run_at));
}
