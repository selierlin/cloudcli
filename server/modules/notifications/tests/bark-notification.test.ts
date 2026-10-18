import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationChannelEndpointsDb,
  notificationPreferencesDb,
  userDb,
} from '@/modules/database/index.js';

import {
  createNotificationEvent,
  notifyUserIfEnabled,
} from '../services/notification-orchestrator.service.js';
import {
  sendBarkNotification,
  sendBarkTestNotification,
} from '../services/bark-notification.service.js';

async function withIsolatedDatabase(runTest: (userId: number) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'bark-notification-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  const user = userDb.createUser('bark-test', 'hash');

  try {
    await runTest(Number(user.id));
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

type CapturedRequest = {
  url: string;
  body: Record<string, unknown> | null;
};

function mockFetch(t: TestContext, requests: CapturedRequest[]) {
  t.mock.method(
    globalThis,
    'fetch',
    (async (input: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null,
      });
      return new Response(JSON.stringify({ code: 200, message: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

test('bark channel posts the payload to the configured server', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com/', group: 'CloudCLI · A', subtitle: 'A', level: 'active' },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    await sendBarkNotification(userId, { title: 'Session', body: 'Claude: ✅ 回复已完成' });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://bark.example.com/push');
    assert.deepEqual(requests[0].body, {
      device_key: 'device-key-1',
      title: 'Session',
      body: 'Claude: ✅ 回复已完成',
      group: 'CloudCLI · A',
      subtitle: 'A',
      level: 'active',
    });
  });
});

test('bark channel skips disabled endpoints', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com' },
      enabled: false,
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    await sendBarkNotification(userId, { title: 'Session', body: 'done' });

    assert.equal(requests.length, 0);
  });
});

test('a missing server URL fails that endpoint without calling Bark', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { group: 'CloudCLI' },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    const results = await sendBarkTestNotification(userId, 'device-key-1');

    assert.equal(requests.length, 0);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.match(results[0].message, /server URL/i);
  });
});

test('a Bark business error is reported, not thrown', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'http://bark.lan:8080' },
    });

    t.mock.method(
      globalThis,
      'fetch',
      (async () => new Response(JSON.stringify({ code: 400, message: 'device token invalid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch,
    );

    const results = await sendBarkTestNotification(userId, 'device-key-1');

    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.equal(results[0].message, 'device token invalid');
  });
});

test('the orchestrator reaches Bark when an enabled endpoint exists', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com', group: 'CloudCLI · A' },
    });
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { bark: true },
      events: { actionRequired: true, stop: true, error: true },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    notifyUserIfEnabled({
      userId,
      event: createNotificationEvent({
        provider: 'claude',
        sessionId: 'bark-wiring-session',
        kind: 'stop',
        code: 'run.stopped',
        meta: { stopReason: 'completed' },
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body?.device_key, 'device-key-1');
  });
});

test('an icon base URL turns the requested mark into a static icon URL', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      // Pre-rename key: rows saved before `publicBaseUrl` existed must still work.
      metadata: { serverUrl: 'https://bark.example.com', iconBaseUrl: 'http://192.168.1.5:3001/' },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    await sendBarkNotification(userId, { title: 'Session', body: 'failed', iconKind: 'failed' });

    assert.equal(requests[0].body?.icon, 'http://192.168.1.5:3001/icons/bark/failed.png');
  });
});

test('a session event carries a tap-through link built from the public base URL', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com', publicBaseUrl: 'https://cloudcli.example.com/cc' },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    await sendBarkNotification(userId, {
      title: 'Session',
      body: 'done',
      iconKind: 'complete',
      sessionId: 'sess-1',
    });

    assert.equal(requests[0].body?.icon, 'https://cloudcli.example.com/cc/icons/bark/complete.png');
    assert.equal(
      requests[0].body?.url,
      `cloudcli://open?url=${encodeURIComponent('https://cloudcli.example.com/cc/session/sess-1')}`,
    );
  });
});

test('an event without a session id carries no tap-through link', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com', publicBaseUrl: 'https://cloudcli.example.com' },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    await sendBarkNotification(userId, { title: 'Session', body: 'done', iconKind: 'complete' });

    assert.equal(requests[0].body?.url, undefined);
  });
});

test('a loopback public base URL is dropped instead of sent to the phone', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com', publicBaseUrl: 'http://localhost:3001' },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    await sendBarkNotification(userId, {
      title: 'Session',
      body: 'done',
      iconKind: 'complete',
      sessionId: 'sess-1',
    });

    assert.equal(requests[0].body?.icon, undefined);
    assert.equal(requests[0].body?.url, undefined);
  });
});

test('a test push for an unknown endpoint reports a failure instead of an empty list', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    const results = await sendBarkTestNotification(userId, 'missing-key');

    assert.equal(requests.length, 0);
    assert.deepEqual(results, [{
      endpointId: 'missing-key',
      ok: false,
      message: 'Bark endpoint not found',
    }]);
  });
});

test('each run event carries the mark the favicon would show', async (t) => {
  await withIsolatedDatabase(async (userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com', iconBaseUrl: 'https://cloudcli.example.com' },
    });
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { bark: true },
      events: { actionRequired: true, stop: true, error: true },
    });

    const requests: CapturedRequest[] = [];
    mockFetch(t, requests);

    const events = [
      createNotificationEvent({
        provider: 'claude',
        sessionId: 'mark-completed',
        kind: 'stop',
        code: 'run.stopped',
        meta: { stopReason: 'completed' },
      }),
      createNotificationEvent({
        provider: 'claude',
        sessionId: 'mark-aborted',
        kind: 'stop',
        code: 'run.stopped',
        meta: { stopReason: 'aborted' },
      }),
      createNotificationEvent({
        provider: 'claude',
        sessionId: 'mark-failed',
        kind: 'error',
        code: 'run.failed',
        meta: { error: 'boom' },
      }),
      createNotificationEvent({
        provider: 'claude',
        sessionId: 'mark-approval',
        kind: 'action_required',
        code: 'permission.required',
        meta: { toolName: 'Bash' },
      }),
    ];

    for (const event of events) {
      notifyUserIfEnabled({ userId, event });
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(requests.map((request) => request.body?.icon), [
      'https://cloudcli.example.com/icons/bark/complete.png',
      undefined,
      'https://cloudcli.example.com/icons/bark/failed.png',
      'https://cloudcli.example.com/icons/bark/approval.png',
    ]);
  });
});

