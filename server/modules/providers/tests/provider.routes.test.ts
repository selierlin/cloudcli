import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import { closeConnection, initializeDatabase, projectsDb, sessionsDb } from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { BackgroundTaskSummary, WorkflowAgentActivity } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

async function withProviderServer(
  run: (baseUrl: string, workspacePath: string) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-routes-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
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
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`, path.join(tempDirectory, 'workspace'));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('session creation route names a CloudCLI session from the initial message', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        projectPath: workspacePath,
        initialMessage: 'abcd  efg\nhij klm nop',
      }),
    });
    const payload = await response.json() as {
      data: { sessionId: string; sessionName: string };
    };

    assert.equal(response.status, 201);
    assert.equal(payload.data.sessionName, 'abcd efg hij klm');
    assert.equal(
      sessionsDb.getSessionById(payload.data.sessionId)?.custom_name,
      'abcd efg hij klm',
    );
  });
});

test('available providers route returns only installed harnesses', async () => {
  const listProviders = mock.method(providerRegistry, 'listProviders', () => [
    {
      id: 'claude',
      auth: { getStatus: async () => ({ installed: true }) },
    },
    {
      id: 'opencode',
      auth: { getStatus: async () => ({ installed: false }) },
    },
  ] as any);

  try {
    await withProviderServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/providers/available`);
      const payload = await response.json() as { data: { providers: string[] } };

      assert.equal(response.status, 200);
      assert.deepEqual(payload.data.providers, ['claude']);
    });
  } finally {
    listProviders.mock.restore();
  }
});

test('session pin route persists the requested state and validates its body', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('pinned-session', 'codex', workspacePath, 'Pin me');

    const pinResponse = await fetch(`${baseUrl}/api/providers/sessions/pinned-session/pinned`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isPinned: true }),
    });
    const pinPayload = await pinResponse.json() as { data: { sessionId: string; isPinned: boolean } };

    assert.equal(pinResponse.status, 200);
    assert.deepEqual(pinPayload.data, { sessionId: 'pinned-session', isPinned: true });
    assert.equal(sessionsDb.getSessionById('pinned-session')?.isPinned, 1);

    const invalidResponse = await fetch(`${baseUrl}/api/providers/sessions/pinned-session/pinned`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isPinned: 'true' }),
    });
    const invalidPayload = await invalidResponse.json() as { error: { code: string } };

    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidPayload.error.code, 'INVALID_SESSION_PINNED');
  });
});

test('archived session batch delete permanently removes only archived sessions', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('archived-first', 'codex', workspacePath, 'First archived');
    sessionsDb.createAppSession('archived-second', 'codex', workspacePath, 'Second archived');
    sessionsDb.createAppSession('active-session', 'codex', workspacePath, 'Active');
    sessionsDb.updateSessionIsArchived('archived-first', true);
    sessionsDb.updateSessionIsArchived('archived-second', true);

    const response = await fetch(`${baseUrl}/api/providers/sessions/archived`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['archived-first', 'archived-second'] }),
    });
    const payload = await response.json() as { data: { sessionIds: string[] } };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.sessionIds, ['archived-first', 'archived-second']);
    assert.equal(sessionsDb.getSessionById('archived-first'), null);
    assert.equal(sessionsDb.getSessionById('archived-second'), null);
    assert.ok(sessionsDb.getSessionById('active-session'));
  });
});

test('archived session batch delete rejects active sessions before deleting the batch', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('archived-session', 'codex', workspacePath, 'Archived');
    sessionsDb.createAppSession('active-session', 'codex', workspacePath, 'Active');
    sessionsDb.updateSessionIsArchived('archived-session', true);

    const response = await fetch(`${baseUrl}/api/providers/sessions/archived`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['archived-session', 'active-session'] }),
    });
    const payload = await response.json() as { error: { code: string } };

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'SESSION_NOT_ARCHIVED');
    assert.ok(sessionsDb.getSessionById('archived-session'));
    assert.ok(sessionsDb.getSessionById('active-session'));
  });
});

test('archived session batch delete leaves archived projects and their sessions untouched', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('project-archived-session', 'codex', workspacePath, 'Archived session');
    sessionsDb.updateSessionIsArchived('project-archived-session', true);
    projectsDb.updateProjectIsArchived(workspacePath, true);

    const response = await fetch(`${baseUrl}/api/providers/sessions/archived`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['project-archived-session'] }),
    });
    const payload = await response.json() as { error: { code: string } };

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'SESSION_PROJECT_ARCHIVED');
    assert.ok(sessionsDb.getSessionById('project-archived-session'));
    assert.equal(projectsDb.getProjectPath(workspacePath)?.isArchived, 1);
  });
});

