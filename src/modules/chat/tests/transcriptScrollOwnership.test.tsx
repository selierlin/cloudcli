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

/**
 * jsdom has no layout, so a pinned row's rect has to be scripted — but it must
 * respond to `scrollTop` the way real geometry does, or the restore's settle
 * loop would chase a rect that never converges.
 *
 * The row sits `baselineOffset` below the container top at the scrollTop it
 * was created at. The capture's first two reads see it there; from the third
 * read on, the widened window has landed and pushed the row down by
 * `pageInsertion` plus whatever `settleMore` has added — the second knob being
 * how lazy rows above settle from estimated placeholder heights to real ones.
 */
function createGeometryAwareRow(
  container: ReturnType<typeof createContainer>,
  baselineOffset: number,
  pageInsertion: number,
) {
  const initialTop = container.element.scrollTop;
  const row = document.createElement('div');
  row.setAttribute('data-message-timestamp', '2026-01-01T00:00:00.100Z');
  let settledMore = 0;
  let rowReads = 0;
  row.getBoundingClientRect = () => {
    rowReads += 1;
    const landed = rowReads <= 2 ? 0 : pageInsertion + settledMore;
    const top = baselineOffset + landed - (container.element.scrollTop - initialTop);
    return { top, bottom: top + 100 } as DOMRect;
  };
  return {
    row,
    /** Grows the height inserted above the row, as lazy rows settling do. */
    settleMore: (px: number) => {
      settledMore += px;
    },
  };
}

type SlotOverrides = {
  hasMore?: boolean;
  total?: number;
  newerCursor?: string | null;
};

function createStore(
  messagesBySession: Map<string, NormalizedMessage[]>,
  overrides: SlotOverrides = {},
) {
  // A hydrated slot, so the session-loading effect takes its early return
  // instead of re-fetching on every render.
  const slotFor = (sessionId: string) => {
    const count = messagesBySession.get(sessionId)?.length ?? 0;
    return {
      fetchedAt: 1,
      status: 'idle' as const,
      total: overrides.total ?? count,
      hasMore: overrides.hasMore ?? false,
      offset: count,
      turnPageInfo: overrides.newerCursor === undefined
        ? null
        : {
            mode: 'turns' as const,
            snapshotVersion: 'snapshot-1',
            nextCursor: null,
            newerCursor: overrides.newerCursor,
            partial: { older: false, newer: false },
          },
    };
  };

  return {
    fetchFromServer: vi.fn(async (sessionId: string, _options?: unknown) => slotFor(sessionId)),
    fetchMore: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), prependedCount: 0 })),
    fetchNewer: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), appendedCount: 0 })),
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
  it('requests a bounded Turn seek instead of loading the full transcript', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const searchSession = {
      id: SESSION_A,
      __searchTargetSnippet: 'message 0 target',
      __searchTargetTimestamp: '2026-01-01T00:00:00.000Z',
      __searchTargetAnchorId: 'uuid-1',
    } as unknown as ProjectSession;

    await renderChatSessionState({ session: searchSession, store });
    await act(async () => {
      await Promise.resolve();
    });

    const searchRequest = store.fetchFromServer.mock.calls.find(
      ([, options]) => Boolean((options as { seek?: unknown } | undefined)?.seek),
    );
    assert.ok(searchRequest);
    const options = searchRequest?.[1] as {
      pageMode?: string;
      seek?: unknown;
      limit?: number | null;
    };
    assert.equal(options.pageMode, 'turns');
    assert.deepEqual(options.seek, {
      snippet: 'message 0 target',
      timestamp: '2026-01-01T00:00:00.000Z',
      transcriptAnchorId: 'uuid-1',
    });
    assert.equal('limit' in options, false);
  });

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

