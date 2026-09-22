import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { readWorkbuddyCredits } from '@/modules/providers/list/workbuddy/workbuddy-credits.client.js';

const ORIGINAL_AUTH_FILE = process.env.WORKBUDDY_DESKTOP_AUTH_FILE;
const ORIGINAL_FETCH = globalThis.fetch;
const FUTURE_EXPIRY = Date.now() + 24 * 3600 * 1000;

/** One successful console summary: three packages, two of them partially spent. */
const SUMMARY_PAYLOAD = {
  code: 0,
  msg: 'OK',
  data: {
    Packages: [
      { PackageCode: 'free', CycleTotalCapacity: '4612', CycleRemainCapacity: '208', CapacityUnit: 'credits' },
      { PackageCode: 'paid', CycleTotalCapacity: '4000', CycleRemainCapacity: '491.9300019', CapacityUnit: 'credits' },
      { PackageCode: 'grant', CycleTotalCapacity: '5000', CycleRemainCapacity: '5000', CapacityUnit: 'credits' },
    ],
    IsPaidUser: true,
  },
};

type FetchCall = { url: string; init: RequestInit };

let tempDirs: string[] = [];

/**
 * Writes a desktop auth file and points the reader at it.
 *
 * The reader deliberately reads the real desktop file in production, so every
 * case here redirects it at a fixture instead of touching the user's sign-in.
 */
async function useAuthFile(payload: unknown): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-credits-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'workbuddy-desktop.info');
  await fs.writeFile(file, JSON.stringify(payload), 'utf8');
  process.env.WORKBUDDY_DESKTOP_AUTH_FILE = file;
}

/** Replaces fetch with a recorder so cases assert the request instead of making one. */
function stubFetch(respond: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function authPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    account: { uid: 'uid-1', nickname: '林凌七' },
    auth: {
      accessToken: 'token-1',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      domain: 'www.workbuddy.cn',
      expiresAt: FUTURE_EXPIRY,
      ...overrides,
    },
  };
}

beforeEach(() => {
  delete process.env.WORKBUDDY_DESKTOP_AUTH_FILE;
});

afterEach(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_AUTH_FILE === undefined) {
    delete process.env.WORKBUDDY_DESKTOP_AUTH_FILE;
  } else {
    process.env.WORKBUDDY_DESKTOP_AUTH_FILE = ORIGINAL_AUTH_FILE;
  }
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

test('sums remaining credits across packages and reports no rolling windows', async () => {
  await useAuthFile(authPayload());
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  const quota = await readWorkbuddyCredits();

  assert.equal(quota.provider, 'workbuddy');
  assert.deepEqual(quota.windows, []);
  assert.equal(quota.planType, null);
  // Float noise from the console is rounded away rather than shown raw.
  assert.equal(quota.credits, '5699.93');
  assert.equal(quota.creditsUsed, '7912.07');
  assert.equal(quota.creditsTotal, '13612.00');
  assert.equal(quota.isPaidAccount, true);
  assert.equal(typeof quota.fetchedAt, 'number');
  assert.equal(calls.length, 1);
});

/**
 * The panel shows the balance and the breakdown together, so a total summed
 * over a different set of packages than the balance would let the panel
 * contradict itself. Asserting the arithmetic here pins that invariant.
 */
test('reports a breakdown that reconciles with the reported balance', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  const quota = await readWorkbuddyCredits();

  const remaining = Number(quota.credits);
  const used = Number(quota.creditsUsed);
  const total = Number(quota.creditsTotal);
  assert.equal(Number((used + remaining).toFixed(2)), total);
});

test('a package without a capacity leaves the breakdown unreported', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({
    code: 0,
    data: {
      Packages: [
        { PackageCode: 'known', CycleTotalCapacity: '100', CycleRemainCapacity: '40' },
        // A partial package must not be counted toward the total while its
        // balance still counts toward the remaining figure.
        { PackageCode: 'partial', CycleRemainCapacity: '10' },
      ],
    },
  }));

  const quota = await readWorkbuddyCredits();

  assert.equal(quota.credits, '50.00');
  assert.equal(quota.creditsUsed, null);
  assert.equal(quota.creditsTotal, null);
});

test('a summary without the paid flag reports an unknown account tier', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({
    code: 0,
    data: { Packages: [{ PackageCode: 'free', CycleTotalCapacity: '100', CycleRemainCapacity: '40' }] },
  }));

  const quota = await readWorkbuddyCredits();

  assert.equal(quota.isPaidAccount, null);
});