test('conversation search streams title matches before transcript results', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession(
      'title-only-session',
      'codex',
      workspacePath,
      'Release planning notes',
    );
    const transcriptPath = path.join(path.dirname(workspacePath), 'codex-search.jsonl');
    await writeFile(transcriptPath, `${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-12T09:00:00.000Z',
      payload: {
        type: 'user_message',
        kind: 'plain',
        message: 'Release planning also appears in this conversation.',
      },
    })}\n`);
    sessionsDb.createSession(
      'transcript-session',
      'codex',
      workspacePath,
      'Unrelated session',
      undefined,
      undefined,
      transcriptPath,
    );

    const response = await fetch(
      `${baseUrl}/api/providers/search/sessions?q=release%20planning&limit=50`,
    );
    const eventStream = await response.text();
    const titleEventIndex = eventStream.indexOf('event: title-results');
    const conversationEventIndex = eventStream.indexOf('event: result');
    const doneEventIndex = eventStream.indexOf('event: done');

    assert.equal(response.status, 200);
    assert.ok(titleEventIndex >= 0);
    assert.ok(conversationEventIndex > titleEventIndex);
    assert.ok(doneEventIndex > titleEventIndex);

    const titleDataLine = eventStream
      .slice(titleEventIndex, conversationEventIndex)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    assert.ok(titleDataLine);

    const titlePayload = JSON.parse(titleDataLine.slice('data: '.length)) as {
      titleResults: Array<{
        sessionId: string;
        sessionTitle: string;
        provider: string;
      }>;
    };
    assert.equal(titlePayload.titleResults.length, 1);
    assert.equal(titlePayload.titleResults[0]?.sessionId, 'title-only-session');
    assert.equal(titlePayload.titleResults[0]?.sessionTitle, 'Release planning notes');
    assert.equal(titlePayload.titleResults[0]?.provider, 'codex');
  });
});

test('conversation search finds renamed sessions by either session id column', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('renamed-app-session', 'codex', workspacePath, 'Renamed title');
    sessionsDb.assignProviderSessionId('renamed-app-session', 'provider-id-abc123');
    // An archived session is searchable too and comes back flagged, so the UI
    // can badge it instead of silently hiding it from the conversations tab.
    sessionsDb.createAppSession('archived-app-session', 'codex', workspacePath, 'Archived title');
    sessionsDb.assignProviderSessionId('archived-app-session', 'archived-id-def456');
    sessionsDb.updateSessionIsArchived('archived-app-session', true);

    const readTitleResults = async (query: string) => {
      const response = await fetch(
        `${baseUrl}/api/providers/search/sessions?q=${encodeURIComponent(query)}&limit=50`,
      );
      const eventStream = await response.text();
      const titleEventIndex = eventStream.indexOf('event: title-results');
      assert.ok(titleEventIndex >= 0);
      const titleDataLine = eventStream
        .slice(titleEventIndex)
        .split('\n')
        .find((line) => line.startsWith('data: '));
      assert.ok(titleDataLine);
      const titlePayload = JSON.parse(titleDataLine.slice('data: '.length)) as {
        titleResults: Array<{ sessionId: string; sessionTitle: string; isArchived?: boolean }>;
      };
      return titlePayload.titleResults;
    };

    // Both the engine-side id and the app-facing id match; the displayed title
    // stays the custom name instead of leaking the id.
    const byProviderId = await readTitleResults('provider-id-abc123');
    assert.equal(byProviderId.length, 1);
    assert.equal(byProviderId[0]?.sessionId, 'renamed-app-session');
    assert.equal(byProviderId[0]?.sessionTitle, 'Renamed title');
    assert.equal(byProviderId[0]?.isArchived, false);

    const byAppId = await readTitleResults('renamed-app-session');
    assert.equal(byAppId.length, 1);
    assert.equal(byAppId[0]?.sessionTitle, 'Renamed title');

    // The archived session is returned flagged as archived.
    const byArchivedId = await readTitleResults('archived-id-def456');
    assert.equal(byArchivedId.length, 1);
    assert.equal(byArchivedId[0]?.sessionId, 'archived-app-session');
    assert.equal(byArchivedId[0]?.sessionTitle, 'Archived title');
    assert.equal(byArchivedId[0]?.isArchived, true);

    // An unrelated id must not match.
    const byUnrelatedId = await readTitleResults('provider-id-zzz');
    assert.equal(byUnrelatedId.length, 0);
  });
});

