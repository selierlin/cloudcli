import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * A send with attachments waits for the upload, and the user can open another
 * chat meanwhile. The cleanup after the send used to empty whichever chat was
 * open by then: its typed text, its draft and the files attached there (#1774).
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION_A: ProjectSession = { id: 'session-a' };
const SESSION_B: ProjectSession = { id: 'session-b' };

type Pending = { resolve: (response: Response) => void };
type PendingUpload = { xhr: GatedUploadXhr };
type Props = { session: ProjectSession | null };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pendingUploads: PendingUpload[] = [];
let pendingCreates: Pending[] = [];

/**
 * The composer uploads attachments as soon as they are picked, through
 * XMLHttpRequest (progress + abort), and the send then waits for that
 * transfer. `release` answers the held request the way the server does.
 */
class GatedUploadXhr {
  status = 200;
  responseText = '';
  upload = {} as XMLHttpRequestUpload;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(): void {}
  setRequestHeader(): void {}
  getResponseHeader(): string | null { return null; }
  addEventListener(): void {}
  removeEventListener(): void {}
  abort(): void { this.onabort?.(); }
  send(): void {
    pendingUploads.push({ xhr: this });
  }
}

const releaseUploads = async (body: unknown, status = 200) => {
  await act(async () => {
    for (const { xhr } of pendingUploads.splice(0)) {
      xhr.status = status;
      xhr.responseText = JSON.stringify(body);
      xhr.onload?.();
    }
    // The send polls the upload state every 20ms rather than listening, so a
    // zero-delay tick would leave it mid-poll.
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
};

const release = async (waiting: Pending[], body: unknown, status = 200) => {
  await act(async () => {
    for (const pending of waiting.splice(0)) pending.resolve(jsonResponse(body, status));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const backgroundInA: SessionActivityMap = new Map([[
  'session-a',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [{ taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey', startedAt: 1 }],
  },
]]);

const renderComposer = (
  initialSession: ProjectSession | null,
  processingSessions?: SessionActivityMap,
  { isLoading = false, supportsSteering = false } = {},
) => {
  const sent: Array<{ type: string; sessionId?: string; content?: string; anchorId?: string }> = [];
  let rerender: ((props: Props) => void) | undefined;
  const view = renderHook(({ session }: Props) =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: session,
      currentSessionId: session?.id ?? null,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading,
      supportsSteering,
      processingSessions,
      supportsSideQuestions: true,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      // The workspace selects the new session as soon as it exists.
      onSessionEstablished: (sessionId) => { rerender?.({ session: { id: sessionId } }); },
      scrollToLatest: () => undefined,
      addMessage: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: { session: initialSession } });
  rerender = view.rerender;
  return {
    view,
    chatSends: () => sent.filter((message) => message.type === 'chat.send'),
    editSends: () => sent.filter((message) => message.type === 'chat.edit-send'),
  };
};

const submit = (view: ReturnType<typeof renderComposer>['view']) =>
  view.result.current.handleSubmit({ preventDefault: () => undefined } as never);

beforeEach(() => {
  pendingUploads = [];
  pendingCreates = [];
  vi.stubGlobal('XMLHttpRequest', GatedUploadXhr);
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/user/drafts/queued-message' && init?.method === 'POST') {
      const { queuedMessage } = JSON.parse(String(init.body)) as { queuedMessage: unknown };
      return Promise.resolve(jsonResponse({ queuedMessage, appended: false }));
    }
    if (String(url) === '/api/providers/sessions' && init?.method === 'POST') {
      return new Promise<Response>((resolve) => { pendingCreates.push({ resolve }); });
    }
    return Promise.resolve(jsonResponse([]));
  }));
  resetChatDrafts();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetChatDrafts();
});

test('a send finishing after a chat switch leaves the open chat alone', async () => {
  const { view, chatSends } = renderComposer(SESSION_A);
  const fileA = new File(['a'], 'a.txt');
  const fileB = new File(['b'], 'b.txt');
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([fileA]);
  });
  await act(async () => { void submit(view); });
  assert.equal(chatSends().length, 0, 'the send waits for the upload');
  assert.equal(pendingUploads.length, 1, 'the picked file started uploading');

  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => {
    view.result.current.setInput('typed in b');
    view.result.current.setAttachedFiles((files) => [...files, fileB]);
  });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });

  assert.deepEqual(chatSends().map((message) => [message.sessionId, message.content]), [['session-a', 'from a']]);
  assert.equal(readDraftText('session-a'), '', 'the sent chat\'s draft is cleared');
  assert.equal(view.result.current.input, 'typed in b', 'the open chat keeps its text');
  assert.equal(readDraftText('session-b'), 'typed in b', 'and its draft');
  assert.deepEqual(view.result.current.attachedFiles, [fileB], 'only the sent file is gone');
});

test('a new chat is still cleaned up once it has its session id', async () => {
  const { view, chatSends } = renderComposer(null);
  await act(async () => {
    view.result.current.setInput('first message');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });
  await release(pendingCreates, { success: true, data: { sessionId: 'session-new', sessionName: 'first' } }, 201);

  assert.deepEqual(chatSends().map((message) => [message.sessionId, message.content]), [['session-new', 'first message']]);
  assert.equal(view.result.current.input, '');
  assert.deepEqual(view.result.current.attachedFiles, []);
  assert.equal(readDraftText('project:project-1'), '');
  assert.equal(readDraftText('session-new'), '');
});

