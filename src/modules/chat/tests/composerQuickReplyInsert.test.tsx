import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { FormEvent } from 'react';
import { beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * A picked quick reply fills the composer the way a voice transcript does, and
 * two things can go wrong without any visible error: the box can keep the text
 * that was already there (the send path reads `inputValueRef`, not the React
 * state), and a snippet that starts with "/" can end up behind other text,
 * where the send path stops treating it as a command.
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
// the test about the inserted text rather than about fetch behaviour in jsdom.
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

const submit = () => ({ preventDefault: () => undefined } as unknown as FormEvent<HTMLFormElement>);

beforeEach(() => {
  localStorage.clear();
  // The drafts store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetChatDrafts();
  sentMessages.length = 0;
});

test('a picked snippet is appended to the box and to its stored draft', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('跑一下测试');
  });
  await act(async () => {
    view.result.current.handleQuickReplyInsert({ text: '继续' });
  });

  assert.equal(view.result.current.input, '跑一下测试 继续');
  assert.equal(readDraftText('session-a'), '跑一下测试 继续');
});

test('a snippet that starts with a slash replaces the box, so it stays a command', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('先别动手');
  });
  await act(async () => {
    view.result.current.handleQuickReplyInsert({ text: '/session-sediment' });
  });

  assert.equal(view.result.current.input, '/session-sediment');
});

test('the send path reads the inserted text, not the value the box held before', async () => {
  const view = renderComposer({ id: 'session-a' });

  await act(async () => {
    view.result.current.setInput('跑一下测试');
  });

  await act(async () => {
    view.result.current.handleQuickReplyInsert({ text: '继续' });
    // Deliberately no await in between: this is the window the send path's
    // `inputValueRef` read exists for, and it must have the inserted text.
    void view.result.current.handleSubmit(submit());
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].content, '跑一下测试 继续');
});