test('conversation search finds archived sessions by transcript content and flags them', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    // Standalone archived session: the owning project stays active.
    const standaloneTranscriptPath = path.join(path.dirname(workspacePath), 'archived-standalone.jsonl');
    await writeFile(standaloneTranscriptPath, `${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-12T09:00:00.000Z',
      payload: { type: 'user_message', kind: 'plain', message: 'The real peak load reached 9000.' },
    })}\n`);
    sessionsDb.createSession('archived-standalone', 'codex', workspacePath, 'Archived standalone', undefined, undefined, standaloneTranscriptPath);
    sessionsDb.updateSessionIsArchived('archived-standalone', true);

    // Session whose owning project is itself archived.
    const archivedProjectPath = path.join(path.dirname(workspacePath), 'archived-project');
    const archivedProjectTranscriptPath = path.join(path.dirname(workspacePath), 'archived-project-session.jsonl');
    await writeFile(archivedProjectTranscriptPath, `${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-12T10:00:00.000Z',
      payload: { type: 'user_message', kind: 'plain', message: 'Real peak usage in the archived project.' },
    })}\n`);
    sessionsDb.createSession('archived-project-session', 'codex', archivedProjectPath, 'Archived project session', undefined, undefined, archivedProjectTranscriptPath);
    projectsDb.updateProjectIsArchived(archivedProjectPath, true);

    const contentResponse = await fetch(
      `${baseUrl}/api/providers/search/sessions?q=${encodeURIComponent('real peak')}&limit=50`,
    );
    const contentStream = await contentResponse.text();
    assert.equal(contentResponse.status, 200);

    const contentSessionsById = new Map<string, { isArchived?: boolean }>();
    const contentLines = contentStream.split('\n');
    for (let idx = 0; idx < contentLines.length; idx += 1) {
      if (contentLines[idx] !== 'event: result') continue;
      const dataLine = contentLines[idx + 1];
      if (!dataLine || !dataLine.startsWith('data: ')) continue;
      try {
        const payload = JSON.parse(dataLine.slice('data: '.length)) as {
          projectResult: { sessions: Array<{ sessionId: string; isArchived?: boolean }> };
        };
        for (const session of payload.projectResult.sessions) {
          contentSessionsById.set(session.sessionId, session);
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    const standaloneHit = contentSessionsById.get('archived-standalone');
    const projectHit = contentSessionsById.get('archived-project-session');
    assert.ok(standaloneHit, 'standalone archived session should be found by content');
    assert.equal(standaloneHit?.isArchived, true);
    assert.ok(projectHit, 'session under an archived project should be found by content');
    assert.equal(projectHit?.isArchived, true);

    // Title search also surfaces the archived-project session with the flag.
    const titleResponse = await fetch(
      `${baseUrl}/api/providers/search/sessions?q=${encodeURIComponent('Archived project session')}&limit=50`,
    );
    const titleStream = await titleResponse.text();
    const titleEventIndex = titleStream.indexOf('event: title-results');
    assert.ok(titleEventIndex >= 0);
    const titleDataLine = titleStream
      .slice(titleEventIndex)
      .split('\n')
      .find((line) => line.startsWith('data: '));
    assert.ok(titleDataLine);
    const titlePayload = JSON.parse(titleDataLine.slice('data: '.length)) as {
      titleResults: Array<{ sessionId: string; isArchived?: boolean }>;
    };
    const projectTitleHit = titlePayload.titleResults.find(
      (result) => result.sessionId === 'archived-project-session',
    );
    assert.ok(projectTitleHit, 'session under an archived project should be found by title');
    assert.equal(projectTitleHit?.isArchived, true);
  });
});

test('reasoning effort is persisted and returned with the active session model', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('effort-session', 'codex', workspacePath);

    const updateResponse = await fetch(
      `${baseUrl}/api/providers/codex/sessions/effort-session/active-effort`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ effort: 'ultra' }),
      },
    );
    const updatePayload = await updateResponse.json() as {
      data: { effort: string; sessionId: string };
    };

    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.data.effort, 'ultra');
    assert.equal(sessionsDb.getSessionById('effort-session')?.effort, 'ultra');

    const readResponse = await fetch(
      `${baseUrl}/api/providers/codex/sessions/effort-session/active-model`,
    );
    const readPayload = await readResponse.json() as {
      data: { effort: string | null; sessionId: string };
    };

    assert.equal(readResponse.status, 200);
    assert.equal(readPayload.data.sessionId, 'effort-session');
    assert.equal(readPayload.data.effort, 'ultra');
  });
});

test('model routes expose immutable defaults and full custom model CRUD', async () => {
  await withProviderServer(async (baseUrl) => {
    const initialResponse = await fetch(`${baseUrl}/api/providers/codex/models`);
    const initialPayload = await initialResponse.json() as {
      data: {
        cache?: unknown;
        models: {
          OPTIONS: Array<{ recordId?: number; value: string; isCustom: boolean }>;
        };
      };
    };
    assert.equal(initialResponse.status, 200);
    assert.equal('cache' in initialPayload.data, false);
    const predefined = initialPayload.data.models.OPTIONS[0];
    assert.equal(predefined.isCustom, false);
    assert.equal(predefined.recordId, undefined);

    const createResponse = await fetch(`${baseUrl}/api/providers/codex/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'Gateway GPT', id: 'gateway/gpt' }),
    });
    const createPayload = await createResponse.json() as {
      data: { model: { recordId: number; value: string; label: string; isCustom: boolean } };
    };
    assert.equal(createResponse.status, 201);
    assert.equal(createPayload.data.model.isCustom, true);
    const customRecordId = createPayload.data.model.recordId;

    const updateResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/${customRecordId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Gateway GPT Updated', id: 'gateway/gpt-v2' }),
      },
    );
    const updatePayload = await updateResponse.json() as {
      data: { model: { value: string; label: string } };
    };
    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.data.model.value, 'gateway/gpt-v2');
    assert.equal(updatePayload.data.model.label, 'Gateway GPT Updated');

    const immutableResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/999999`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'Changed', id: 'changed' }),
      },
    );
    const immutablePayload = await immutableResponse.json() as { error: { code: string } };
    assert.equal(immutableResponse.status, 404);
    assert.equal(immutablePayload.error.code, 'MODEL_NOT_FOUND');

    const deleteResponse = await fetch(
      `${baseUrl}/api/providers/codex/models/${customRecordId}`,
      { method: 'DELETE' },
    );
    const deletePayload = await deleteResponse.json() as {
      data: { models: { OPTIONS: Array<{ recordId: number }> } };
    };
    assert.equal(deleteResponse.status, 200);
    assert.equal(
      deletePayload.data.models.OPTIONS.some((option) => option.recordId === customRecordId),
      false,
    );
  });
});