describe('paging at the top of the loaded window', () => {
  it('loads the next newer Turn page when the reader wheels down at a sought window bottom', async () => {
    const messages = new Map<string, NormalizedMessage[]>([[SESSION_A, buildMessages(2)]]);
    const store = createStore(messages, { total: 6, newerCursor: 'newer-1' });
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(1000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });

    await act(async () => {
      container.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      await Promise.resolve();
    });

    assert.equal(store.fetchNewer.mock.calls.length, 1);
  });

  it('does not mark a sought window complete after only its older side reaches the start', async () => {
    const messages = new Map<string, NormalizedMessage[]>([[SESSION_A, buildMessages(2)]]);
    const store = createStore(messages, {
      hasMore: true,
      total: 6,
      newerCursor: 'newer-1',
    });
    store.fetchMore.mockImplementation(async (sessionId: string) => ({
      slot: {
        ...store.getSessionSlot(sessionId),
        hasMore: false,
        turnPageInfo: {
          mode: 'turns' as const,
          snapshotVersion: 'snapshot-1',
          nextCursor: null,
          newerCursor: 'newer-1',
          partial: { older: false, newer: false },
        },
      },
      prependedCount: 2,
    }));
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });
    const container = createContainer(1000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    await act(async () => undefined);

    container.element.scrollTop = 0;
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
      await Promise.resolve();
    });

    assert.equal(store.fetchMore.mock.calls.length, 1);
    assert.equal(result.current.allMessagesLoaded, false);
  });

  /**
   * The reader sits at the top of a 20-message first page, which is where the
   * "showing N of M" bar is on screen. Every page below it in this session is
   * execution rows (thinking / tool calls / tool results), and a truncated
   * window collapses those into `display:none` members whose summary row lives
   * at the group's first member — an older row that has not been loaded yet.
   * The store therefore grows by 20 rows while the rendered geometry above the
   * reader grows by nothing at all.
   */
  it('keeps loading older pages when a page lands without adding scrollable height', async () => {
    const tail = buildMessages(20);
    const older = buildMessages(20).map((message, index) => ({
      ...message,
      id: `older-${index}`,
    }));
    const messages = new Map<string, NormalizedMessage[]>([[SESSION_A, tail]]);
    const store = createStore(messages, { hasMore: true, total: 1941 });

    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    // The scroll listener attaches on the effect that follows the first page's
    // load, so the container has to be in place before that state flush.
    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    await act(async () => undefined);

    container.element.scrollTop = 0;
    container.writes.length = 0;

    store.fetchMore.mockImplementation(async (sessionId: string) => {
      messages.set(sessionId, [...older, ...(messages.get(sessionId) ?? [])]);
      return {
        slot: {
          fetchedAt: 1,
          status: 'idle' as const,
          total: 1941,
          hasMore: true,
          offset: messages.get(sessionId)?.length ?? 0,
          turnPageInfo: null,
        },
        prependedCount: older.length,
      };
    });

    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    assert.equal(
      store.fetchMore.mock.calls.length,
      1,
      'reaching the top must request the next page',
    );

    // Nothing appeared above the reader, so they push up again. That gesture is
    // a new request; a guard that latched on the invisible page would swallow it
    // and leave the pager dead while its bar stayed on screen.
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });

    assert.equal(
      store.fetchMore.mock.calls.length,
      2,
      'a page that inserted nothing the reader can scroll through must not lock the pager',
    );
  });

  it('still serves one page per visit when the page does add scrollable height', async () => {
    const tail = buildMessages(20);
    const older = buildMessages(20).map((message, index) => ({
      ...message,
      id: `older-${index}`,
    }));
    const messages = new Map<string, NormalizedMessage[]>([[SESSION_A, tail]]);
    const store = createStore(messages, { hasMore: true, total: 1941 });

    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    document.body.appendChild(container.element);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    await act(async () => undefined);

    container.element.scrollTop = 0;
    container.writes.length = 0;

    // The pinned row, scripted as in the render-window tests: 100px below the
    // container top before the page lands, 150px after — a page that pushes the
    // reader down far enough to release the guard, but not out of the top zone.
    const { row } = createGeometryAwareRow(container, 100, 50);
    container.element.appendChild(row);

    store.fetchMore.mockImplementation(async (sessionId: string) => {
      messages.set(sessionId, [...older, ...(messages.get(sessionId) ?? [])]);
      return {
        slot: {
          fetchedAt: 1,
          status: 'idle' as const,
          total: 1941,
          hasMore: true,
          offset: messages.get(sessionId)?.length ?? 0,
          turnPageInfo: null,
        },
        prependedCount: older.length,
      };
    });

    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    assert.equal(
      container.element.scrollTop,
      50,
      'the restore must move the reader down by the 50px the page inserted',
    );

    // Reading up at the top of the loaded window is the reader's state here;
    // it also stands the initial scroll-to-bottom loop down so the drained
    // frames below belong to the restore alone.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });

    // The settle loop the restore armed drains over the following frames
    // without writing anything (the geometry above is already stable), so it
    // cannot interfere with the pager guard exercised below.
    act(() => runAnimationFrame());
    act(() => runAnimationFrame());
    assert.equal(frameCallbacks.size, 0);

    // Still inside the top zone, so the guard holds this gesture off...
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });
    assert.equal(
      store.fetchMore.mock.calls.length,
      1,
      'a page with real content above the reader keeps the one-page-per-visit rule',
    );

    // ...and releases on it, so the gesture after that is served: latching is
    // only ever done by a page that can move the reader past the release point.
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });
    assert.equal(
      store.fetchMore.mock.calls.length,
      2,
      'a latched guard must stay releasable by the reader moving down',
    );

    container.element.remove();
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

    // jsdom has no layout, so the pinned row's rect is scripted: 120px below
    // the container top at the capture, pushed down by the 200px the widened
    // window inserts above it once the page lands.
    const { row } = createGeometryAwareRow(container, 120, 200);
    container.element.appendChild(row);

    // The reader is up in the transcript (that is what "load earlier" is for),
    // which also keeps the initial scroll-to-bottom loop out of the frames the
    // assertions below pump.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });

    act(() => {
      result.current.loadEarlierMessages();
    });

    assert.deepEqual(
      container.writes,
      [4700],
      'the restore must follow the pinned row down by the 200px the inserted rows cost it',
    );

    // The settle loop the restore armed drains over the following frames
    // without writing anything — the geometry above the reader is stable —
    // and then stands down instead of leaving a frame armed.
    act(() => runAnimationFrame());
    act(() => runAnimationFrame());
    assert.deepEqual(container.writes, [4700]);
    assert.equal(frameCallbacks.size, 0);

    container.element.remove();
  });

  it('widens without a restore when the transcript has no scrollable geometry', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, buildMessages(300)],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    // The pane has mounted but nothing has measured yet: the box is exactly
    // viewport-tall, so the capture has no baseline to hand over. A restore
    // built from one would land on a clamped offset and then lose the viewport
    // to the session-open scroll-to-bottom.
    const container = createContainer(500, 500);
    document.body.appendChild(container.element);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    const { row } = createGeometryAwareRow(container, 120, 200);
    container.element.appendChild(row);

    // The reader is up in the transcript, which also keeps the initial
    // scroll-to-bottom loop out of the frames pumped below.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });

    act(() => {
      result.current.loadEarlierMessages();
    });

    act(() => runAnimationFrame());
    act(() => runAnimationFrame());

    assert.deepEqual(container.writes, [], 'a baseline with no geometry must not be armed');
    assert.equal(frameCallbacks.size, 0, 'and it must not leave a settle loop armed');

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

