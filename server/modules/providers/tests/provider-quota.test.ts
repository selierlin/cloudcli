import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import {
  providerQuotaService,
  resetProviderQuotaCacheForTests,
} from '@/modules/providers/services/provider-quota.service.js';
import type { ProviderQuota } from '@/shared/types.js';

/**
 * The service only caches and dispatches; the Codex side is stubbed so these
 * tests describe dispatch, caching and failure handling without spawning a
 * real app-server per case.
 */
const quotaSnapshot: ProviderQuota = {
  provider: 'codex',
  windows: [
    { usedPercent: 6, windowMinutes: 300, resetsAt: 1_789_619_168 },
    { usedPercent: 31, windowMinutes: 10_080, resetsAt: 1_790_140_809 },
  ],
  planType: 'plus',
  credits: null,
  creditsUsed: null,
  creditsTotal: null,
  isPaidAccount: null,
  fetchedAt: 1_789_601_738_360,
};

/** Swaps in a fake `readQuota` for one test and restores the real one afterwards. */
async function withStubbedCodexQuota<T>(
  readQuota: () => Promise<ProviderQuota>,
  run: (calls: number[]) => Promise<T>,
): Promise<T> {
  const realReadQuota = codexAppServer.readQuota;
  const calls: number[] = [];
  codexAppServer.readQuota = async () => {
    calls.push(calls.length + 1);
    return readQuota();
  };

  try {
    return await run(calls);
  } finally {
    codexAppServer.readQuota = realReadQuota;
  }
}

test('a provider with no quota source answers null and reads nothing', { concurrency: false }, async () => {
  resetProviderQuotaCacheForTests();

  await withStubbedCodexQuota(
    async () => quotaSnapshot,
    async (calls) => {
      const quota = await providerQuotaService.getProviderQuota('claude');

      assert.equal(quota, null);
      assert.deepEqual(calls, []);
    },
  );
});

test('codex returns the snapshot its account reports', { concurrency: false }, async () => {
  resetProviderQuotaCacheForTests();

  await withStubbedCodexQuota(
    async () => quotaSnapshot,
    async () => {
      const quota = await providerQuotaService.getProviderQuota('codex');

      assert.deepEqual(quota, quotaSnapshot);
    },
  );
});

test('a second read inside the cache window reuses the first answer', { concurrency: false }, async () => {
  resetProviderQuotaCacheForTests();

  await withStubbedCodexQuota(
    async () => quotaSnapshot,
    async (calls) => {
      const first = await providerQuotaService.getProviderQuota('codex');
      const second = await providerQuotaService.getProviderQuota('codex');

      assert.deepEqual(first, quotaSnapshot);
      assert.deepEqual(second, quotaSnapshot);
      assert.equal(calls.length, 1);
    },
  );
});

test('concurrent reads share one provider call', { concurrency: false }, async () => {
  resetProviderQuotaCacheForTests();

  await withStubbedCodexQuota(
    async () => quotaSnapshot,
    async (calls) => {
      const [first, second] = await Promise.all([
        providerQuotaService.getProviderQuota('codex'),
        providerQuotaService.getProviderQuota('codex'),
      ]);

      assert.deepEqual(first, quotaSnapshot);
      assert.deepEqual(second, quotaSnapshot);
      assert.equal(calls.length, 1);
    },
  );
});

test('a failed read answers null and is retried on the next call', { concurrency: false }, async () => {
  resetProviderQuotaCacheForTests();

  let attempts = 0;
  const realReadQuota = codexAppServer.readQuota;
  codexAppServer.readQuota = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('codex app-server exited');
    }
    return quotaSnapshot;
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const failed = await providerQuotaService.getProviderQuota('codex');
    const recovered = await providerQuotaService.getProviderQuota('codex');

    assert.equal(failed, null);
    assert.deepEqual(recovered, quotaSnapshot);
    assert.equal(attempts, 2);
  } finally {
    console.warn = originalWarn;
    codexAppServer.readQuota = realReadQuota;
  }
});

test('workbuddy answers a credits-only snapshot from its console', { concurrency: false }, async () => {
  resetProviderQuotaCacheForTests();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-quota-dispatch-'));
  const authFile = path.join(dir, 'workbuddy-desktop.info');
  await fs.writeFile(
    authFile,
    JSON.stringify({
      auth: {
        accessToken: 'token-1',
        domain: 'www.workbuddy.cn',
        expiresAt: Date.now() + 3600 * 1000,
      },
    }),
    'utf8',
  );

  const originalAuthFile = process.env.WORKBUDDY_DESKTOP_AUTH_FILE;
  const originalFetch = globalThis.fetch;
  process.env.WORKBUDDY_DESKTOP_AUTH_FILE = authFile;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ code: 0, data: { Packages: [{ CycleRemainCapacity: '1234.5' }] } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch;

  try {
    const quota = await providerQuotaService.getProviderQuota('workbuddy');

    // WorkBuddy has no rolling window, so the dispatch has to reach the panel
    // through the credit balance alone.
    assert.equal(quota?.provider, 'workbuddy');
    assert.equal(quota?.credits, '1234.50');
    assert.deepEqual(quota?.windows, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAuthFile === undefined) {
      delete process.env.WORKBUDDY_DESKTOP_AUTH_FILE;
    } else {
      process.env.WORKBUDDY_DESKTOP_AUTH_FILE = originalAuthFile;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});