test('a side question asked for the sending chat after a chat switch leaves the open chat alone', async () => {
  const { view, chatSends } = renderComposer(SESSION_A, backgroundInA);
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => { view.result.current.setInput('typed in b'); });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });
  assert.ok(view.result.current.backgroundSendPrompt, 'the background-work dialog asks about the send');
  await act(async () => { view.result.current.resolveBackgroundSendPrompt('sideQuestion'); });

  assert.deepEqual(chatSends(), [], 'a side question is not a turn');
  assert.equal(readDraftText('session-a'), '', 'the asking chat\'s draft is cleared');
  assert.equal(view.result.current.input, 'typed in b', 'the open chat keeps its text');
  assert.equal(readDraftText('session-b'), 'typed in b', 'and its draft');
});

test('an edit begun in another chat during the upload survives the send', async () => {
  const { view, chatSends, editSends } = renderComposer(SESSION_A);
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => {
    view.result.current.beginEditMessage({ type: 'user', content: 'old b', transcriptAnchorId: 'anchor-b', timestamp: new Date() } as never);
  });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });

  assert.equal(view.result.current.editingAnchorId, 'anchor-b', 'the open chat is still editing');
  await act(async () => { view.result.current.setInput('new b'); });
  await act(async () => { await submit(view); });
  assert.deepEqual(chatSends().map((message) => message.sessionId), ['session-a']);
  assert.deepEqual(editSends().map((message) => [message.sessionId, message.anchorId]), [['session-b', 'anchor-b']]);
});

for (const [name, submitOptions] of [
  ['queued', undefined],
  ['steered', { steerIntoTurn: true }],
] as const) {
  test(`files ${name} from a chat leave the composer after a chat switch, the open chat's text stays`, async () => {
    const { view } = renderComposer(SESSION_A, undefined, { isLoading: true, supportsSteering: true });
    const fileA = new File(['a'], 'a.txt');
    const fileB = new File(['b'], 'b.txt');
    await act(async () => {
      view.result.current.setInput('from a');
      view.result.current.setAttachedFiles([fileA]);
    });
    await act(async () => {
      void view.result.current.handleSubmit({ preventDefault: () => undefined } as never, undefined, submitOptions);
    });
    await act(async () => { view.rerender({ session: SESSION_B }); });
    await act(async () => {
      view.result.current.setInput('typed in b');
      view.result.current.setAttachedFiles((files) => [...files, fileB]);
    });
    await releaseUploads({ attachments: [{ id: 'asset-a' }] });

    assert.deepEqual(view.result.current.attachedFiles, [fileB], 'only the open chat\'s file stays');
    assert.equal(view.result.current.input, 'typed in b');
  });
}

test('a queue refused after a switch away and back brings its files back for a retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { view } = renderComposer(SESSION_A, undefined, { isLoading: true });
  const fileA = new File(['a'], 'a.txt');
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([fileA]);
  });
  // Hold the queue request so the user can come back before it is refused.
  let refuse: () => void = () => undefined;
  const fetchStub = vi.mocked(fetch);
  const passThrough = fetchStub.getMockImplementation()!;
  fetchStub.mockImplementation((url, init) => (String(url) === '/api/user/drafts/queued-message'
    ? new Promise<Response>((resolve) => { refuse = () => resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)); })
    : passThrough(url, init)));
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });
  assert.deepEqual(view.result.current.attachedFiles, [], 'chat B never holds the queued file');

  await act(async () => { view.rerender({ session: SESSION_A }); });
  await act(async () => { refuse(); await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.deepEqual(view.result.current.attachedFiles, [fileA], 'the refused message brings its file back');
  assert.equal(view.result.current.input, 'from a', 'and its text');
});

test('a send finishing after a chat switch keeps text edited meanwhile in the chat it came from', async () => {
  const { view } = renderComposer(SESSION_A);
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => { view.rerender({ session: SESSION_A }); });
  await act(async () => { view.result.current.setInput('edited in a'); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });

  assert.equal(readDraftText('session-a'), 'edited in a');
});

test('a side question finishing after a chat switch keeps text edited meanwhile in the chat it came from', async () => {
  const { view } = renderComposer(SESSION_A, backgroundInA);
  await act(async () => {
    view.result.current.setInput('from a');
    view.result.current.setAttachedFiles([new File(['a'], 'a.txt')]);
  });
  await act(async () => { void submit(view); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await act(async () => { view.rerender({ session: SESSION_A }); });
  await act(async () => { view.result.current.setInput('edited in a'); });
  await act(async () => { view.rerender({ session: SESSION_B }); });
  await releaseUploads({ attachments: [{ id: 'asset-a' }] });
  await act(async () => { view.result.current.resolveBackgroundSendPrompt('sideQuestion'); });

  assert.equal(readDraftText('session-a'), 'edited in a');
});
