import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * Two store behaviours the side-question drawer depends on.
 *
 * The store deliberately keeps every slot and only repaints the selected
 * conversation. A drawer renders a copy that is *not* selected, so it needs both
 * an explicit observation (repaint for this slot) and an explicit drop (the copy
 * was deleted, its rows must not stay resident).
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const row = (id: string, content: string, sessionId = 'session-1'): NormalizedMessage => ({
  id,
  kind: 'text',
  role: 'assistant',
  provider: 'claude',
  sessionId,
  content,
  timestamp: '2026-01-01T00:00:00.000Z',
} as NormalizedMessage);

beforeEach(() => {
  sessionMessages.mockReset();
  sessionMessages.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { messages: [], total: 0, hasMore: false } }),
  });
});

test('an observed session repaints on updates without becoming the active one', async () => {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  let renders = 0;
  const view = renderHook(() => {
    renders += 1;
    return useSessionStore();
  });

  const before = renders;
  act(() => {
    view.result.current.appendRealtime('btw-1', row('a', 'first'));
  });
  assert.equal(renders, before, 'a non-selected, unobserved slot must not repaint the tree');

  act(() => {
    view.result.current.setObservedSession('btw-1', true);
  });
  const observedAt = renders;

  act(() => {
    view.result.current.appendRealtime('btw-1', row('b', 'second'));
  });
  assert.ok(renders > observedAt, 'the observed slot must repaint the tree');
  assert.equal(view.result.current.getMessages('btw-1').length, 2);
});

test('dropping a session discards its rows', async () => {
  const { useSessionStore } = await import('@/modules/chat/hooks/useSessionStore');
  const view = renderHook(() => useSessionStore());

  act(() => {
    view.result.current.setObservedSession('btw-1', true);
    view.result.current.appendRealtime('btw-1', row('a', 'only row'));
  });
  assert.equal(view.result.current.getMessages('btw-1').length, 1);

  act(() => {
    view.result.current.dropSession('btw-1');
  });

  assert.equal(view.result.current.getMessages('btw-1').length, 0);
  assert.equal(view.result.current.getSessionSlot('btw-1'), undefined);
});