describe('restore settle loop', () => {
  it('re-pins the pinned row when lazy rows settle to real heights after the restore', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, buildMessages(300)],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    document.body.appendChild(container.element);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    const { row, settleMore } = createGeometryAwareRow(container, 120, 200);
    container.element.appendChild(row);

    // The reader is up in the transcript, which also keeps the initial
    // scroll-to-bottom loop out of the frames the assertions below pump.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });

    // The widened window commits: the restore follows the 200px that the
    // placeholder rows inserted above the reader.
    act(() => {
      result.current.loadEarlierMessages();
    });
    assert.deepEqual(container.writes, [4700]);

    // Those rows then mount real content and grow by another 500px — the drift
    // that on WebKit, with no browser scroll anchoring, used to leave the
    // reader's position ~1600px below the viewport. The settle loop must follow
    // the pinned row down again.
    settleMore(500);
    act(() => runAnimationFrame());
    assert.deepEqual(
      container.writes,
      [4700, 5200],
      'a lazy row landing real height above the reader must be followed by the settle loop',
    );

    // Two stable frames later the loop stands down and writes nothing more.
    act(() => runAnimationFrame());
    act(() => runAnimationFrame());
    assert.deepEqual(container.writes, [4700, 5200]);
    assert.equal(frameCallbacks.size, 0);

    container.element.remove();
  });

  it('stands down when a reader gesture arrives while the settle loop is armed', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, buildMessages(300)],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    document.body.appendChild(container.element);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    await act(async () => undefined);
    // The gesture listeners attach on the effect that follows a `handleScroll`
    // identity change, so re-render with a fresh session object to make that
    // effect re-run now that the container is in place.
    await act(async () => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    const { row, settleMore } = createGeometryAwareRow(container, 120, 200);
    container.element.appendChild(row);

    // The reader is up in the transcript, which also keeps the initial
    // scroll-to-bottom loop out of the frames the assertions below pump.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });

    act(() => {
      result.current.loadEarlierMessages();
    });
    assert.deepEqual(container.writes, [4700]);

    // The reader drags the transcript before the lazy rows above settle. The
    // gesture is what hands the viewport back, not the `scrollTop` it leaves
    // behind: the loop must not fight the reader for the viewport, so it writes
    // nothing more and ends itself instead of rescheduling.
    container.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
    container.element.scrollTop = 4300;
    settleMore(500);
    act(() => runAnimationFrame());
    assert.deepEqual(
      container.writes,
      [4700, 4300],
      'a gesture the restore did not precede hands the viewport back to the reader',
    );
    assert.equal(frameCallbacks.size, 0);

    container.element.remove();
  });

  it('keeps pinning through a viewport move no gesture caused', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, buildMessages(300)],
    ]);
    const store = createStore(messages);
    const { result } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    document.body.appendChild(container.element);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    const { row, settleMore } = createGeometryAwareRow(container, 120, 200);
    container.element.appendChild(row);

    act(() => {
      result.current.setIsUserScrolledUp(true);
    });

    act(() => {
      result.current.loadEarlierMessages();
    });
    assert.deepEqual(container.writes, [4700]);

    // WebKit keeps driving a touch's coasting scroll animation for hundreds of
    // ms after the finger lifts, overwriting the restore's write with no
    // `touchmove` and no `wheel` behind it. That is not the reader steering, so
    // the loop absorbs the move and re-pins the row to where the reader was.
    container.element.scrollTop = 4300;
    settleMore(500);
    act(() => runAnimationFrame());
    assert.deepEqual(
      container.writes,
      [4700, 4300, 5200],
      'the coasting write must be absorbed and the pinned row re-pinned',
    );

    // Two stable frames later the loop stands down and writes nothing more.
    act(() => runAnimationFrame());
    act(() => runAnimationFrame());
    assert.deepEqual(container.writes, [4700, 4300, 5200]);
    assert.equal(frameCallbacks.size, 0);

    container.element.remove();
  });
});

