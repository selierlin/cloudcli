import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';
import type { BtwController } from '@/modules/chat/hooks/useBtwSession';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import { useBtwRestore } from '@/modules/chat/hooks/useBtwRestore';
import {
  BTW_SNAPSHOT_STORAGE_KEY,
  writeBtwSnapshot,
} from '@/modules/chat/utils/btwSnapshot';

/**
 * Bringing the drawer back after a reload.
 *
 * The hard part is not the write — it is deciding *when* the replay is safe:
 * the selected conversation, the auth session and the socket all arrive after
 * the first render, and a snapshot that belongs to another conversation must
 * be left alone rather than restored into whatever is on screen.
 */

const sessionDetails = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    sessionDetails: (...args: unknown[]) => sessionDetails(...args),
  },
}));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const SESSION_ID = 'btw-1';
const SOURCE_ID = 'source-1';

const row = (id: string, overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  id,
  sessionId: SESSION_ID,
  timestamp: '2026-01-01T00:00:00.000Z',
  provider: 'claude',
  kind: 'text',
  ...overrides,
});

const userRow = (id: string): NormalizedMessage => row(id, { kind: 'text', role: 'user', content: 'why?' });
const streamingRow = (content: string): NormalizedMessage => row('__streaming_btw-1', {
  kind: 'stream_delta',
  streamChannel: 'text',
  content,
});

type Recorder = {
  restored: Array<{ sessionId: string; forkSourceSessionId: string }>;
  seeded: Array<{ sessionId: string; messages: NormalizedMessage[] }>;
  observed: Array<[string | null, boolean]>;
  seededStreams: Array<{ sessionId: string; text: string; thinking: string }>;
  finalized: string[];
  dropped: string[];
  sent: Array<Record<string, unknown>>;
  ui: Array<{ anchor: unknown; minimized: boolean; truncated: boolean }>;
  lastSeq: Map<string, number>;
};

const createHarness = (options: { messages?: NormalizedMessage[] } = {}) => {
  const recorder: Recorder = {
    restored: [],
    seeded: [],
    observed: [],
    seededStreams: [],
    finalized: [],
    dropped: [],
    sent: [],
    ui: [],
    lastSeq: new Map(),
  };

  const btw = {
    sessionId: null as string | null,
    forkSourceSessionId: null as string | null,
    anchorInfo: null,
    restore: (state: { sessionId: string; forkSourceSessionId: string }) => {
      recorder.restored.push(state);
      btw.sessionId = state.sessionId;
      btw.forkSourceSessionId = state.forkSourceSessionId;
    },
  } as unknown as BtwController;

  const sessionStore = {
    seedSession: (sessionId: string, messages: NormalizedMessage[]) => {
      recorder.seeded.push({ sessionId, messages });
    },
    setObservedSession: (sessionId: string | null, value: boolean) => {
      recorder.observed.push([sessionId, value]);
    },
    finalizeStreaming: (sessionId: string) => { recorder.finalized.push(sessionId); },
    getMessages: () => options.messages ?? [],
  } as unknown as SessionStore;

  const streamBuffers = {
    seed: (sessionId: string, text: string, thinking: string) => {
      recorder.seededStreams.push({ sessionId, text, thinking });
    },
    drop: (sessionId: string) => { recorder.dropped.push(sessionId); },
    has: () => false,
  } as never;

  return { recorder, btw, sessionStore, streamBuffers };
};

type Harness = ReturnType<typeof createHarness>;

const renderRestore = (
  harness: Harness,
  overrides: Partial<Parameters<typeof useBtwRestore>[0]> = {},
) => renderHook((props: Partial<Parameters<typeof useBtwRestore>[0]>) => useBtwRestore({
  btw: harness.btw,
  sessionStore: harness.sessionStore,
  lastSeqRef: { current: harness.recorder.lastSeq },
  streamBuffers: harness.streamBuffers,
  sendMessage: (message) => { harness.recorder.sent.push(message as Record<string, unknown>); },
  processing: false,
  sourceSessionId: SOURCE_ID,
  anchor: null,
  minimized: false,
  isAuthReady: true,
  isConnected: true,
  onRestored: (state) => { harness.recorder.ui.push(state); },
  ...props,
}), { initialProps: overrides });

const seedSnapshot = (messages: NormalizedMessage[] = [userRow('u1')]) => {
  writeBtwSnapshot({
    forkSourceSessionId: SOURCE_ID,
    sessionId: SESSION_ID,
    lastSeq: 7,
    anchor: { forkAnchorId: 'anchor-1', messageId: 'message-1' },
    anchorInfo: {
      anchorForkId: 'anchor-1',
      anchorMessageId: 'message-1',
      anchorDegraded: false,
      anchorSource: 'explicit',
    },
    runParams: null,
    minimized: true,
    messages,
  });
};

beforeEach(() => {
  window.sessionStorage.clear();
  sessionDetails.mockReset();
  sessionDetails.mockResolvedValue(jsonResponse({ success: true, data: { sessionId: SESSION_ID } }));
});