test('session outline route returns lightweight user summaries', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('outline-route-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('outline-route-session', 'claude-native-outline');

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: [
            { id: 'r1', sessionId: 'outline-route-session', timestamp: '2026-08-26T10:00:00.000Z', provider: 'claude', kind: 'text', role: 'user', content: 'Outline first question\nline two' },
            { id: 'r2', sessionId: 'outline-route-session', timestamp: '2026-08-26T10:01:00.000Z', provider: 'claude', kind: 'text', role: 'assistant', content: 'A reply' },
          ],
          total: 2, hasMore: false, offset: 0, limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const response = await fetch(`${baseUrl}/api/providers/sessions/outline-route-session/outline`);
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      data: Array<{ timestamp: string; snippet: string }>;
    };
    assert.deepEqual(payload.data, [
      { timestamp: '2026-08-26T10:00:00.000Z', snippet: 'Outline first question' },
    ]);
  });
});

test('session messages route compresses large history responses', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('compressed-history-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('compressed-history-session', 'claude-native-history');

    const content = 'large history payload '.repeat(300);
    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: [
            {
              id: 'history-message',
              sessionId: 'claude-native-history',
              timestamp: '2026-08-26T10:00:00.000Z',
              provider: 'claude',
              kind: 'text',
              role: 'assistant',
              content,
            },
          ],
          total: 1,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/compressed-history-session/messages`,
      { headers: { 'accept-encoding': 'gzip' } },
    );
    const payload = await response.json() as {
      data: { messages: Array<{ content: string }> };
    };

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(payload.data.messages[0]?.content, content);
  });
});

test('turn pagination cursor keeps the original snapshot when a newer turn is appended', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('turn-page-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('turn-page-session', 'claude-native-turn-page');

    const transcriptMessage = (
      id: string,
      role: 'user' | 'assistant',
      label: string,
      ordinal: number,
    ) => ({
      id,
      sessionId: 'claude-native-turn-page',
      timestamp: new Date(Date.UTC(2026, 8, 16, 10, 0, ordinal)).toISOString(),
      provider: 'claude' as const,
      kind: 'text' as const,
      role,
      content: `${label}:${'x'.repeat(10_000)}`,
    });
    const history = [
      transcriptMessage('u1', 'user', 'first question', 0),
      transcriptMessage('a1', 'assistant', 'first answer', 1),
      transcriptMessage('u2', 'user', 'second question', 2),
      transcriptMessage('a2', 'assistant', 'second answer', 3),
      transcriptMessage('u3', 'user', 'third question', 4),
      transcriptMessage('a3', 'assistant', 'third answer', 5),
    ];

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: [...history],
          total: history.length,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const firstResponse = await fetch(
      `${baseUrl}/api/providers/sessions/turn-page-session/messages?pageMode=turns&byteBudget=25000`,
    );
    const firstPayload = await firstResponse.json() as {
      data: {
        messages: Array<{ id: string }>;
        total: number;
        pageInfo: { snapshotVersion: string; nextCursor: string | null };
      };
    };

    assert.equal(firstResponse.status, 200);
    assert.deepEqual(firstPayload.data.messages.map((message) => message.id), ['u3', 'a3']);
    assert.equal(firstPayload.data.total, 6);
    assert.ok(firstPayload.data.pageInfo.snapshotVersion);
    assert.ok(firstPayload.data.pageInfo.nextCursor);

    history.push(
      transcriptMessage('u4', 'user', 'fourth question', 6),
      transcriptMessage('a4', 'assistant', 'fourth answer', 7),
    );
    const secondResponse = await fetch(
      `${baseUrl}/api/providers/sessions/turn-page-session/messages?pageMode=turns&byteBudget=25000&cursor=${encodeURIComponent(firstPayload.data.pageInfo.nextCursor!)}`,
    );
    const secondPayload = await secondResponse.json() as typeof firstPayload;

    assert.equal(secondResponse.status, 200);
    assert.deepEqual(secondPayload.data.messages.map((message) => message.id), ['u2', 'a2']);
    assert.equal(secondPayload.data.total, 6);
    assert.equal(
      secondPayload.data.pageInfo.snapshotVersion,
      firstPayload.data.pageInfo.snapshotVersion,
    );
  });
});

test('turn pagination can seek to one bounded middle turn with continuations on both sides', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('turn-seek-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('turn-seek-session', 'claude-native-turn-seek');

    const history = Array.from({ length: 3 }, (_, turnIndex) => [
      {
        id: `u${turnIndex + 1}`,
        sessionId: 'claude-native-turn-seek',
        timestamp: `2026-09-16T10:00:0${turnIndex * 2}.000Z`,
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'user' as const,
        content: `question ${turnIndex + 1}:${'q'.repeat(10_000)}`,
      },
      {
        id: `a${turnIndex + 1}`,
        sessionId: 'claude-native-turn-seek',
        timestamp: `2026-09-16T10:00:0${turnIndex * 2 + 1}.000Z`,
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'assistant' as const,
        content: `answer ${turnIndex + 1}:${'a'.repeat(10_000)}`,
      },
    ]).flat();

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: history,
          total: history.length,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/turn-seek-session/messages?pageMode=turns&byteBudget=25000&seekTimestamp=${encodeURIComponent('2026-09-16T10:00:00.000Z')}&seekSnippet=${encodeURIComponent('question 2:')}`,
    );
    const payload = await response.json() as {
      data: {
        messages: Array<{ id: string }>;
        pageInfo: {
          nextCursor: string | null;
          newerCursor: string | null;
          partial: { older: boolean; newer: boolean };
        };
      };
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.messages.map((message) => message.id), ['u2', 'a2']);
    assert.ok(payload.data.pageInfo.nextCursor, 'older continuation should be available');
    assert.ok(payload.data.pageInfo.newerCursor, 'newer continuation should be available');
    assert.deepEqual(payload.data.pageInfo.partial, { older: false, newer: false });

    const newerResponse = await fetch(
      `${baseUrl}/api/providers/sessions/turn-seek-session/messages?pageMode=turns&byteBudget=25000&cursor=${encodeURIComponent(payload.data.pageInfo.newerCursor!)}`,
    );
    const newerPayload = await newerResponse.json() as typeof payload;
    assert.equal(newerResponse.status, 200);
    assert.deepEqual(newerPayload.data.messages.map((message) => message.id), ['u3', 'a3']);
    assert.equal(newerPayload.data.pageInfo.newerCursor, null);
  });
});

