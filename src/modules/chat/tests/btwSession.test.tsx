import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { useBtwSession } from '@/modules/chat/hooks/useBtwSession';

/**
 * The drawer's lifecycle, driven through the real hook.
 *
 * Two properties matter and neither is observable from the rendered output:
 * the copy is deleted only when DELETE actually succeeded (a 409 keeps it on
 * screen), and promoting must never issue a DELETE — that would remove the
 * conversation the reader just chose to keep.
 */

const btwSession = vi.fn();
const deleteBtwSession = vi.fn();
const promoteBtwSession = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    btwSession: (...args: unknown[]) => btwSession(...args),
    deleteBtwSession: (...args: unknown[]) => deleteBtwSession(...args),
    promoteBtwSession: (...args: unknown[]) => promoteBtwSession(...args),
  },
}));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const CREATED = {
  success: true,
  data: {
    sessionId: 'btw-1',
    provider: 'claude',
    projectPath: '/tmp/project',
    sessionName: 'Session (btw)',
    anchorForkId: 'anchor-1',
    anchorMessageId: 'message-1',
    anchorDegraded: false,
    anchorSource: 'default',
  },
};

const createStore = () => {
  const observed: Array<[string | null, boolean]> = [];
  const dropped: string[] = [];
  const appended: NormalizedMessage[] = [];
  const store = {
    setObservedSession: (sessionId: string | null, value: boolean) => { observed.push([sessionId, value]); },
    dropSession: (sessionId: string) => { dropped.push(sessionId); },
    appendRealtime: (_sessionId: string, message: NormalizedMessage) => { appended.push(message); },
  } as unknown as SessionStore;
  return { store, observed, dropped, appended };
};

const renderBtw = (store: SessionStore, sent: Array<Record<string, unknown>>) => renderHook(() => useBtwSession({
  sourceSessionId: 'source-1',
  provider: 'claude',
  anchor: null,
  sendMessage: (message) => { sent.push(message as Record<string, unknown>); },
  sessionStore: store,
  buildOptions: (text) => ({ permissionMode: 'default', probe: text }),
}));

beforeEach(() => {
  btwSession.mockReset();
  deleteBtwSession.mockReset();
  promoteBtwSession.mockReset();
  btwSession.mockResolvedValue(jsonResponse(CREATED, 201));
});

test('the first question creates the copy, then sends into it with the shared options', async () => {
  const { store, observed, appended } = createStore();
  const sent: Array<Record<string, unknown>> = [];
  const view = renderBtw(store, sent);

  await act(async () => {
    assert.equal(await view.result.current.send('why is this failing?'), true);
  });

  assert.equal(btwSession.mock.calls[0][0], 'source-1');
  assert.deepEqual(sent[0], {
    type: 'chat.subscribe',
    sessions: [{ sessionId: 'btw-1', lastSeq: 0 }],
  });
  assert.equal(sent[1].type, 'chat.send');
  assert.equal(sent[1].sessionId, 'btw-1');
  assert.deepEqual(sent[1].options, { permissionMode: 'default', probe: 'why is this failing?' });
  assert.equal(view.result.current.sessionId, 'btw-1');
  // The optimistic echo is what keeps the question visible before the run
  // starts; without it the copy looks like it ignored the input.
  assert.equal(appended.length, 1);
  assert.equal(appended[0].content, 'why is this failing?');
  assert.deepEqual(observed[0], ['btw-1', true]);
});

test('stopping the copy aborts it without touching the source conversation', async () => {
  const { store } = createStore();
  const sent: Array<Record<string, unknown>> = [];
  const view = renderBtw(store, sent);

  await act(async () => {
    await view.result.current.send('long one');
  });
  act(() => {
    view.result.current.abort();
  });

  assert.deepEqual(sent.at(-1), { type: 'chat.abort', sessionId: 'btw-1' });
});

test('a 409 keeps the copy instead of hiding it', async () => {
  const { store, dropped } = createStore();
  const sent: Array<Record<string, unknown>> = [];
  const view = renderBtw(store, sent);

  await act(async () => {
    await view.result.current.send('still running?');
  });
  deleteBtwSession.mockResolvedValue(jsonResponse({
    success: false,
    error: { code: 'BTW_STILL_RUNNING', message: 'still finishing' },
  }, 409));

  let closed = true;
  await act(async () => {
    closed = await view.result.current.close();
  });

  assert.equal(closed, false);
  assert.equal(view.result.current.closeFailure, 'still-running');
  assert.equal(view.result.current.sessionId, 'btw-1', 'the drawer must keep showing the copy');
  assert.deepEqual(dropped, []);
});

test('a successful delete drops the slot and forgets the copy', async () => {
  const { store, observed, dropped } = createStore();
  const sent: Array<Record<string, unknown>> = [];
  const view = renderBtw(store, sent);

  await act(async () => {
    await view.result.current.send('one quick question');
  });
  deleteBtwSession.mockResolvedValue(jsonResponse({ success: true, data: { sessionId: 'btw-1' } }));

  let closed = false;
  await act(async () => {
    closed = await view.result.current.close();
  });

  assert.equal(closed, true);
  assert.equal(view.result.current.sessionId, null);
  assert.deepEqual(dropped, ['btw-1']);
  assert.deepEqual(observed.at(-1), ['btw-1', false]);
});

test('closing while the first question is still being forked deletes the copy and drops the question', async () => {
  const { store, dropped, appended } = createStore();
  const sent: Array<Record<string, unknown>> = [];
  const view = renderBtw(store, sent);

  // Hold the fork open: this is the window a reader can shut the drawer in.
  let finishCreate: (response: Response) => void = () => {};
  btwSession.mockImplementation(() => new Promise<Response>((resolve) => { finishCreate = resolve; }));
  deleteBtwSession.mockResolvedValue(jsonResponse({ success: true, data: { sessionId: 'btw-1' } }));

  let sending: Promise<boolean> | null = null;
  await act(async () => {
    sending = view.result.current.send('asked too soon');
  });
  assert.equal(btwSession.mock.calls.length, 1, 'the fork is in flight');

  let closed = false;
  await act(async () => {
    const closing = view.result.current.close();
    finishCreate(jsonResponse(CREATED, 201));
    closed = await closing;
  });

  assert.equal(await sending, false, 'the question must not reach the deleted copy');
  assert.equal(closed, true);
  assert.deepEqual(deleteBtwSession.mock.calls[0], ['btw-1']);
  assert.equal(sent.some((message) => message.type === 'chat.send'), false);
  assert.equal(appended.length, 0);
  assert.deepEqual(dropped, ['btw-1']);
});

test('promoting never issues a delete', async () => {
  const { store, dropped } = createStore();
  const sent: Array<Record<string, unknown>> = [];
  const view = renderBtw(store, sent);

  await act(async () => {
    await view.result.current.send('keep this one');
  });
  promoteBtwSession.mockResolvedValue(jsonResponse({
    success: true,
    data: { sessionId: 'btw-1', sessionName: 'Session (btw)' },
  }));

  let promoted: string | null = null;
  await act(async () => {
    promoted = await view.result.current.promote();
  });

  assert.equal(promoted, 'btw-1');
  assert.equal(deleteBtwSession.mock.calls.length, 0);
  // The slot is dropped locally, but the row itself stays in the database.
  assert.deepEqual(dropped, ['btw-1']);
});
