import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeNextRun,
  parseSchedule,
} from '@/modules/scheduled-tasks/services/scheduled-task-schedule.service.js';

/** The wall clock in `timezone` at `instant`, which is what these assertions are about. */
function readLocal(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

test('a one-time schedule keeps its instant, and has no next occurrence after it', () => {
  const schedule = parseSchedule('once', { at: '2026-11-05T09:30:00.000Z' });

  assert.equal(
    computeNextRun(schedule, 'UTC', new Date('2026-11-04T00:00:00.000Z'))?.toISOString(),
    '2026-11-05T09:30:00.000Z',
  );
  assert.equal(computeNextRun(schedule, 'UTC', new Date('2026-11-05T09:30:00.000Z')), null);
});

test('an interval schedule advances by whole steps from its planned time, not from now', () => {
  const schedule = parseSchedule('interval', { everyMinutes: 60 });
  const planned = new Date('2026-11-04T10:00:00.000Z');

  // Fired 20 minutes late: the next one is still on the original hour.
  assert.equal(
    computeNextRun(schedule, 'UTC', new Date('2026-11-04T11:20:00.000Z'), planned)?.toISOString(),
    '2026-11-04T12:00:00.000Z',
  );
});

test('an interval schedule skips missed cycles without walking them', () => {
  const schedule = parseSchedule('interval', { everyMinutes: 90 });
  const planned = new Date('2026-10-01T00:00:00.000Z');
  const after = new Date('2026-11-01T00:00:00.000Z');

  const next = computeNextRun(schedule, 'UTC', after, planned);
  assert.ok(next);
  assert.ok(next.getTime() > after.getTime());
  assert.equal((next.getTime() - planned.getTime()) % (90 * 60_000), 0);
});

test('a daily schedule runs at the same wall-clock time in its own zone', () => {
  const schedule = parseSchedule('daily', { time: '09:00' });

  // 00:30Z is 08:30 in Shanghai, so today's 09:00 is still ahead.
  const next = computeNextRun(schedule, 'Asia/Shanghai', new Date('2026-11-04T00:30:00.000Z'));
  assert.equal(next?.toISOString(), '2026-11-04T01:00:00.000Z');
  assert.equal(readLocal(next!, 'Asia/Shanghai'), '2026-11-04, 09:00');
});

test('a daily schedule rolls to tomorrow once its time has passed', () => {
  const schedule = parseSchedule('daily', { time: '09:00' });

  // 01:30Z is 09:30 in Shanghai.
  const next = computeNextRun(schedule, 'Asia/Shanghai', new Date('2026-11-04T01:30:00.000Z'));
  assert.equal(next?.toISOString(), '2026-11-05T01:00:00.000Z');
});

test('a daily schedule keeps 09:00 local across a DST change', () => {
  const schedule = parseSchedule('daily', { time: '09:00' });
  const zone = 'America/New_York';

  // The day after the spring-forward transition (2026-03-08 in the US).
  const next = computeNextRun(schedule, zone, new Date('2026-03-08T05:00:00.000Z'));
  assert.ok(next);
  assert.equal(readLocal(next, zone), '2026-03-08, 09:00');

  const nextFall = computeNextRun(schedule, zone, new Date('2026-11-01T05:00:00.000Z'));
  assert.ok(nextFall);
  assert.equal(readLocal(nextFall, zone), '2026-11-01, 09:00');
});

test('a weekly schedule lands on the next selected weekday', () => {
  const schedule = parseSchedule('weekly', { time: '08:15', weekdays: [1, 4] });
  const zone = 'Europe/Berlin';

  // 2026-11-04 is a Wednesday.
  const next = computeNextRun(schedule, zone, new Date('2026-11-04T12:00:00.000Z'));
  assert.ok(next);
  assert.equal(readLocal(next, zone), '2026-11-05, 08:15');
});

test('a weekly schedule skips to the following week when its only day is today and past', () => {
  const schedule = parseSchedule('weekly', { time: '08:00', weekdays: [3] });
  const zone = 'UTC';

  const next = computeNextRun(schedule, zone, new Date('2026-11-04T09:00:00.000Z'));
  assert.equal(next?.toISOString(), '2026-11-11T08:00:00.000Z');
});

test('invalid schedule specs are rejected at the transport boundary', () => {
  assert.throws(() => parseSchedule('once', { at: 'not-a-date' }), /valid run time/);
  assert.throws(() => parseSchedule('interval', { everyMinutes: 0 }), /interval/);
  assert.throws(() => parseSchedule('daily', { time: '9:00' }), /HH:mm/);
  assert.throws(() => parseSchedule('weekly', { time: '09:00', weekdays: [] }), /weekday/);
  assert.throws(() => parseSchedule('weekly', { time: '09:00', weekdays: [7] }), /weekday/);
});
