import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const PROJECT_PATH = '/workspace/demo-project';

/** Only the fields these tests read; the route returns a wider payload. */
type BtwBody = {
  data: {
    sessionId: string;
    anchorForkId: string | null;
    anchorMessageId: string | null;
    anchorSource: 'default' | 'explicit';
    sessionName: string;
  };
  error: { code: string };
};

async function readBody(response: { json(): Promise<unknown> }): Promise<BtwBody> {
  return (await response.json()) as BtwBody;
}

async function withBtwServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'btw-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    mock.restoreAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Installs a provider whose fork records the call and reports fixed ids, and a
 * history reader that returns the given messages.
 */
function stubProvider(options: {
  forkResult?: { providerSessionId: string; jsonlPath: string } | null;
  forkError?: Error;
  messages?: Array<Partial<NormalizedMessage>>;
} = {}): { forkCalls: Array<Record<string, unknown>> } {
  const forkCalls: Array<Record<string, unknown>> = [];
  const fork = options.forkResult === null && !options.forkError
    ? undefined
    : {
      forkSession: async (input: Record<string, unknown>) => {
        forkCalls.push(input);
        if (options.forkError) {
          throw options.forkError;
        }
        return options.forkResult ?? {
          providerSessionId: 'provider-fork-id',
          jsonlPath: '/workspace/demo-project/.claude/provider-fork-id.jsonl',
        };
      },
    };

  const provider = {
    id: 'claude',
    fork,
    runtime: {},
    sessionSynchronizer: {},
  } as unknown as IProvider;

  mock.method(providerRegistry, 'resolveProvider', (() => provider) as unknown as typeof providerRegistry.resolveProvider);
  mock.method(providerRegistry, 'listProviders', (() => [provider]) as unknown as typeof providerRegistry.listProviders);

  const messages = (options.messages ?? [
    { id: 'message-1', role: 'user', kind: 'text', forkAnchorId: 'anchor-1' },
    { id: 'message-2', role: 'assistant', kind: 'text', forkAnchorId: 'anchor-2' },
    { id: 'message-3', role: 'user', kind: 'text', forkAnchorId: 'anchor-3' },
  ]) as NormalizedMessage[];

  mock.method(sessionsService, 'fetchHistory', (async () => ({
    messages,
    total: messages.length,
    hasMore: false,
    offset: 0,
    limit: null,
  })) as unknown as typeof sessionsService.fetchHistory);

  return { forkCalls };
}

function seedSourceSession(sessionId = 'source-session'): void {
  sessionsDb.createSession(sessionId, 'claude', PROJECT_PATH, 'Source conversation');
}

test('the default aside skips a prompt that is still waiting for its answer', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    const { forkCalls } = stubProvider();

    const response = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await readBody(response);

    assert.equal(response.status, 201);
    // The transcript ends on a prompt, so the last turn is unfinished: the cut
    // falls back to its reply instead of handing the copy a question the
    // source never answered.
    assert.equal(payload.data.anchorForkId, 'anchor-2');
    assert.equal(payload.data.anchorMessageId, 'message-2');
    assert.equal(payload.data.anchorSource, 'default');
    assert.equal(forkCalls[0].upToAnchorId, 'anchor-2');

    const row = sessionsDb.getSessionById(payload.data.sessionId);
    assert.equal(row?.is_ephemeral, 1);
    assert.equal(row?.provider_session_id, 'provider-fork-id');
    assert.ok(row?.jsonl_path);
    assert.equal(row?.forked_from_session_id, 'source-session');
    // Invisible everywhere a user can look.
    assert.equal(sessionsDb.getAllSessions().some((entry) => entry.session_id === payload.data.sessionId), false);
  });
});

test('a conversation holding only an unanswered prompt cannot start an aside', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider({
      messages: [{ id: 'only-prompt', role: 'user', kind: 'text', forkAnchorId: 'anchor-only-prompt' }],
    });

    const response = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    assert.equal((await readBody(response)).error.code, 'BTW_ANCHOR_INVALID');
    assert.equal(sessionsDb.listEphemeralSessions().length, 0);
  });
});