describe('scroll ownership while the answer is streaming', () => {
  /**
   * A follow write and the reader's own movement both arrive as `scroll` events
   * on the same element, so the handler has to tell them apart without a
   * `wheel`/`touch` event to lean on. jsdom cannot lay out a transcript, so the
   * geometry is scripted: the follow write puts `scrollTop` at the bottom, the
   * answer then grows before the browser dispatches that write's own event, and
   * the latch is reached through a real `scroll` event into the production
   * handler rather than by calling `setIsUserScrolledUp` directly.
   */
  async function renderAtBottom() {
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
    await act(async () => undefined);
    // The container listeners attach on the effect that follows a `handleScroll`
    // identity change, so re-render with a fresh session object to make that
    // effect re-run now that the container is in place.
    await act(async () => {
      rerender({ session: { id: SESSION_A } as ProjectSession, isActive: true });
    });

    // The reader is at the bottom and has been sampled there.
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });

    // A flush lands and the follow writes the new bottom.
    act(() => {
      container.setScrollHeight(5200);
      result.current.followTranscriptLayout();
    });
    act(() => runAnimationFrame());
    act(() => runAnimationFrame());

    // The write's own event reaches the handler, which is what makes the bottom
    // the position the next sample is compared against.
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });
    container.writes.length = 0;

    return { container, result };
  }

  it('keeps following when the answer grows after the follow write', async () => {
    const { container, result } = await renderAtBottom();

    // The answer grows again before the browser gets round to dispatching the
    // write's own `scroll` event. A handler that reads this as "the reader moved"
    // latches the transcript out of following for the rest of the answer, which
    // is the reported symptom: the follow works, then stops mid-answer and only
    // the "scroll to bottom" affordance can bring it back.
    container.setScrollHeight(6000);
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });

    assert.equal(
      result.current.isUserScrolledUp,
      false,
      'growth underneath a stationary viewport is not the reader taking over',
    );

    act(() => {
      container.setScrollHeight(6600);
      result.current.followTranscriptLayout();
    });
    assert.equal(
      container.writes.at(-1),
      6600,
      'the next flush must still be followed',
    );
  });

  it('stands down while the reader pulls, so the pull survives to be measured', async () => {
    const { container, result } = await renderAtBottom();
    container.setScrollHeight(6000);

    // The reader turns the wheel. The browser applies that scroll to `scrollTop`
    // before it dispatches the `scroll` event, and the event is dispatched after
    // this commit — so a follow write here would put them back at the bottom
    // first, and `handleScroll` would then measure a zero gap and never learn
    // that they moved. That race is why a pull had to be fast to escape.
    const wheel = new Event('wheel');
    Object.defineProperty(wheel, 'deltaY', { value: -120 });
    act(() => {
      container.element.dispatchEvent(wheel);
    });

    act(() => {
      result.current.followTranscriptLayout();
    });
    assert.deepEqual(
      container.writes,
      [],
      'the follow must not overwrite the position the reader is pulling away from',
    );

    // The browser finishes applying that notch, and the event it queues reaches
    // the handler with the movement still in the geometry.
    container.element.scrollTop -= 120;
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });

    assert.equal(
      result.current.isUserScrolledUp,
      true,
      'the pull must be measurable once the follow has stopped overwriting it',
    );
  });

  it('still hands ownership to a gesture the growing answer outruns', async () => {
    const { container, result } = await renderAtBottom();

    // The reader pulls toward older messages. Here the follow write lands
    // between their movement and the event and puts `scrollTop` back at the
    // bottom, so the gesture is the only evidence left that they took over —
    // without it the transcript would drag them back down mid-read.
    container.setScrollHeight(6000);
    const wheel = new Event('wheel');
    Object.defineProperty(wheel, 'deltaY', { value: -120 });
    act(() => {
      container.element.dispatchEvent(wheel);
    });
    await act(async () => {
      container.element.dispatchEvent(new Event('scroll'));
    });

    assert.equal(
      result.current.isUserScrolledUp,
      true,
      'a reader gesture must still take ownership away from the follow',
    );

    act(() => {
      container.setScrollHeight(6600);
      result.current.followTranscriptLayout();
    });
    assert.deepEqual(
      container.writes,
      [],
      'a latched transcript must not be pulled back down',
    );
  });
});
