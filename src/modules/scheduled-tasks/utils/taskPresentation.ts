import type { ScheduledTaskRun, ScheduledTaskSchedule } from '@/shared/types';

/** Renders a one-off rule's instant for the sentence `describeSchedule` builds. */
function formatDateTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/**
 * The sidebar row has ~200px for the next-run line. Dropping the year and the
 * seconds keeps the date readable there; a scheduled task is never more than a
 * few weeks out, so the year adds nothing the user is looking for.
 */
export function formatShortDateTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Renders the rule as a sentence the user can check at a glance. */
export function describeSchedule(
  schedule: ScheduledTaskSchedule,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (schedule.kind === 'once') {
    return t('scheduledTasks.describeOnce', { time: formatDateTime(schedule.at) });
  }
  if (schedule.kind === 'interval') {
    if (schedule.everyMinutes % 60 === 0) {
      return t('scheduledTasks.describeEveryHours', { count: schedule.everyMinutes / 60 });
    }
    return t('scheduledTasks.describeEveryMinutes', { count: schedule.everyMinutes });
  }
  if (schedule.kind === 'daily') {
    return t('scheduledTasks.describeDaily', { time: schedule.time });
  }
  return t('scheduledTasks.describeWeekly', {
    time: schedule.time,
    days: schedule.weekdays.map((day) => t(`scheduledTasks.weekdayShort.${day}`)).join(' '),
  });
}

export const RUN_STATUS_CLASSES: Record<ScheduledTaskRun['status'], string> = {
  running: 'bg-primary/10 text-primary',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-destructive/10 text-destructive',
  skipped: 'bg-muted text-muted-foreground',
};