test('seek keeps an interior hit visible when its turn is larger than the byte budget', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('oversized-seek-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('oversized-seek-session', 'claude-native-oversized-seek');

    const history = [
      {
        id: 'oversized-user',
        sessionId: 'claude-native-oversized-seek',
        timestamp: '2026-09-16T10:00:00.000Z',
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'user' as const,
        content: `question:${'q'.repeat(7_000)}`,
      },
      {
        id: 'tool-use',
        sessionId: 'claude-native-oversized-seek',
        timestamp: '2026-09-16T10:00:01.000Z',
        provider: 'claude' as const,
        kind: 'tool_use' as const,
        role: 'assistant' as const,
        toolId: 'call-1',
        toolName: 'Read',
        toolInput: { file_path: '/tmp/example.txt' },
      },
      {
        id: 'tool-result',
        sessionId: 'claude-native-oversized-seek',
        timestamp: '2026-09-16T10:00:02.000Z',
        provider: 'claude' as const,
        kind: 'tool_result' as const,
        role: 'user' as const,
        toolId: 'call-1',
        content: `unique interior seek result:${'r'.repeat(3_000)}`,
      },
      {
        id: 'oversized-answer',
        sessionId: 'claude-native-oversized-seek',
        timestamp: '2026-09-16T10:00:03.000Z',
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'assistant' as const,
        content: `answer:${'a'.repeat(7_000)}`,
      },
    ];

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: history,
          total: history.length,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/oversized-seek-session/messages?pageMode=turns&byteBudget=5000&seekSnippet=${encodeURIComponent('unique interior seek result:')}`,
    );
    const payload = await response.json() as {
      data: {
        messages: Array<{ id: string }>;
        pageInfo: {
          nextCursor: string | null;
          newerCursor: string | null;
          partial: { older: boolean; newer: boolean };
        };
      };
    };

    assert.equal(response.status, 200);
    assert.deepEqual(
      payload.data.messages.map((message) => message.id),
      ['tool-use', 'tool-result'],
      'the bounded page should keep the result searchable and attachable to its tool call',
    );
    assert.ok(payload.data.pageInfo.nextCursor, 'the omitted prefix should remain pageable');
    assert.ok(payload.data.pageInfo.newerCursor, 'the omitted suffix should remain pageable');
    assert.deepEqual(payload.data.pageInfo.partial, { older: true, newer: true });
  });
});

test('an oversized turn reports which side is missing across byte-budget pages', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('oversized-turn-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('oversized-turn-session', 'claude-native-oversized');

    const history = [
      {
        id: 'oversized-user',
        sessionId: 'claude-native-oversized',
        timestamp: '2026-09-16T10:00:00.000Z',
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'user' as const,
        content: `question:${'q'.repeat(10_000)}`,
      },
      {
        id: 'oversized-answer',
        sessionId: 'claude-native-oversized',
        timestamp: '2026-09-16T10:00:01.000Z',
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'assistant' as const,
        content: `answer:${'a'.repeat(10_000)}`,
      },
    ];

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: history,
          total: history.length,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const firstResponse = await fetch(
      `${baseUrl}/api/providers/sessions/oversized-turn-session/messages?pageMode=turns&byteBudget=5000`,
    );
    const firstPayload = await firstResponse.json() as {
      data: {
        messages: Array<{ id: string }>;
        pageInfo: {
          nextCursor: string | null;
          partial: { older: boolean; newer: boolean };
        };
      };
    };
    assert.deepEqual(firstPayload.data.messages.map((message) => message.id), ['oversized-answer']);
    assert.deepEqual(firstPayload.data.pageInfo.partial, { older: true, newer: false });

    const secondResponse = await fetch(
      `${baseUrl}/api/providers/sessions/oversized-turn-session/messages?pageMode=turns&byteBudget=5000&cursor=${encodeURIComponent(firstPayload.data.pageInfo.nextCursor!)}`,
    );
    const secondPayload = await secondResponse.json() as typeof firstPayload;
    assert.deepEqual(secondPayload.data.messages.map((message) => message.id), ['oversized-user']);
    assert.deepEqual(secondPayload.data.pageInfo.partial, { older: false, newer: true });
    assert.equal(secondPayload.data.pageInfo.nextCursor, null);
  });
});

test('turn pagination snapshot ignores provider ids regenerated on each history read', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('regenerated-id-session', 'codex', workspacePath);
    sessionsDb.assignProviderSessionId('regenerated-id-session', 'codex-native-regenerated');

    const semanticHistory = [
      { role: 'user' as const, content: `first question:${'q'.repeat(10_000)}` },
      { role: 'assistant' as const, content: `first answer:${'a'.repeat(10_000)}` },
      { role: 'user' as const, content: `second question:${'q'.repeat(10_000)}` },
      { role: 'assistant' as const, content: `second answer:${'a'.repeat(10_000)}` },
    ];
    let readCount = 0;
    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => {
          readCount += 1;
          return {
            messages: semanticHistory.map((entry, index) => ({
              ...entry,
              id: `read-${readCount}-row-${index}`,
              sessionId: 'codex-native-regenerated',
              timestamp: new Date(Date.UTC(2026, 8, 16, 10, 0, index)).toISOString(),
              provider: 'codex' as const,
              kind: 'text' as const,
            })),
            total: semanticHistory.length,
            hasMore: false,
            offset: 0,
            limit: null,
          };
        },
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const firstResponse = await fetch(
      `${baseUrl}/api/providers/sessions/regenerated-id-session/messages?pageMode=turns&byteBudget=25000`,
    );
    const firstPayload = await firstResponse.json() as {
      data: { pageInfo: { nextCursor: string | null } };
    };
    const secondResponse = await fetch(
      `${baseUrl}/api/providers/sessions/regenerated-id-session/messages?pageMode=turns&byteBudget=25000&cursor=${encodeURIComponent(firstPayload.data.pageInfo.nextCursor!)}`,
    );
    const secondPayload = await secondResponse.json() as {
      data?: { messages: Array<{ content: string }> };
      error?: { code: string };
    };

    assert.equal(secondResponse.status, 200);
    assert.deepEqual(
      secondPayload.data?.messages.map((message) => message.content.split(':')[0]),
      ['first question', 'first answer'],
    );
  });
});

test('turn pagination returns page metadata before a new session has provider history', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('empty-turn-page-session', 'claude', workspacePath);

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/empty-turn-page-session/messages?pageMode=turns`,
    );
    const payload = await response.json() as {
      data: {
        messages: unknown[];
        pageInfo: {
          mode: string;
          snapshotVersion: string;
          nextCursor: string | null;
          newerCursor: string | null;
          partial: { older: boolean; newer: boolean };
        };
      };
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.data.messages, []);
    assert.deepEqual(payload.data.pageInfo, {
      mode: 'turns',
      snapshotVersion: '47DEQpj8HBSa-_TImW-5JC',
      nextCursor: null,
      newerCursor: null,
      partial: { older: false, newer: false },
    });
  });
});

