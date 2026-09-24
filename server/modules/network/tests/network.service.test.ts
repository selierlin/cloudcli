import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { applyProxyToProcessEnv, networkProxyService } from '@/modules/network/network.service.js';
import { AppError } from '@/shared/utils.js';

/** Mirrors the proxy variables the service owns, so tests can isolate and restore them. */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
] as const;

function snapshotProxyEnv(): Record<string, string | undefined> {
  return Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreProxyEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of PROXY_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousProxyEnv = snapshotProxyEnv();
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'network-proxy-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    restoreProxyEnv(previousProxyEnv);
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('networkProxyService defaults to no proxy and clears inherited proxy variables', async () => {
  await withIsolatedDatabase(() => {
    process.env.HTTPS_PROXY = 'http://inherited:1';
    process.env.https_proxy = 'http://inherited:1';

    assert.deepEqual(networkProxyService.getConfig(), { proxyUrl: null });

    applyProxyToProcessEnv();

    for (const key of PROXY_ENV_KEYS) {
      assert.equal(process.env[key], undefined, `${key} should be cleared`);
    }
  });
});

test('networkProxyService writes the proxy onto every case and sets NO_PROXY', async () => {
  await withIsolatedDatabase(() => {
    const config = networkProxyService.updateConfig({ proxyUrl: '  http://127.0.0.1:7890  ' });

    assert.equal(config.proxyUrl, 'http://127.0.0.1:7890');
    assert.equal(process.env.HTTP_PROXY, 'http://127.0.0.1:7890');
    assert.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:7890');
    assert.equal(process.env.http_proxy, 'http://127.0.0.1:7890');
    assert.equal(process.env.https_proxy, 'http://127.0.0.1:7890');
    assert.equal(process.env.NO_PROXY, 'localhost,127.0.0.1,::1');
    assert.equal(process.env.no_proxy, 'localhost,127.0.0.1,::1');
    // Node-based harnesses (DSH) only honor the variables above with this flag.
    assert.equal(process.env.NODE_USE_ENV_PROXY, '1');
  });
});

test('networkProxyService persists the URL and replays it on the next boot', async () => {
  await withIsolatedDatabase(() => {
    networkProxyService.updateConfig({ proxyUrl: 'http://127.0.0.1:7890' });

    // Simulate a fresh process that lost its environment but kept the database.
    for (const key of PROXY_ENV_KEYS) {
      delete process.env[key];
    }
    applyProxyToProcessEnv();

    assert.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:7890');
    assert.deepEqual(networkProxyService.getConfig(), { proxyUrl: 'http://127.0.0.1:7890' });
  });
});

test('networkProxyService clears the proxy when saved blank', async () => {
  await withIsolatedDatabase(() => {
    networkProxyService.updateConfig({ proxyUrl: 'http://127.0.0.1:7890' });

    const config = networkProxyService.updateConfig({ proxyUrl: '   ' });

    assert.equal(config.proxyUrl, null);
    for (const key of PROXY_ENV_KEYS) {
      assert.equal(process.env[key], undefined, `${key} should be cleared`);
    }
  });
});

test('networkProxyService keeps the stored URL when the update omits it', async () => {
  await withIsolatedDatabase(() => {
    networkProxyService.updateConfig({ proxyUrl: 'http://127.0.0.1:7890' });

    const config = networkProxyService.updateConfig({});

    assert.equal(config.proxyUrl, 'http://127.0.0.1:7890');
  });
});

test('networkProxyService rejects a URL that is not an HTTP(S) proxy', async () => {
  await withIsolatedDatabase(() => {
    assert.throws(
      () => networkProxyService.updateConfig({ proxyUrl: '127.0.0.1:7890' }),
      (error: unknown) => error instanceof AppError && error.code === 'NETWORK_PROXY_URL_INVALID',
    );
    // A rejected value must not have been persisted.
    assert.deepEqual(networkProxyService.getConfig(), { proxyUrl: null });
  });
});
