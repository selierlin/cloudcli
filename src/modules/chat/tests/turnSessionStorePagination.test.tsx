import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const message = (id: string, role: 'user' | 'assistant'): NormalizedMessage => ({
  id,
  sessionId: 'session-1',
  timestamp: `2026-09-16T10:00:0${id.slice(1)}.000Z`,
  provider: 'claude',
  kind: 'text',
  role,
  content: id,
});

const pageResponse = (
  messages: NormalizedMessage[],
  nextCursor: string | null,
  hasMore: boolean,
  newerCursor: string | null = null,
) => ({
  ok: true,
  json: async () => ({
    data: {
      messages,
      total: 4,
      hasMore,
      pageInfo: {
        mode: 'turns',
        snapshotVersion: 'snapshot-1',
        nextCursor,
        newerCursor,
        partial: { older: false, newer: false },
      },
    },
  }),
});

beforeEach(() => {
  sessionMessages.mockReset();
  sessionMessages
    .mockResolvedValueOnce(pageResponse([message('u2', 'user'), message('a2', 'assistant')], 'older-1', true))
    .mockResolvedValueOnce(pageResponse([message('u1', 'user'), message('a1', 'assistant')], null, false));
});

afterEach(() => {
  vi.resetModules();
});

test('the session store continues Turn history with the server cursor', async () => {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());

  await act(async () => {
    await view.result.current.fetchFromServer('session-1', {
      pageMode: 'turns',
      byteBudget: 262_144,
    });
  });
  assert.deepEqual(sessionMessages.mock.calls[0]?.[1], {
    pageMode: 'turns',
    byteBudget: 262_144,
  });

  await act(async () => {
    await view.result.current.fetchMore('session-1');
  });

  assert.deepEqual(sessionMessages.mock.calls[1]?.[1], {
    pageMode: 'turns',
    byteBudget: 262_144,
    cursor: 'older-1',
  });
  assert.deepEqual(
    view.result.current.getMessages('session-1').map((entry) => entry.id),
    ['u1', 'a1', 'u2', 'a2'],
  );
  assert.equal(view.result.current.getSessionSlot('session-1')?.hasMore, false);
});

test('a stale Turn cursor restarts from a fresh latest snapshot', async () => {
  sessionMessages.mockReset();
  sessionMessages
    .mockResolvedValueOnce(pageResponse([message('u2', 'user'), message('a2', 'assistant')], 'stale-1', true))
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'STALE_HISTORY_CURSOR' } }),
    })
    .mockResolvedValueOnce(pageResponse([message('u3', 'user'), message('a3', 'assistant')], 'fresh-1', true));
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());

  await act(async () => {
    await view.result.current.fetchFromServer('session-1', {
      pageMode: 'turns',
      byteBudget: 262_144,
    });
    await view.result.current.fetchMore('session-1');
  });

  assert.deepEqual(sessionMessages.mock.calls[2]?.[1], {
    pageMode: 'turns',
    byteBudget: 262_144,
  });
  assert.deepEqual(
    view.result.current.getMessages('session-1').map((entry) => entry.id),
    ['u3', 'a3'],
  );
  assert.equal(
    view.result.current.getSessionSlot('session-1')?.turnPageInfo?.nextCursor,
    'fresh-1',
  );
});

test('a sought middle window appends newer Turns without losing its older continuation', async () => {
  sessionMessages.mockReset();
  sessionMessages
    .mockResolvedValueOnce(pageResponse(
      [message('u2', 'user'), message('a2', 'assistant')],
      'older-1',
      true,
      'newer-1',
    ))
    .mockResolvedValueOnce(pageResponse(
      [message('u3', 'user'), message('a3', 'assistant')],
      'back-to-middle',
      true,
      null,
    ));
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());

  await act(async () => {
    await view.result.current.fetchFromServer('session-1', {
      pageMode: 'turns',
      seek: { timestamp: '2026-09-16T10:00:02.000Z', snippet: 'u2' },
    });
    await view.result.current.fetchNewer('session-1');
  });

  assert.deepEqual(sessionMessages.mock.calls[1]?.[1], {
    pageMode: 'turns',
    cursor: 'newer-1',
  });
  assert.deepEqual(
    view.result.current.getMessages('session-1').map((entry) => entry.id),
    ['u2', 'a2', 'u3', 'a3'],
  );
  assert.equal(view.result.current.getSessionSlot('session-1')?.turnPageInfo?.nextCursor, 'older-1');
  assert.equal(view.result.current.getSessionSlot('session-1')?.turnPageInfo?.newerCursor, null);
});

test('a sought middle window prepends older Turns without rewinding its newer continuation', async () => {
  sessionMessages.mockReset();
  sessionMessages
    .mockResolvedValueOnce(pageResponse(
      [message('u2', 'user'), message('a2', 'assistant')],
      'older-1',
      true,
      'newer-1',
    ))
    .mockResolvedValueOnce(pageResponse(
      [message('u1', 'user'), message('a1', 'assistant')],
      null,
      false,
      'back-to-middle',
    ));
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());

  await act(async () => {
    await view.result.current.fetchFromServer('session-1', {
      pageMode: 'turns',
      seek: { timestamp: '2026-09-16T10:00:02.000Z' },
    });
    await view.result.current.fetchMore('session-1');
  });

  assert.deepEqual(
    view.result.current.getMessages('session-1').map((entry) => entry.id),
    ['u1', 'a1', 'u2', 'a2'],
  );
  assert.equal(view.result.current.getSessionSlot('session-1')?.turnPageInfo?.nextCursor, null);
  assert.equal(
    view.result.current.getSessionSlot('session-1')?.turnPageInfo?.newerCursor,
    'newer-1',
  );
});

test('a stale newer cursor restarts at the latest Turn page instead of retrying forever', async () => {
  sessionMessages.mockReset();
  sessionMessages
    .mockResolvedValueOnce(pageResponse(
      [message('u2', 'user'), message('a2', 'assistant')],
      'older-1',
      true,
      'stale-newer',
    ))
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'STALE_HISTORY_CURSOR' } }),
    })
    .mockResolvedValueOnce(pageResponse(
      [message('u3', 'user'), message('a3', 'assistant')],
      'fresh-older',
      true,
      null,
    ));
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());

  await act(async () => {
    await view.result.current.fetchFromServer('session-1', {
      pageMode: 'turns',
      seek: { timestamp: '2026-09-16T10:00:02.000Z' },
    });
    await view.result.current.fetchNewer('session-1');
  });

  assert.deepEqual(sessionMessages.mock.calls[2]?.[1], { pageMode: 'turns' });
  assert.deepEqual(
    view.result.current.getMessages('session-1').map((entry) => entry.id),
    ['u3', 'a3'],
  );
  assert.equal(view.result.current.getSessionSlot('session-1')?.turnPageInfo?.newerCursor, null);
});