test('turn pagination rejects a fabricated newer cursor at the snapshot tail', async (t) => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('fabricated-cursor-session', 'claude', workspacePath);
    sessionsDb.assignProviderSessionId('fabricated-cursor-session', 'claude-native-fabricated-cursor');

    const history = [
      {
        id: 'u1',
        sessionId: 'claude-native-fabricated-cursor',
        timestamp: '2026-09-16T10:00:00.000Z',
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'user' as const,
        content: 'question 1',
      },
      {
        id: 'a1',
        sessionId: 'claude-native-fabricated-cursor',
        timestamp: '2026-09-16T10:00:01.000Z',
        provider: 'claude' as const,
        kind: 'text' as const,
        role: 'assistant' as const,
        content: 'answer 1',
      },
    ];

    mock.method(providerRegistry, 'resolveProvider', (() => ({
      sessions: {
        fetchHistory: async () => ({
          messages: history,
          total: history.length,
          hasMore: false,
          offset: 0,
          limit: null,
        }),
      },
    })) as unknown as typeof providerRegistry.resolveProvider);
    t.after(() => mock.reset());

    const response = await fetch(
      `${baseUrl}/api/providers/sessions/fabricated-cursor-session/messages?pageMode=turns`,
    );
    const payload = await response.json() as {
      data: {
        total: number;
        pageInfo: { snapshotVersion: string };
      };
    };
    assert.equal(response.status, 200);

    // The server only issues newer cursors strictly inside the snapshot. A
    // client that fabricates one at the tail boundary used to crash pagination
    // with an out-of-bounds read; it must be rejected as an invalid cursor.
    const fabricatedCursor = Buffer.from(JSON.stringify({
      version: 1,
      sessionId: 'fabricated-cursor-session',
      snapshotTotal: payload.data.total,
      snapshotVersion: payload.data.pageInfo.snapshotVersion,
      direction: 'newer',
      boundary: payload.data.total,
    }), 'utf8').toString('base64url');

    const rejected = await fetch(
      `${baseUrl}/api/providers/sessions/fabricated-cursor-session/messages?pageMode=turns&cursor=${encodeURIComponent(fabricatedCursor)}`,
    );
    const rejectedPayload = await rejected.json() as {
      error: { code: string };
    };
    assert.equal(rejected.status, 400);
    assert.equal(rejectedPayload.error.code, 'INVALID_HISTORY_CURSOR');
  });
});