test('an explicit fork anchor is honored and a display id is resolved through history', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    const { forkCalls } = stubProvider();

    // `anchor-1` is the first turn's prompt: the cut moves to that turn's
    // reply, because a copy that ends on an unanswered question makes the
    // provider answer it again.
    const byAnchor = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorForkId: 'anchor-1' }),
    });
    assert.equal(byAnchor.status, 201);
    assert.equal(forkCalls[0].upToAnchorId, 'anchor-2');

    const byMessage = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorMessageId: 'message-1' }),
    });
    const payload = await readBody(byMessage);
    assert.equal(byMessage.status, 201);
    assert.equal(payload.data.anchorForkId, 'anchor-2');
    assert.equal(payload.data.anchorMessageId, 'message-2');
    assert.equal(forkCalls[1].upToAnchorId, 'anchor-2');
  });
});

test('an anchor on an assistant reply cuts right there and never crosses the next prompt', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    const { forkCalls } = stubProvider({
      messages: [
        { id: 'user-1', role: 'user', kind: 'text', forkAnchorId: 'anchor-user-1' },
        { id: 'reply-1', role: 'assistant', kind: 'text', forkAnchorId: 'anchor-reply-1' },
        { id: 'user-2', role: 'user', kind: 'text', forkAnchorId: 'anchor-user-2' },
        { id: 'reply-2', role: 'assistant', kind: 'text', forkAnchorId: 'anchor-reply-2' },
      ],
    });

    // The reply the reader acted on, which is already the end of its turn.
    const firstReply = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorForkId: 'anchor-reply-1' }),
    });
    assert.equal(firstReply.status, 201);
    assert.equal(forkCalls[0].upToAnchorId, 'anchor-reply-1');

    const lastReply = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorForkId: 'anchor-reply-2' }),
    });
    const payload = await readBody(lastReply);
    assert.equal(lastReply.status, 201);
    assert.equal(forkCalls[1].upToAnchorId, 'anchor-reply-2');
    assert.equal(payload.data.anchorMessageId, 'reply-2');
  });
});

test('a turn with tool rows and several replies cuts at its last reply', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    const { forkCalls } = stubProvider({
      messages: [
        { id: 'user-1', role: 'user', kind: 'text', forkAnchorId: 'anchor-user-1' },
        // Tool rows carry an anchor of their own on some providers, but a
        // call whose result has not landed is not a boundary.
        { id: 'call-1', role: 'assistant', kind: 'tool_use', forkAnchorId: 'anchor-call-1' },
        { id: 'result-1', role: 'user', kind: 'tool_result' },
        { id: 'reply-1', role: 'assistant', kind: 'text', forkAnchorId: 'anchor-reply-1' },
        { id: 'call-2', role: 'assistant', kind: 'tool_use', forkAnchorId: 'anchor-call-2' },
        { id: 'result-2', role: 'user', kind: 'tool_result' },
        { id: 'reply-2', role: 'assistant', kind: 'text', forkAnchorId: 'anchor-reply-2' },
        { id: 'user-2', role: 'user', kind: 'text', forkAnchorId: 'anchor-user-2' },
      ],
    });

    const fromPrompt = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorForkId: 'anchor-user-1' }),
    });
    const payload = await readBody(fromPrompt);

    assert.equal(fromPrompt.status, 201);
    // Skips both tool rows and stops before the next prompt.
    assert.equal(forkCalls[0].upToAnchorId, 'anchor-reply-2');
    assert.equal(payload.data.anchorMessageId, 'reply-2');
    assert.equal(payload.data.anchorSource, 'explicit');

    const fromToolRow = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorForkId: 'anchor-call-1' }),
    });
    assert.equal(fromToolRow.status, 400);
    assert.equal((await readBody(fromToolRow)).error.code, 'BTW_ANCHOR_INVALID');
  });
});

