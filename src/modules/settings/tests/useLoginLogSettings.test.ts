import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useLoginLogSettings } from '@/modules/settings/hooks/useLoginLogSettings';
import type { AuthEventRow } from '@/shared/types';

/**
 * The bug: both text filters called `updateFilters` on every keystroke, which
 * rebuilt the fetch callback and fired a request per character — with no order
 * guard, a slow early response could overwrite the newest page, and every
 * request blanked the table into a spinner. These tests pin the debounce, the
 * immediate event-type switch, the stale-response guard and the refresh path.
 */

const apiMocks = vi.hoisted(() => ({ authEvents: vi.fn() }));

vi.mock('@/shared/api', () => ({
  api: { settings: { authEvents: apiMocks.authEvents } },
}));

const jsonResponse = (events: AuthEventRow[] = [], total = 0) => new Response(
  JSON.stringify({ events, total }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

const event = (id: number): AuthEventRow => ({
  id,
  event_type: 'login_success',
  user_id: 1,
  username: 'tester',
  ip: '127.0.0.1',
  user_agent: null,
  created_at: '2026-10-27 00:00:00',
});

const lastParams = (): { username?: string; eventType?: string; ip?: string; signal?: AbortSignal } | undefined =>
  apiMocks.authEvents.mock.calls.at(-1)?.[0] as
    | { username?: string; eventType?: string; ip?: string; signal?: AbortSignal }
    | undefined;

/** Lets the request promise chain settle while the timers stay fake. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const nextTurn = (): { promise: Promise<Response>; resolve: (response: Response) => void } => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  apiMocks.authEvents.mockReset();
  // A fresh Response per call: a shared one would be unreadable after the first
  // `json()`, which looks like a real fetch failure in the hook.
  apiMocks.authEvents.mockImplementation(async () => jsonResponse([event(1)], 1));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('typing a username waits for the input to settle instead of querying per keystroke', async () => {
  const { result } = renderHook(() => useLoginLogSettings());
  await settle();
  assert.equal(apiMocks.authEvents.mock.calls.length, 1, 'the mount query runs once');

  act(() => result.current.updateFilters({ username: '2' }));
  act(() => result.current.updateFilters({ username: '21' }));
  act(() => result.current.updateFilters({ username: '218' }));
  await settle();

  assert.equal(apiMocks.authEvents.mock.calls.length, 1, 'nothing is queried inside the debounce window');

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });

  assert.equal(apiMocks.authEvents.mock.calls.length, 2, 'the settled value produces exactly one query');
  assert.equal(lastParams()?.username, '218');
});

test('picking an event type applies at once instead of waiting for the debounce', async () => {
  const { result } = renderHook(() => useLoginLogSettings());
  await settle();

  act(() => result.current.updateFilters({ eventType: 'login_failure' }));
  await settle();

  assert.equal(apiMocks.authEvents.mock.calls.length, 2);
  assert.equal(lastParams()?.eventType, 'login_failure');
});

test('a response that lost the race cannot overwrite the newer page', async () => {
  const { result } = renderHook(() => useLoginLogSettings());
  await settle();

  const slow = nextTurn();
  const fast = nextTurn();
  apiMocks.authEvents
    .mockReturnValueOnce(slow.promise)
    .mockReturnValueOnce(fast.promise);

  act(() => result.current.updateFilters({ username: 'a' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  const slowParams = lastParams();

  act(() => result.current.updateFilters({ username: 'ab' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });

  assert.equal(slowParams?.signal?.aborted, true, 'the superseded request is cancelled');

  await act(async () => {
    fast.resolve(jsonResponse([event(7), event(8)], 2));
  });
  await act(async () => {
    slow.resolve(jsonResponse([event(9)], 1));
  });

  assert.equal(result.current.total, 2, 'the late response is ignored');
  assert.equal(result.current.events.length, 2);
});

test('refresh applies text still waiting on the debounce, in one request', async () => {
  const { result } = renderHook(() => useLoginLogSettings());
  await settle();

  act(() => result.current.updateFilters({ ip: '218.66' }));
  act(() => result.current.refresh());
  await settle();

  assert.equal(apiMocks.authEvents.mock.calls.length, 2, 'refresh does not queue a second request');
  assert.equal(lastParams()?.ip, '218.66');
});

test('only the first load blanks the table; a refresh keeps the rows', async () => {
  const { result } = renderHook(() => useLoginLogSettings());
  assert.equal(result.current.initialLoading, true);

  await settle();
  assert.equal(result.current.initialLoading, false);
  assert.equal(result.current.events.length, 1);

  const pending = nextTurn();
  apiMocks.authEvents.mockReturnValueOnce(pending.promise);
  act(() => result.current.refresh());
  await settle();

  assert.equal(result.current.loading, true);
  assert.equal(result.current.initialLoading, false, 'a refresh must not replace the rows with a spinner');
  assert.equal(result.current.events.length, 1);

  await act(async () => {
    pending.resolve(jsonResponse([event(2), event(3)], 2));
  });
  assert.equal(result.current.loading, false);
  assert.equal(result.current.total, 2);
});
