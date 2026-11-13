import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * The first message of a brand-new chat allocates its session id with
 * `POST /api/providers/sessions` and only then sends. The text cannot leave the
 * composer until that returns, so the send button parks on the request
 * (spinner, disabled) instead of staying a live send arrow: pressing it again
 * read as "that did not go" and, once the send landed and the button had turned
 * into stop, aborted the turn that had just gone out. A second submit during
 * the round-trip used to allocate its own session and send it the same first
 * message: one chat, two sessions, two agents doing the same work (#1306).
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };

type PendingCreate = { resolve: (response: Response) => void };

let pendingCreates: PendingCreate[] = [];
let createdCount = 0;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Answers the session gateway only when the test says so, the way a busy
// server leaves the first request hanging while the user tries again.
const releaseCreates = async (status = 201) => {
  const waiting = pendingCreates;
  pendingCreates = [];
  await act(async () => {
    for (const pending of waiting) {
      createdCount += 1;
      pending.resolve(status === 201
        ? jsonResponse({ success: true, data: { sessionId: `session-${createdCount}`, sessionName: 'hello' } }, 201)
        : jsonResponse({ success: false, error: 'boom' }, status));
    }
    // Let every awaiting submit run to its end.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const createRequests = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
  .filter(([url, init]) => String(url) === '/api/providers/sessions' && (init as RequestInit | undefined)?.method === 'POST');

const renderComposer = (initialSession: ProjectSession | null) => {
  const sent: Array<{ type: string; sessionId?: string; content?: string }> = [];
  const established: string[] = [];
  const view = renderHook(({ session }: { session: ProjectSession | null }) =>
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
      isLoading: false,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      onSessionEstablished: (sessionId) => { established.push(sessionId); },
      scrollToLatest: () => undefined,
      addMessage: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  { initialProps: { session: initialSession } });
  return { view, established, chatSends: () => sent.filter((message) => message.type === 'chat.send') };
};

const renderNewChat = () => renderComposer(null);

let fetchMock: ReturnType<typeof vi.fn>;
let pendingUploads: PendingCreate[] = [];
let uploadRequestCount = 0;

const uploadRequests = () => uploadRequestCount;

/**
 * The composer uploads picked files through XMLHttpRequest (progress + abort).
 * This stands in for the upload route and leaves each request open until the
 * test answers it, like a slow connection would.
 */
class AttachmentUploadXhr {
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
  abort(): void { this.abortCount += 1; }
  abortCount = 0;
  send(): void {
    uploadRequestCount += 1;
    pendingUploads.push({
      resolve: (response: Response) => {
        void response.text().then((text) => {
          this.responseText = text;
          this.onload?.();
        });
      },
    });
  }
}

beforeEach(() => {
  pendingCreates = [];
  pendingUploads = [];
  uploadRequestCount = 0;
  createdCount = 0;
  vi.stubGlobal('XMLHttpRequest', AttachmentUploadXhr);
  fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/providers/sessions' && init?.method === 'POST') {
      return new Promise<Response>((resolve) => { pendingCreates.push({ resolve }); });
    }
    return Promise.resolve(jsonResponse([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('a new chat parks the send while its session is being created', async () => {
  const { view } = renderNewChat();
  await act(async () => { view.result.current.setInput('hello'); });
  assert.equal(view.result.current.isSubmitting, false);

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  // The request is still out: the composer must say the message is on its way
  // rather than leave a send arrow that invites a second press.
  assert.equal(view.result.current.isSubmitting, true);

  await releaseCreates();
  assert.equal(view.result.current.isSubmitting, false);
});

test('a send to an existing session does not park: it paints in the same tick', async () => {
  const { view, chatSends } = renderComposer({ id: 'session-existing' });
  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.equal(view.result.current.isSubmitting, false);
  assert.equal(view.result.current.input, '', 'the message left the composer');
  assert.equal(chatSends().length, 1);
});

test('submitting again while a new chat\'s session is being created allocates one session and sends once', async () => {
  const { view, established, chatSends } = renderNewChat();
  await act(async () => { view.result.current.setInput('hello'); });

  const secondSubmit = { preventDefault: vi.fn() };
  await act(async () => {
    // Enter, then Enter (or a click on send) while the first request is out.
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
    void view.result.current.handleSubmit(secondSubmit as never);
  });
  await releaseCreates();

  assert.equal(createRequests(fetchMock).length, 1, 'one POST /api/providers/sessions');
  assert.deepEqual(established, ['session-1']);
  assert.deepEqual(
    chatSends().map((message) => [message.sessionId, message.content]),
    [['session-1', 'hello']],
    'the first message goes to one session, once',
  );
  // The ignored submit may come from the form: without this the browser would
  // run a native form submission and reload the page.
  assert.equal(secondSubmit.preventDefault.mock.calls.length, 1);
});

test('a failed session creation does not block the retry', async () => {
  const { view, established, chatSends } = renderNewChat();
  await act(async () => { view.result.current.setInput('hello'); });

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await releaseCreates(500);
  assert.equal(chatSends().length, 0);
  assert.equal(view.result.current.input, 'hello', 'the text stays for the retry');

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  await releaseCreates();

  assert.equal(createRequests(fetchMock).length, 2);
  assert.deepEqual(established, ['session-2']);
  assert.deepEqual(chatSends().map((message) => message.sessionId), ['session-2']);
});

test('submitting again while an attachment uploads sends the message once', async () => {
  const { view, chatSends } = renderComposer({ id: 'session-existing' });
  const image = new File(['png'], 'shot.png', { type: 'image/png' });
  await act(async () => {
    view.result.current.setInput('look at this');
    view.result.current.handlePaste({
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => image }], files: [] },
    } as never);
  });

  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
  // The send is parked on the upload: answer the request, then let its poll
  // notice the settled entry and the message go out.
  await act(async () => {
    for (const pending of pendingUploads) {
      pending.resolve(jsonResponse({ attachments: [{ name: 'shot.png', mimeType: 'image/png' }] }));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  assert.equal(uploadRequests(), 1, 'the attachment uploads once, from the paste, and the send waits for it');
  assert.deepEqual(
    chatSends().map((message) => [message.sessionId, message.content]),
    [['session-existing', 'look at this']],
  );
});

test('a pending new chat does not hold up a submit in another session', async () => {
  const { view, chatSends } = renderNewChat();
  await act(async () => { view.result.current.setInput('hello'); });
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  // The user leaves the new chat while its session is still being created.
  view.rerender({ session: { id: 'session-other' } });
  await act(async () => { view.result.current.setInput('elsewhere'); });
  await act(async () => {
    void view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.deepEqual(
    chatSends().map((message) => [message.sessionId, message.content]),
    [['session-other', 'elsewhere']],
  );
  await releaseCreates();
});