test('a snapshot is replayed into the drawer, the store and the subscription', async () => {
  const harness = createHarness();
  seedSnapshot([userRow('u1'), streamingRow('half an ans')]);

  await act(async () => {
    renderRestore(harness);
  });

  assert.equal(harness.recorder.restored.length, 1);
  assert.equal(harness.recorder.restored[0].sessionId, SESSION_ID);
  assert.equal(harness.recorder.restored[0].forkSourceSessionId, SOURCE_ID);
  assert.equal(harness.recorder.seeded[0].sessionId, SESSION_ID);
  assert.deepEqual(harness.recorder.seeded[0].messages.map((message) => message.id), ['u1', '__streaming_btw-1']);
  assert.equal(harness.recorder.observed[0][0], SESSION_ID);
  // The replay resumes where the tab left off, not at the buffer's start.
  assert.equal(harness.recorder.lastSeq.get(SESSION_ID), 7);
  assert.deepEqual(harness.recorder.sent, [{
    type: 'chat.subscribe',
    sessions: [{ sessionId: SESSION_ID, lastSeq: 7 }],
  }]);
  // The interrupted reply becomes the buffer's starting text, so the next
  // delta extends it instead of replacing it.
  assert.deepEqual(harness.recorder.seededStreams, [{
    sessionId: SESSION_ID,
    text: 'half an ans',
    thinking: '',
  }]);
  // Back on screen, tucked away.
  assert.equal(harness.recorder.ui[0].minimized, true);
  assert.equal(harness.recorder.ui[0].truncated, false);
  assert.deepEqual(harness.recorder.ui[0].anchor, { forkAnchorId: 'anchor-1', messageId: 'message-1' });
});

test('a snapshot that had to drop turns tells the drawer it is partial', async () => {
  const harness = createHarness();
  const messages: NormalizedMessage[] = [];
  for (let i = 0; i < 60; i += 1) {
    messages.push(userRow(`u${i}`));
    messages.push(row(`a${i}`, { kind: 'text', role: 'assistant', content: 'x'.repeat(20_000) }));
  }
  seedSnapshot(messages);

  await act(async () => {
    renderRestore(harness);
  });

  assert.equal(harness.recorder.ui[0].truncated, true);
});

test('the restore waits for the conversation the drawer was forked from', async () => {
  const harness = createHarness();
  seedSnapshot();

  const view = renderRestore(harness, { sourceSessionId: null });
  await act(async () => {});

  assert.deepEqual(harness.recorder.restored, [], 'no source yet, nothing to attach to');

  await act(async () => {
    view.rerender({ sourceSessionId: SOURCE_ID });
  });

  assert.equal(harness.recorder.restored.length, 1);
});

test('a snapshot from another conversation is neither restored nor discarded', async () => {
  const harness = createHarness();
  seedSnapshot();

  await act(async () => {
    renderRestore(harness, { sourceSessionId: 'other-session' });
  });

  assert.deepEqual(harness.recorder.restored, []);
  assert.deepEqual(harness.recorder.sent, []);
  assert.notEqual(window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY), null);
});

test('a copy the server no longer has is dropped, not restored', async () => {
  const harness = createHarness();
  seedSnapshot();
  sessionDetails.mockResolvedValue(jsonResponse({
    success: false,
    error: { code: 'SESSION_NOT_FOUND', message: 'gone' },
  }, 404));

  await act(async () => {
    renderRestore(harness);
  });

  assert.deepEqual(harness.recorder.restored, []);
  assert.equal(window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY), null);
});

test('a failing probe keeps the snapshot for the next reload', async () => {
  const harness = createHarness();
  seedSnapshot();
  sessionDetails.mockResolvedValue(jsonResponse({ success: false, error: { code: 'INTERNAL' } }, 500));

  await act(async () => {
    renderRestore(harness);
  });

  assert.deepEqual(harness.recorder.restored, []);
  assert.notEqual(window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY), null);
});

test('nothing is attempted before the socket is up', async () => {
  const harness = createHarness();
  seedSnapshot();

  const view = renderRestore(harness, { isConnected: false });
  await act(async () => {});

  assert.equal(sessionDetails.mock.calls.length, 0);

  await act(async () => {
    view.rerender({ isConnected: true });
  });

  assert.equal(harness.recorder.restored.length, 1);
});

test('an idle ack settles the interrupted row instead of leaving it generating', async () => {
  const harness = createHarness();
  seedSnapshot([userRow('u1'), streamingRow('half an ans')]);

  const view = renderRestore(harness);
  await act(async () => {});
  const ack = view.result.current.handleSubscribeAck;

  act(() => {
    ack(SESSION_ID, true);
  });
  assert.deepEqual(harness.recorder.finalized, [], 'a running turn keeps streaming');

  act(() => {
    ack(SESSION_ID, false);
  });
  assert.deepEqual(harness.recorder.finalized, [SESSION_ID]);
  assert.deepEqual(harness.recorder.dropped, [SESSION_ID]);
});

test('the drawer is snapshotted when the tab goes away', async () => {
  const harness = createHarness({ messages: [userRow('u1')] });
  harness.btw.sessionId = SESSION_ID;
  harness.btw.forkSourceSessionId = SOURCE_ID;
  harness.recorder.lastSeq.set(SESSION_ID, 12);

  await act(async () => {
    renderRestore(harness, { minimized: true });
  });

  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });

  const raw = window.sessionStorage.getItem(BTW_SNAPSHOT_STORAGE_KEY);
  assert.ok(raw);
  const snapshot = JSON.parse(raw) as { sessionId: string; lastSeq: number; minimized: boolean; messages: unknown[] };
  assert.equal(snapshot.sessionId, SESSION_ID);
  assert.equal(snapshot.lastSeq, 12);
  assert.equal(snapshot.minimized, true);
  assert.equal(snapshot.messages.length, 1);
});