test('an anchor that no message owns is rejected instead of silently ignored', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider();

    const response = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchorMessageId: 'synthesized-display-id' }),
    });
    const payload = await readBody(response);

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'BTW_ANCHOR_INVALID');
    assert.equal(sessionsDb.listEphemeralSessions().length, 0);
  });
});

test('a session with no anchorable message cannot start an aside', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider({ messages: [{ id: 'tool-row', role: 'user', kind: 'tool_use' }] });

    const response = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 400);
    assert.equal((await readBody(response)).error.code, 'BTW_ANCHOR_INVALID');
  });
});

test('a provider without fork support, or an aside used as source, is refused', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider({ forkResult: null });

    const noFork = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(noFork.status, 409);
    assert.equal((await readBody(noFork)).error.code, 'FORK_NOT_SUPPORTED');
  });

  await withBtwServer(async (baseUrl) => {
    sessionsDb.createPendingEphemeralSession({
      sessionId: 'existing-aside',
      provider: 'claude',
      projectPath: PROJECT_PATH,
      customName: 'Aside',
      nameSource: 'fork',
      forkedFromSessionId: 'source',
      model: null,
      effort: null,
    });
    stubProvider();

    const nested = await fetch(`${baseUrl}/api/providers/sessions/existing-aside/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(nested.status, 409);
    assert.equal((await readBody(nested)).error.code, 'FORK_SOURCE_NOT_READY');
  });
});

test('a failed fork removes the placeholder row instead of leaving it behind', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider({ forkError: new AppError('provider exploded', { code: 'FORK_FAILED', statusCode: 502 }) });

    const response = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 502);
    assert.equal(sessionsDb.listEphemeralSessions().length, 0);
  });
});

test('destroying a real session is refused, and destroying an aside removes what it created', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider();

    const realDelete = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, { method: 'DELETE' });
    assert.equal(realDelete.status, 403);
    assert.equal((await readBody(realDelete)).error.code, 'NOT_EPHEMERAL');

    const created = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const asideId = (await readBody(created)).data.sessionId;

    const deleted = await fetch(`${baseUrl}/api/providers/sessions/${asideId}/btw`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal(sessionsDb.getSessionById(asideId), null);
    assert.equal(sessionsDb.listEphemeralSessions().length, 0);
    // The source conversation is untouched.
    assert.ok(sessionsDb.getSessionById('source-session'));
  });
});

test('promoting a copy renames it, makes it visible, and validates the title', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider();

    const created = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const asideId = (await readBody(created)).data.sessionId;

    const tooLong = await fetch(`${baseUrl}/api/providers/sessions/${asideId}/btw/promote`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(121) }),
    });
    assert.equal(tooLong.status, 400);
    assert.equal((await readBody(tooLong)).error.code, 'BTW_TITLE_INVALID');

    const promoted = await fetch(`${baseUrl}/api/providers/sessions/${asideId}/btw/promote`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Kept conversation' }),
    });
    const payload = await readBody(promoted);

    assert.equal(promoted.status, 200);
    assert.equal(payload.data.sessionName, 'Kept conversation');
    const row = sessionsDb.getSessionById(asideId);
    assert.equal(row?.is_ephemeral, 0);
    assert.equal(row?.custom_name, 'Kept conversation');
  });
});

test('promoting without a title keeps the copy name instead of stacking (btw)', async () => {
  await withBtwServer(async (baseUrl) => {
    seedSourceSession();
    stubProvider();

    const created = await fetch(`${baseUrl}/api/providers/sessions/source-session/btw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const asideId = (await readBody(created)).data.sessionId;

    // The drawer's "save as session" sends no title: the name the create
    // applied already ends in " (btw)", and appending a second one would show
    // up in the sidebar of every promoted copy.
    const promoted = await fetch(`${baseUrl}/api/providers/sessions/${asideId}/btw/promote`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await readBody(promoted);

    assert.equal(promoted.status, 200);
    assert.equal(payload.data.sessionName, 'Source conversation (btw)');
    assert.equal(sessionsDb.getSessionById(asideId)?.custom_name, 'Source conversation (btw)');
  });
});
