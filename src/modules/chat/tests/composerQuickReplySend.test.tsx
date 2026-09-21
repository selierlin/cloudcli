import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Picking a quick reply sends it, so the two things that can go wrong are both
 * invisible: the send path reads `inputValueRef` rather than the React state,
 * so a snippet that only reached the state would go out as whatever the box
 * held before the tap; and a snippet that is a command has to stay in the box,
 * because a row that fires on tap would run something the user never got to
 * read first.
 *
 * These tests drive the real hook, so the state/ref pair and the send path are
 * exercised together rather than described.
 */

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/tmp/project-one',
};

// The composer only ever reaches the network through these; stubbing them keeps
// the test about the sent text rather than about fetch behaviour in jsdom.
vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      commands: { list: () => okJson({ success: true, commands: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
    },
  };
});

const sentMessages: Array<{ content?: string }> = [];

const renderComposer = (selectedSession: ProjectSession | null) => renderHook(
  ({ session }: { session: ProjectSession | null }) => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: session,
    currentSessionId: session?.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'test-model',
    currentProviderEffort: 'medium',
    isLoading: false,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage: (message) => {
      sentMessages.push(message as { content?: string });
    },
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
  }),
  { initialProps: { session: selectedSession } },
);

beforeEach(() => {
  localStorage.clear();
  // The drafts store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetChatDrafts();
  sentMessages.length = 0;
});

test('a picked snippet is sent on the spot and leaves the box empty', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.handleQuickReplySend({ text: '继续' });
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].content, '继续');
  assert.equal(view.result.current.input, '');
  assert.equal(readDraftText('session-a'), '', 'the sent snippet must not stay a draft');
});

test('a snippet is appended to what is already typed, and the whole line is sent', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('跑一下测试');
  });
  await act(async () => {
    view.result.current.handleQuickReplySend({ text: '继续' });
  });

  assert.equal(sentMessages.length, 1);
  // The tap has to feed the send path the composed text, not the value the box
  // held before it: `handleSubmit` reads `inputValueRef`, so a snippet written
  // to the React state alone would send "跑一下测试".
  assert.equal(sentMessages[0].content, '跑一下测试 继续');
});

test('a snippet that starts with a slash only fills the box, so the tap cannot run a command', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('先别动手');
  });
  await act(async () => {
    view.result.current.handleQuickReplySend({ text: '/session-sediment' });
  });

  assert.equal(view.result.current.input, '/session-sediment');
  assert.deepEqual(sentMessages, [], 'a command snippet must not fire without a deliberate send');
});