test('a granted-only account is reported as not paid', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({
    code: 0,
    data: {
      Packages: [{ PackageCode: 'grant', CycleTotalCapacity: '100', CycleRemainCapacity: '40' }],
      IsPaidUser: false,
    },
  }));

  const quota = await readWorkbuddyCredits();

  assert.equal(quota.isPaidAccount, false);
});

test('sends the account token to the console host the token was issued for', async () => {
  await useAuthFile(authPayload());
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  await readWorkbuddyCredits();

  const [call] = calls;
  assert.equal(call.url, 'https://www.workbuddy.cn/billing/meter/get-user-resource-summary');
  assert.equal(call.init.method, 'POST');
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer token-1');
  // The billing gateway answers a client-fingerprint rejection to script-style
  // User-Agents, so the request must not look like a bare HTTP client.
  assert.match(headers['User-Agent'], /^Mozilla\/5\.0 /);
  // The desktop file owns refresh; this reader must never write it back.
  assert.equal(headers['X-Refresh-Token'], undefined);
});

test('routes a codebuddy.cn account to the codebuddy console', async () => {
  await useAuthFile(authPayload({ domain: 'www.codebuddy.cn' }));
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  await readWorkbuddyCredits();

  assert.equal(calls[0].url, 'https://www.codebuddy.cn/billing/meter/get-user-resource-summary');
});

test('routes an unrecognized domain to the codebuddy console instead of the account-supplied host', async () => {
  await useAuthFile(authPayload({ domain: 'attacker.example' }));
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  await readWorkbuddyCredits();

  assert.equal(calls[0].url, 'https://www.codebuddy.cn/billing/meter/get-user-resource-summary');
});

test('a balance of zero is reported rather than hidden', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({
    code: 0,
    data: { Packages: [{ PackageCode: 'spent', CycleRemainCapacity: '0' }] },
  }));

  const quota = await readWorkbuddyCredits();

  // "No credits left" is exactly what the panel is for; only a missing package
  // list is treated as nothing to show.
  assert.equal(quota.credits, '0.00');
});

test('an expired desktop session fails without refreshing the desktop token', async () => {
  await useAuthFile(authPayload({ expiresAt: Date.now() - 1000 }));
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  await assert.rejects(readWorkbuddyCredits(), (error: { code?: string }) => {
    assert.equal(error.code, 'WORKBUDDY_SESSION_EXPIRED');
    return true;
  });
  // Refreshing here would rotate the refresh token behind the desktop app's
  // back and could invalidate the user's WorkBuddy sign-in.
  assert.deepEqual(calls, []);
});

test('a missing auth file fails instead of answering an unauthenticated read', async () => {
  process.env.WORKBUDDY_DESKTOP_AUTH_FILE = path.join(os.tmpdir(), 'wb-credits-absent', 'missing.info');
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  await assert.rejects(readWorkbuddyCredits(), (error: { code?: string }) => {
    assert.equal(error.code, 'WORKBUDDY_AUTH_FILE_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(calls, []);
});

test('an auth file without an access token is treated as unavailable', async () => {
  await useAuthFile({ auth: { domain: 'www.workbuddy.cn', accessToken: '' } });
  const calls = stubFetch(() => jsonResponse(SUMMARY_PAYLOAD));

  await assert.rejects(readWorkbuddyCredits(), (error: { code?: string }) => {
    assert.equal(error.code, 'WORKBUDDY_AUTH_FILE_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(calls, []);
});

test('a summary without packages is not read as an empty balance', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({ code: 0, data: { Packages: [] } }));

  await assert.rejects(readWorkbuddyCredits(), (error: { code?: string }) => {
    assert.equal(error.code, 'WORKBUDDY_CREDIT_SUMMARY_EMPTY');
    return true;
  });
});

test('a fingerprint rejection is surfaced as an HTTP failure', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({ code: 10085, msg: '请求不合法，如有疑问请联系客服' }, 403));

  await assert.rejects(readWorkbuddyCredits(), (error: { code?: string; statusCode?: number }) => {
    assert.equal(error.code, 'WORKBUDDY_CREDIT_SUMMARY_FAILED');
    assert.equal(error.statusCode, 403);
    return true;
  });
});

test('a non-zero console code fails rather than reporting a balance', async () => {
  await useAuthFile(authPayload());
  stubFetch(() => jsonResponse({ code: 500, msg: 'internal error', data: { Packages: [] } }));

  await assert.rejects(readWorkbuddyCredits(), (error: { code?: string }) => {
    assert.equal(error.code, 'WORKBUDDY_CREDIT_SUMMARY_EMPTY');
    return true;
  });
});
