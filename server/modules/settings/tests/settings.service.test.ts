import assert from 'node:assert/strict';
import test from 'node:test';

import { createSettingsService } from '../settings.service.js';

type Dependencies = Parameters<typeof createSettingsService>[0];

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    apiKeys: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    credentials: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    notifications: {
      getPreferences: () => undefined,
      updatePreferences: () => ({}),
      createEnabledEvent: () => ({}),
      notifyUser: () => undefined,
    },
    pushSubscriptions: { save: () => undefined, remove: () => undefined },
    authEvents: { list: () => ({ events: [], total: 0 }) },
    getVapidPublicKey: () => null,
    ...overrides,
  };
}

test('listApiKeys redacts secret values through the service boundary', () => {
  const service = createSettingsService(dependencies({
    apiKeys: {
      list: () => [{ id: 1, api_key: '1234567890-secret' }],
      create: () => ({}), remove: () => false, toggle: () => false,
    },
  }));
  assert.equal(service.listApiKeys(1).apiKeys[0]?.api_key, '1234567890...');
});

test('subscribeToPush persists the subscription and enables Web Push', () => {
  const operations: string[] = [];
  const service = createSettingsService(dependencies({
    pushSubscriptions: {
      save: (_id, endpoint) => operations.push(`save:${endpoint}`),
      remove: () => undefined,
    },
    notifications: {
      getPreferences: () => ({ channels: { webPush: false } }),
      updatePreferences: () => { operations.push('preferences'); return {}; },
      createEnabledEvent: () => ({ code: 'push.enabled' }),
      notifyUser: () => { operations.push('notify'); },
    },
  }));

  service.subscribeToPush(1, {
    endpoint: 'https://push.example.test',
    keys: { p256dh: 'key', auth: 'auth' },
  });
  assert.deepEqual(operations, ['save:https://push.example.test', 'preferences', 'notify']);
});

test('listAuthEvents clamps paging, whitelists the event type and trims filters', () => {
  let received: unknown;
  const service = createSettingsService(dependencies({
    authEvents: {
      list: (params) => { received = params; return { events: [], total: 0 }; },
    },
  }));

  service.listAuthEvents({
    limit: '-1', offset: '5', eventType: 'bogus', username: '  bob  ', ip: ' 1.2.3.4 ',
  });

  // -1 clamps up to 1 (a negative LIMIT would otherwise mean "no limit").
  assert.deepEqual(received, {
    limit: 1, offset: 5, eventType: null, username: 'bob', ip: '1.2.3.4',
  });
});

test('listAuthEvents falls back to the default limit when paging is not a number', () => {
  let received: { limit?: number } = {};
  const service = createSettingsService(dependencies({
    authEvents: {
      list: (params) => { received = params; return { events: [], total: 0 }; },
    },
  }));

  service.listAuthEvents({ limit: 'abc' });

  assert.equal(received.limit, 50);
});

test('listAuthEvents bounds the offset and truncates the ip filter like the write side', () => {
  let received: { offset?: number; ip?: string | null } = {};
  const service = createSettingsService(dependencies({
    authEvents: {
      list: (params) => { received = params; return { events: [], total: 0 }; },
    },
  }));

  service.listAuthEvents({ offset: '999999999999', ip: '9'.repeat(80) });

  // A huge offset would otherwise make SQLite sort and discard unbounded rows.
  assert.equal(received.offset, 100_000);
  // Stored ips are already capped at 64 characters, so a longer filter can
  // never match anything — truncating keeps it aligned with the write side.
  assert.equal(received.ip?.length, 64);
});
