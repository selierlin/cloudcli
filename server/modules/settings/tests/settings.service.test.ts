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

  // The agent-failure type must be whitelisted, or the read endpoint would drop
  // the filter and the setting page could never list those rows (phase 2).
  service.listAuthEvents({ eventType: 'agent_auth_failure' });
  assert.deepEqual(received, {
    limit: 50, offset: 0, eventType: 'agent_auth_failure', username: null, ip: null,
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

test('listAuthEvents bounds the offset and leaves username/ip truncation to the repository', () => {
  let received: { offset?: number; ip?: string | null } = {};
  const service = createSettingsService(dependencies({
    authEvents: {
      list: (params) => { received = params; return { events: [], total: 0 }; },
    },
  }));

  service.listAuthEvents({ offset: '999999999999', ip: '9'.repeat(80) });

  // A huge offset would otherwise make SQLite sort and discard unbounded rows.
  assert.equal(received.offset, 100_000);
  // Only trimmed here — the repository truncates to the writer's budget, so a
  // filter matches the value that was stored (see the repository integration
  // test). The service must not re-implement that rule and drift from it (C4).
  assert.equal(received.ip, '9'.repeat(80));
});
