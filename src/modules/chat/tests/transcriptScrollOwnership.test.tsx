import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * The transcript's scroll position is written from five places coordinated by
 * refs and animation frames rather than by one owner. These tests pin user
 * ownership and same-row growth without relying on browser layout.
 */

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';
let nextFrameId = 1;
let frameCallbacks = new Map<number, FrameRequestCallback>();

function runAnimationFrame(timestamp = 16): void {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  callbacks.forEach(callback => callback(timestamp));
}

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

const buildMessage = (index: number, timestamp: string): NormalizedMessage => ({
  id: `m-${index}`,
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: SESSION_A,
  content: `message ${index}`,
  timestamp,
} as NormalizedMessage);

/** A transcript long enough that the render window is a strict tail slice. */
const buildMessages = (count: number): NormalizedMessage[] => Array.from(
  { length: count },
  (_, index) => buildMessage(index, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()),
);

/**
 * jsdom has no layout, so scrollHeight/clientHeight are always 0 and assigning
 * scrollTop emits nothing. These are the exact reads the scroll code makes.
 */
function createContainer(scrollHeight: number, clientHeight: number) {
  const element = document.createElement('div');
  const writes: number[] = [];
  let currentScrollHeight = scrollHeight;
  let scrollTop = scrollHeight - clientHeight;

  Object.defineProperty(element, 'scrollHeight', { get: () => currentScrollHeight });
  Object.defineProperty(element, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes.push(next);
    },
  });

  return {
    element: element as HTMLDivElement,
    writes,
    scrollHeight,
    setScrollHeight: (next: number) => {
      currentScrollHeight = next;
    },
  };
}

function createStore(messagesBySession: Map<string, NormalizedMessage[]>) {
  // A hydrated slot, so the session-loading effect takes its early return
  // instead of re-fetching on every render.
  const slotFor = (sessionId: string) => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: messagesBySession.get(sessionId)?.length ?? 0,
    hasMore: false,
    offset: messagesBySession.get(sessionId)?.length ?? 0,
  });

  return {
    fetchFromServer: vi.fn(async (sessionId: string) => slotFor(sessionId)),
    fetchMore: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), prependedCount: 0 })),
    appendRealtime: vi.fn(),
    refreshLatestFromServer: vi.fn(async (sessionId: string) => ({
      slot: slotFor(sessionId),
      applied: true,
      changed: false,
      deferred: false,
    })),
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreamingBatch: vi.fn(),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn((sessionId: string) => messagesBySession.get(sessionId) ?? []),
    getSessionSlot: vi.fn((sessionId: string) => slotFor(sessionId)),
  };
}

async function renderChatSessionState(options: {
  session: ProjectSession;
  store: ReturnType<typeof createStore>;
  isActive?: boolean;
}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  return renderHook(
    ({ session, isActive = true }: { session: ProjectSession; isActive?: boolean }) =>
      useChatSessionState({
        isActive,
        selectedProject: project,
        selectedSession: session,
        ws: null,
        sendMessage: vi.fn(),
        statusCheckSentAtRef: { current: new Map() },
        lastSeqRef: { current: new Map() },
        sessionStore: options.store as never,
      }),
    { initialProps: { session: options.session, isActive: options.isActive } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  nextFrameId = 1;
  frameCallbacks = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id);
  });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('deferred scroll-to-bottom', () => {
  it('lets the user cancel the initial settle loop', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
      result.current.setIsUserScrolledUp(true);
      runAnimationFrame();
    });

    assert.deepEqual(container.writes, []);
  });

  it('does not yank the view back down when the user scrolls up inside the delay', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    // A new row lands while the user is at the bottom: one follow frame is armed.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    // ...and the user drags upward before it fires.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
      runAnimationFrame();
    });

    assert.deepEqual(
      container.writes,
      [],
      `a scroll armed before the user scrolled up must not fire afterwards; got ${JSON.stringify(container.writes)}`,
    );
  });

  it('follows content growth inside the same message', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    // A streaming flush appends text to the row already on screen: the row
    // count is unchanged, so a follow keyed on `length` would miss it. The
    // store hands back a fresh array (new reference, same count), as
    // `updateStreaming` does on every flush.
    messages.set(SESSION_A, [
      { ...buildMessage(0, '2026-01-01T00:00:00.000Z'), content: 'message 0 grown' },
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });
    container.writes.length = 0;

    act(() => {
      runAnimationFrame();
    });

    expect(container.writes).toContain(container.scrollHeight);
  });

  it('follows the bottom throughout an animated reasoning collapse', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    act(() => {
      result.current.followTranscriptLayout(350);
      container.setScrollHeight(4200);
      runAnimationFrame();
    });
    expect(container.writes.at(-1)).toBe(4200);

    act(() => {
      vi.advanceTimersByTime(200);
      container.setScrollHeight(3500);
      runAnimationFrame();
    });
    expect(container.writes.at(-1)).toBe(3500);

    act(() => {
      vi.advanceTimersByTime(150);
      container.setScrollHeight(3000);
      runAnimationFrame();
    });
    expect(container.writes.at(-1)).toBe(3000);

    act(() => runAnimationFrame());
    act(() => runAnimationFrame());
    expect(frameCallbacks.size).toBe(0);
  });

  it('waits for cross-frame geometry stability after the main thread misses the deadline', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    act(() => {
      result.current.followTranscriptLayout(350);
      vi.advanceTimersByTime(600);
      container.setScrollHeight(3000);
      runAnimationFrame();
    });

    expect(container.writes.at(-1)).toBe(3000);
    expect(frameCallbacks.size).toBe(1);
    act(() => runAnimationFrame());
    expect(frameCallbacks.size).toBe(1);
    act(() => runAnimationFrame());
    expect(frameCallbacks.size).toBe(0);
  });

  it('stops following a reasoning collapse as soon as the user scrolls away', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    act(() => {
      result.current.followTranscriptLayout(350);
      runAnimationFrame();
      result.current.setIsUserScrolledUp(true);
    });
    const writeCount = container.writes.length;

    act(() => {
      vi.advanceTimersByTime(200);
      container.setScrollHeight(3500);
      runAnimationFrame();
    });
    expect(container.writes).toHaveLength(writeCount);
    expect(frameCallbacks.size).toBe(0);
  });

  it('still sticks to the bottom when the user has not scrolled away', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });
    container.writes.length = 0;

    act(() => {
      runAnimationFrame();
    });

    expect(container.writes).toContain(container.scrollHeight);
  });

  it('cancels a queued follow frame when the Chat tab becomes inactive', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: false });
    });
    container.writes.length = 0;

    act(() => runAnimationFrame());
    assert.deepEqual(container.writes, []);
  });
});