test('session outline route reports unknown sessions as 404', async () => {
  await withProviderServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/providers/sessions/nope/outline`);
    assert.equal(response.status, 404);
  });
});

test('session branch route rejects a URL provider other than Claude', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    sessionsDb.createAppSession('claude-branch-session', 'claude', workspacePath);

    const response = await fetch(
      `${baseUrl}/api/providers/codex/sessions/claude-branch-session/branch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId: 'message-1_text_0' }),
      },
    );
    const payload = await response.json() as { error: { code: string } };

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'BRANCH_UNSUPPORTED_PROVIDER');
  });
});

test('the running-sessions route reports a session held open for background work', async () => {
  // The client polls this route to keep every tab's activity map in step, so
  // a session whose turn ended but whose agent is still running has to be in
  // the payload — flagged as background work, with the tasks to show and stop.
  const tasks: BackgroundTaskSummary[] = [{
    taskId: 'a73dc7a6442f7c415',
    toolUseId: 'toolu_013sUz4iWcNjN6BskVkHUCAr',
    taskType: 'local_agent',
    description: 'Investigate the flaky test',
    startedAt: 1_700_000_000_000,
  }];
  const realListProviders = providerRegistry.listProviders;
  providerRegistry.listProviders = () => [{
    id: 'claude',
    runtime: { listBackgroundWork: () => [{ sessionId: 'held-session', tasks }] },
  } as unknown as IProvider];

  try {
    await withProviderServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/providers/sessions/running`);
      const payload = await response.json() as { data: { sessions: unknown[] } };

      assert.equal(response.status, 200);
      assert.deepEqual(payload.data.sessions, [{
        sessionId: 'held-session',
        provider: 'claude',
        startedAt: 1_700_000_000_000,
        lastSeq: 0,
        background: true,
        canInterrupt: false,
        tasks,
      }]);
    });
  } finally {
    providerRegistry.listProviders = realListProviders;
  }
});

const WORKFLOW_SESSION_ID = 'claude-workflow-routes-session';
const WORKFLOW_RUN_ID = 'wf_16fbf852-274';
const FINISHED_AGENT_ID = 'aa1e064cf8bd159d6';
const UNREPORTED_AGENT_ID = 'ab89f2cde612a51b1';

/**
 * Writes a workflow run's directory the way a real run leaves it under the
 * session's transcript directory: one `agent-<id>.jsonl` per agent, in the
 * row shape an Agent subagent's transcript has, and the journal beside them.
 */
async function writeWorkflowRun(projectDirectory: string): Promise<string> {
  const sessionPath = path.join(projectDirectory, `${WORKFLOW_SESSION_ID}.jsonl`);
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify({ type: 'user', uuid: 'u1', sessionId: WORKFLOW_SESSION_ID, timestamp: '2026-08-21T10:32:10.000Z', message: { role: 'user', content: 'audit the frontend' } })}\n`, 'utf8');

  const runDir = path.join(projectDirectory, WORKFLOW_SESSION_ID, 'subagents', 'workflows', WORKFLOW_RUN_ID);
  await mkdir(runDir, { recursive: true });

  const agentRows = (agentId: string) => [
    { parentUuid: null, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u1`, timestamp: '2026-08-21T10:32:20.000Z', message: { role: 'user', content: 'You are the analysis step of a code-quality audit.' } },
    { parentUuid: `${agentId}-u1`, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a1`, timestamp: '2026-08-21T10:32:25.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'tool_use', id: `toolu_${agentId}_1`, name: 'Grep', input: { pattern: 'useSidebar' } }] } },
    { parentUuid: `${agentId}-a1`, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u2`, timestamp: '2026-08-21T10:32:26.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${agentId}_1`, content: 'src/modules/sidebar/useSidebar.ts' }] } },
    { parentUuid: `${agentId}-u2`, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a2`, timestamp: '2026-08-21T10:32:40.000Z', message: { role: 'assistant', model: 'claude-opus-4-1', content: [{ type: 'text', text: 'One hook owns the sidebar.' }] } },
  ];
  for (const agentId of [FINISHED_AGENT_ID, UNREPORTED_AGENT_ID]) {
    await writeFile(path.join(runDir, `agent-${agentId}.jsonl`), `${agentRows(agentId).map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    await writeFile(path.join(runDir, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'workflow-subagent', spawnDepth: 1 }), 'utf8');
  }
  const journal = [
    { type: 'started', key: 'v2:one', agentId: FINISHED_AGENT_ID, label: 'audit:sidebar', phase: 'Audit' },
    { type: 'started', key: 'v2:two', agentId: UNREPORTED_AGENT_ID, label: 'synthesize', phase: 'Synthesize' },
    { type: 'result', key: 'v2:one', agentId: FINISHED_AGENT_ID, result: { area: 'sidebar' } },
  ];
  await writeFile(path.join(runDir, 'journal.jsonl'), `${journal.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  return sessionPath;
}

test('the workflow agent route reads an agent\'s timeline and status from its run directory', async () => {
  await withProviderServer(async (baseUrl, workspacePath) => {
    const sessionPath = await writeWorkflowRun(workspacePath);
    const now = new Date().toISOString();
    sessionsDb.createSession(WORKFLOW_SESSION_ID, 'claude', workspacePath, 'Workflow session', now, now, sessionPath);

    const agentUrl = (runId: string, agentId: string) =>
      `${baseUrl}/api/providers/sessions/${WORKFLOW_SESSION_ID}/workflows/${runId}/agents/${agentId}`;

    // The SDK streams none of an agent's rows to the parent, so its transcript
    // is the only record of what it did — read on demand, capped like an
    // Agent card's, and settled by the journal beside it.
    const finishedResponse = await fetch(agentUrl(WORKFLOW_RUN_ID, FINISHED_AGENT_ID));
    const finished = (await finishedResponse.json() as { data: WorkflowAgentActivity }).data;
    assert.equal(finishedResponse.status, 200);
    assert.deepEqual(finished.agent, { id: FINISHED_AGENT_ID, label: 'audit:sidebar', model: 'claude-opus-4-1', status: 'completed' });
    assert.equal(finished.activityCount, 2);
    assert.deepEqual(finished.activity.map((entry) => entry.kind), ['tool', 'text']);
    assert.equal(finished.activity[0]?.toolName, 'Grep');
    assert.deepEqual(finished.activity[0]?.toolInput, { pattern: 'useSidebar' });
    assert.deepEqual(finished.activity[0]?.toolResult, { content: 'src/modules/sidebar/useSidebar.ts', isError: false });
    assert.equal(finished.activity[1]?.content, 'One hook owns the sidebar.');

    // A `started` with no `result` or `failed`, and no live run of the session
    // to still be working in: nothing can report for it any more.
    const unreportedResponse = await fetch(agentUrl(WORKFLOW_RUN_ID, UNREPORTED_AGENT_ID));
    const unreported = (await unreportedResponse.json() as { data: WorkflowAgentActivity }).data;
    assert.equal(unreportedResponse.status, 200);
    assert.equal(unreported.agent.status, 'stopped');
    assert.equal(unreported.agent.label, 'synthesize');

    // Both ids name a file under the session directory, so neither may carry
    // anything but the harness's own shapes — not even a well-formed
    // directory that happens to exist.
    for (const [runId, agentId, code] of [
      [`${WORKFLOW_RUN_ID}%2F..`, FINISHED_AGENT_ID, 'INVALID_WORKFLOW_RUN_ID'],
      ['subagents', FINISHED_AGENT_ID, 'INVALID_WORKFLOW_RUN_ID'],
      [WORKFLOW_RUN_ID, '..%2Fjournal', 'INVALID_WORKFLOW_AGENT_ID'],
      [WORKFLOW_RUN_ID, 'aa1e064cf8bd159d', 'INVALID_WORKFLOW_AGENT_ID'],
    ] as const) {
      const response = await fetch(agentUrl(runId, agentId));
      const payload = await response.json() as { error: { code: string } };
      assert.equal(response.status, 400, `${runId}/${agentId}`);
      assert.equal(payload.error.code, code);
    }

    const missingResponse = await fetch(agentUrl(WORKFLOW_RUN_ID, 'a0000000000000000'));
    const missing = await missingResponse.json() as { error: { code: string } };
    assert.equal(missingResponse.status, 404);
    assert.equal(missing.error.code, 'WORKFLOW_AGENT_NOT_FOUND');
  });
});
