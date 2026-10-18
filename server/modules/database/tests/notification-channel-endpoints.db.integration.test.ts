import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  notificationChannelEndpointsDb,
  userDb,
} from '@/modules/database/index.js';

async function withDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'notification-endpoints-db-'));
  const databasePath = path.join(temporaryDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  const user = userDb.createUser('endpoints-test', 'hash');

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

test('a new endpoint starts enabled when the caller has no opinion', async () => {
  await withDatabase((userId) => {
    const endpoint = notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com' },
    });

    assert.equal(endpoint.enabled, 1);
  });
});

test('re-saving an existing endpoint keeps its disabled state', async () => {
  await withDatabase((userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com' },
      enabled: false,
    });

    // Re-adding the same device from Settings sends no enabled flag; it must not
    // silently switch the endpoint back on.
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com', group: 'Renamed' },
    });

    const row = notificationChannelEndpointsDb.getEndpoint(userId, 'bark', 'device-key-1');
    assert.equal(row?.enabled, 0);
    assert.deepEqual(notificationChannelEndpointsDb.parseMetadata(row?.metadata_json ?? null), {
      serverUrl: 'https://bark.example.com',
      group: 'Renamed',
    });
  });
});

test('an explicit enabled flag still overrides the stored state', async () => {
  await withDatabase((userId) => {
    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com' },
      enabled: false,
    });

    notificationChannelEndpointsDb.upsertEndpoint({
      userId,
      channel: 'bark',
      endpointId: 'device-key-1',
      metadata: { serverUrl: 'https://bark.example.com' },
      enabled: true,
    });

    const row = notificationChannelEndpointsDb.getEndpoint(userId, 'bark', 'device-key-1');
    assert.equal(row?.enabled, 1);
  });
});