describe('search jump ownership', () => {
  it('does not follow the user into the next session', { timeout: 20_000 }, async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
      [SESSION_B, [buildMessage(1, '2026-01-01T00:00:05.000Z')]],
    ]);
    const store = createStore(messages);
    const searchSession = {
      id: SESSION_A,
      __searchTargetSnippet: 'message 0',
      __searchTargetTimestamp: '2026-01-01T00:00:00.000Z',
    } as unknown as ProjectSession;

    const { result, rerender } = await renderChatSessionState({ session: searchSession, store });

    const container = createContainer(5000, 500);
    // The row session B renders. The jump requested against session A resolves
    // by timestamp, and on its last retry it accepts the nearest row it can
    // find — which, after the switch, is this one.
    const sessionBRow = document.createElement('div');
    sessionBRow.setAttribute('data-message-timestamp', '2026-01-01T00:00:05.000Z');
    container.element.appendChild(sessionBRow);

    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    // Let the jump arm and start retrying.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The user gives up waiting and opens a different session.
    await act(async () => {
      rerender({ session: { id: SESSION_B } as ProjectSession, isActive: true });
    });

    // Let the whole retry budget elapse (20 retries, 150ms apart).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3400);
    });

    assert.equal(
      scrollIntoView.mock.calls.length,
      0,
      'a jump requested in the previous session must not scroll the new one',
    );
    assert.equal(
      container.element.querySelectorAll('.search-highlight-flash').length,
      0,
      'and must not flash the search highlight on one of its rows',
    );
  });
});

describe('render-window growth restore', () => {
  it('keeps the pinned row in place when "load earlier" widens the window', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, buildMessages(300)],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    // The container has to be in the document for the pinned row to stay
    // connected, which is what the restore checks before using it.
    document.body.appendChild(container.element);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    // jsdom has no layout, so the pinned row's rect is scripted. Capturing the
    // baseline reads it twice (once to pick the row, once for its offset) and
    // applying the correction reads it once more, so the first two reads report
    // 120px below the container top and the correction reads 320px — the 200px
    // that inserting 100 rows above the row costs it.
    const row = document.createElement('div');
    row.className = 'chat-message';
    let rowReads = 0;
    row.getBoundingClientRect = () => {
      const top = rowReads++ < 2 ? 120 : 320;
      return { top, bottom: top + 100 } as DOMRect;
    };
    container.element.appendChild(row);

    act(() => {
      result.current.loadEarlierMessages();
    });

    assert.deepEqual(
      container.writes,
      [4700],
      'the restore must follow the pinned row down by the 200px the inserted rows cost it',
    );

    container.element.remove();
  });

  it('restores within the "load all" commit and never moves the viewport afterwards', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, buildMessages(300)],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    assert.equal(result.current.currentSessionId, SESSION_A);

    // The reader is up in the transcript, which is where the "load all" prompt
    // appears and where ownership must stay with them.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });
    container.writes.length = 0;

    // Every message is already in the store, so widening the window to all of
    // them changes no store length anywhere — the geometry is the only signal.
    const slot = store.getSessionSlot(SESSION_A);
    let resolveFetch: (() => void) | null = null;
    store.fetchFromServer.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFetch = () => resolve(slot);
    }));

    act(() => {
      void result.current.loadAllMessages();
    });
    container.setScrollHeight(9000);
    await act(async () => {
      resolveFetch?.();
    });

    assert.deepEqual(
      container.writes,
      [8500],
      'the restore must complete in the commit that mounts the full window',
    );

    // A row streams in afterwards. The restore is spent, so nothing may move.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(300, '2026-01-01T00:05:00.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    assert.deepEqual(
      container.writes,
      [8500],
      'an armed restore must not outlive its own commit and fire on a later one',
    );
  });
});
