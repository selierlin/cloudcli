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
