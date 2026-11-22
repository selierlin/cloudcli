import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession } from '@/shared/types';

/**
 * The composer hides its token line whenever the value it holds accounts for
 * zero tokens, so a budget reported mid-turn could erase a reading the stream
 * had already published: an SDK frame stamped with an all-zero usage block, or
 * a `/token-usage` fetch that resolved before the transcript had a usage row.
 * Reported budgets merge with the live reading; only a deliberate reset clears
 * the counter.
 */

const sessionTokenUsage = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: (...args: unknown[]) => sessionTokenUsage(...args),
    },
  },
}));

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

const session = {
  id: 'session-a',
  summary: 'A',
  lastActivity: '2026-01-01T00:00:00.000Z',
  messageCount: 1,
} as ProjectSession;

const store = {
  fetchFromServer: vi.fn(async () => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: 0,
    hasMore: false,
    offset: 0,
  })),
  fetchMore: vi.fn(),
  appendRealtime: vi.fn(),
  refreshLatestFromServer: vi.fn(),
  setActiveSession: vi.fn(),
  isStale: vi.fn(() => false),
  updateStreaming: vi.fn(),
  finalizeStreaming: vi.fn(),
  getMessages: vi.fn(() => []),
  getSessionSlot: vi.fn(() => ({ fetchedAt: 1, status: 'idle' as const, total: 0, hasMore: false, offset: 0 })),
};

const LIVE_READING = { used: 42_000, total: 200_000, inputTokens: 41_000, outputTokens: 1_000 };

async function renderSession(initialSession: ProjectSession = session) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');
  const hook = renderHook(
    ({ selected }: { selected: ProjectSession }) => useChatSessionState({
      isActive: true,
      selectedProject: project,
      selectedSession: selected,
      ws: null,
      sendMessage: vi.fn(),
      statusCheckSentAtRef: { current: new Map() },
      lastSeqRef: { current: new Map() },
      sessionStore: store as never,
      processingSessions: new Map(),
    }),
    { initialProps: { selected: initialSession } },
  );
  return hook;
}

beforeEach(() => {
  sessionTokenUsage.mockReset();
  sessionTokenUsage.mockResolvedValue({ ok: false, json: async () => ({}) });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('an all-zero budget does not overwrite the reading already on screen', async () => {
  const hook = await renderSession();

  act(() => hook.result.current.applyTokenBudget(LIVE_READING));
  assert.deepEqual(hook.result.current.tokenBudget, LIVE_READING);

  act(() => hook.result.current.applyTokenBudget({
    used: 0,
    total: 200_000,
    inputTokens: 0,
    outputTokens: 0,
  }));
  assert.deepEqual(
    hook.result.current.tokenBudget,
    LIVE_READING,
    'a zero reading must not hide the counter',
  );

  act(() => hook.result.current.applyTokenBudget(null));
  assert.deepEqual(
    hook.result.current.tokenBudget,
    LIVE_READING,
    'a reported absence must not hide the counter either',
  );
});

test('a real reading still replaces the previous one, and an explicit reset clears it', async () => {
  const hook = await renderSession();

  act(() => hook.result.current.applyTokenBudget(LIVE_READING));
  act(() => hook.result.current.applyTokenBudget({ used: 50_000, total: 200_000 }));
  assert.equal(hook.result.current.tokenBudget?.used, 50_000);

  act(() => hook.result.current.setTokenBudget(null));
  assert.equal(hook.result.current.tokenBudget, null, 'a session reset clears it outright');
});

test('a token-usage fetch that lands after the stream cannot erase the reading', async () => {
  let resolveUsage: (value: unknown) => void = () => {};
  sessionTokenUsage.mockReturnValue(new Promise((resolve) => {
    resolveUsage = resolve;
  }));

  const hook = await renderSession();

  // The stream publishes the turn's reading while the one-shot fetch is still
  // in flight; the fetch then answers with the session's pre-turn zeros.
  act(() => hook.result.current.applyTokenBudget(LIVE_READING));
  await act(async () => {
    resolveUsage({
      ok: true,
      json: async () => ({
        data: { used: 0, total: 200_000, inputTokens: 0, outputTokens: 0 },
      }),
    });
    await Promise.resolve();
  });

  assert.deepEqual(hook.result.current.tokenBudget, LIVE_READING);
});

test('a late answer for a session the reader left cannot land on the new one', async () => {
  let resolvePrevious: (value: unknown) => void = () => {};
  let resolveCurrent: (value: unknown) => void = () => {};
  sessionTokenUsage
    .mockReturnValueOnce(new Promise((resolve) => { resolvePrevious = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { resolveCurrent = resolve; }));

  const hook = await renderSession();
  const nextSession = { ...session, id: 'session-b', summary: 'B' } as ProjectSession;

  // The reader moves on while the first session's usage is still being read.
  act(() => hook.rerender({ selected: nextSession }));

  // The new session answers first, then the stale answer for the old one lands
  // last. Reading a large transcript is slow enough for this to happen.
  resolveCurrent({
    ok: true,
    json: async () => ({ data: { used: 12_000, total: 200_000, inputTokens: 12_000, outputTokens: 0 } }),
  });
  await act(async () => { await Promise.resolve(); });
  resolvePrevious({
    ok: true,
    json: async () => ({ data: { used: 99_000, total: 200_000, inputTokens: 99_000, outputTokens: 0 } }),
  });
  await act(async () => { await Promise.resolve(); });

  assert.equal(
    hook.result.current.tokenBudget?.used,
    12_000,
    'the previous session’s reading must not overwrite the one on screen',
  );
});
