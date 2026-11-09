import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  getWorkbuddyAccountCredits,
  getWorkbuddySwitchProgress,
  getWorkbuddySwitchStatus,
  switchWorkbuddyAccount,
} from '@/modules/workbuddy-switch/workbuddy-switch.service.js';

/**
 * Minimal stand-in for the workbuddy-switch companion: it answers the three
 * endpoints CloudCLI calls, records every request, and lets each test decide
 * the payload. Tests never touch the real companion — it would switch the
 * developer's own WorkBuddy account and restart their desktop app.
 */
type CompanionRequest = { method: string; path: string; body: string };

type Companion = {
  url: string;
  requests: CompanionRequest[];
  close: () => Promise<void>;
};

type RouteResult = { status?: number; contentType?: string; body: unknown };

const CN_ACCOUNT = {
  id: 'acc-cn-1',
  uid: 'uid-cn-1',
  nickname: 'Selier',
  phoneNumber: '153****6231',
  email: null,
  expiresAt: 1_795_588_832_767,
  needsRelogin: false,
  isEnterprise: false,
  variant: 'cn',
};

const AI_ACCOUNT = {
  id: 'acc-ai-1',
  uid: 'uid-ai-1',
  nickname: 'lxl6231@gmail.com',
  phoneNumber: null,
  email: 'lxl6231@gmail.com',
  expiresAt: 1_822_534_686_624,
  needsRelogin: false,
  isEnterprise: false,
  variant: 'ai',
};

/** Starts a companion double whose answers come from the supplied route table. */
async function startCompanion(
  routes: Record<string, (request: CompanionRequest) => RouteResult>,
): Promise<Companion> {
  const requests: CompanionRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: CompanionRequest = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);

      const handler = routes[`${request.method} ${request.path.split('?')[0]}`];
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
        return;
      }

      const result = handler(request);
      res.writeHead(result.status ?? 200, {
        'Content-Type': result.contentType ?? 'application/json',
      });
      res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Runs one test against a companion double and restores the env override afterwards. */
async function withCompanion(
  routes: Record<string, (request: CompanionRequest) => RouteResult>,
  run: (companion: Companion) => Promise<void>,
): Promise<void> {
  const companion = await startCompanion(routes);
  const previousUrl = process.env.WORKBUDDY_SWITCH_URL;
  process.env.WORKBUDDY_SWITCH_URL = companion.url;
  try {
    await run(companion);
  } finally {
    process.env.WORKBUDDY_SWITCH_URL = previousUrl;
    await companion.close();
  }
}

/** The two reads a status query performs, answered with the given payloads. */
function statusRoutes({
  running = false,
  current = 'uid-cn-1' as string | null,
  accounts = [CN_ACCOUNT, AI_ACCOUNT] as unknown[],
} = {}) {
  return {
    'GET /api/status': (): RouteResult => ({
      body: {
        running,
        current: { uid: current, nickname: 'Selier', email: null },
        version: '0.1.62',
        variant: 'cn',
      },
    }),
    'GET /api/accounts': (): RouteResult => ({
      body: { accounts, current, variant: 'cn' },
    }),
  };
}

test('status merges the companion reads and drops accounts CloudCLI cannot use', async () => {
  await withCompanion(statusRoutes(), async () => {
    const status = await getWorkbuddySwitchStatus();

    assert.equal(status.available, true);
    assert.equal(status.version, '0.1.62');
    assert.equal(status.running, false);
    assert.equal(status.currentUid, 'uid-cn-1');
    assert.deepEqual(
      status.accounts.map((account) => account.id),
      ['acc-cn-1'],
      'the ai-variant account must not be offered',
    );
    assert.equal(status.accounts[0]?.phoneNumber, '153****6231');
  });
});

test('status reports an unavailable companion instead of throwing', async () => {
  const previousUrl = process.env.WORKBUDDY_SWITCH_URL;
  process.env.WORKBUDDY_SWITCH_URL = 'http://127.0.0.1:1';
  try {
    const status = await getWorkbuddySwitchStatus();
    assert.deepEqual(status, {
      available: false,
      version: null,
      running: false,
      currentUid: null,
      accounts: [],
    });
  } finally {
    process.env.WORKBUDDY_SWITCH_URL = previousUrl;
  }
});

test('status treats the SPA fallback HTML as unavailable', async () => {
  await withCompanion(
    {
      'GET /api/status': () => ({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html></html>',
      }),
      'GET /api/accounts': () => ({ body: { accounts: [] } }),
    },
    async () => {
      assert.equal((await getWorkbuddySwitchStatus()).available, false);
    },
  );
});

test('switch restarts the desktop app only when it is running', async () => {
  await withCompanion(
    {
      ...statusRoutes({ running: true, current: 'uid-other' }),
      'POST /api/switch': (): RouteResult => ({ body: { ok: true, account: '七娃', variant: 'cn' } }),
    },
    async (companion) => {
      const outcome = await switchWorkbuddyAccount('acc-cn-1');

      assert.equal(outcome.account, '七娃');
      assert.equal(outcome.restarted, true);
      const switchRequest = companion.requests.find((request) => request.path === '/api/switch');
      assert.deepEqual(JSON.parse(switchRequest?.body ?? '{}'), {
        accountId: 'acc-cn-1',
        restart: true,
      });
    },
  );
});

test('switch leaves a stopped desktop app alone', async () => {
  await withCompanion(
    {
      ...statusRoutes({ running: false, current: 'uid-other' }),
      'POST /api/switch': (): RouteResult => ({ body: { ok: true, account: '七娃', variant: 'cn' } }),
    },
    async (companion) => {
      const outcome = await switchWorkbuddyAccount('acc-cn-1');

      assert.equal(outcome.restarted, false);
      const switchRequest = companion.requests.find((request) => request.path === '/api/switch');
      assert.equal(JSON.parse(switchRequest?.body ?? '{}').restart, false);
    },
  );
});

test('switch refuses an account the companion does not offer to CloudCLI', async () => {
  await withCompanion(statusRoutes(), async (companion) => {
    await assert.rejects(
      () => switchWorkbuddyAccount('acc-ai-1'),
      (error: Error & { code?: string; statusCode?: number }) => {
        assert.equal(error.code, 'WORKBUDDY_SWITCH_UNKNOWN_ACCOUNT');
        assert.equal(error.statusCode, 400);
        return true;
      },
    );
    assert.equal(
      companion.requests.some((request) => request.path === '/api/switch'),
      false,
      'no switch may reach the companion for a filtered account',
    );
  });
});

test('switch is a no-op when the account is already signed in', async () => {
  await withCompanion(statusRoutes({ running: true }), async (companion) => {
    const outcome = await switchWorkbuddyAccount('acc-cn-1');

    assert.equal(outcome.restarted, false);
    assert.equal(
      companion.requests.some((request) => request.path === '/api/switch'),
      false,
      'restarting for an unchanged account would quit the desktop app for nothing',
    );
  });
});

test('switch surfaces a concurrent switch as a conflict', async () => {
  await withCompanion(
    {
      ...statusRoutes({ running: true, current: 'uid-other' }),
      'POST /api/switch': (): RouteResult => ({
        status: 409,
        body: { ok: false, error: '已有切换任务进行中' },
      }),
    },
    async () => {
      await assert.rejects(
        () => switchWorkbuddyAccount('acc-cn-1'),
        (error: Error & { code?: string; statusCode?: number }) => {
          assert.equal(error.code, 'WORKBUDDY_SWITCH_BUSY');
          assert.equal(error.statusCode, 409);
          assert.match(error.message, /已有切换任务进行中/);
          return true;
        },
      );
    },
  );
});

test('switch fails loudly when the companion is unreachable', async () => {
  const previousUrl = process.env.WORKBUDDY_SWITCH_URL;
  process.env.WORKBUDDY_SWITCH_URL = 'http://127.0.0.1:1';
  try {
    await assert.rejects(
      () => switchWorkbuddyAccount('acc-cn-1'),
      (error: Error & { code?: string; statusCode?: number }) => {
        assert.equal(error.code, 'WORKBUDDY_SWITCH_UNAVAILABLE');
        assert.equal(error.statusCode, 503);
        return true;
      },
    );
  } finally {
    process.env.WORKBUDDY_SWITCH_URL = previousUrl;
  }
});

test('switch reports an unconfirmed outcome when the companion stops answering', async () => {
  // The reads succeed, so the companion is there; only the switch call comes
  // back as the SPA fallback instead of JSON. That must not reach the client as
  // a blanket 500, and it must not be reported as a refusal either: a lost
  // answer can hide a switch that did happen.
  await withCompanion(
    {
      ...statusRoutes({ running: true, current: 'uid-other' }),
      'POST /api/switch': (): RouteResult => ({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html></html>',
      }),
    },
    async () => {
      await assert.rejects(
        () => switchWorkbuddyAccount('acc-cn-1'),
        (error: Error & { code?: string; statusCode?: number }) => {
          assert.equal(error.code, 'WORKBUDDY_SWITCH_UNAVAILABLE');
          assert.equal(error.statusCode, 503);
          assert.match(error.message, /could not confirm/);
          return true;
        },
      );
    },
  );
});

test('progress degrades to idle when the companion is unreachable', async () => {
  const previousUrl = process.env.WORKBUDDY_SWITCH_URL;
  process.env.WORKBUDDY_SWITCH_URL = 'http://127.0.0.1:1';
  try {
    assert.deepEqual(await getWorkbuddySwitchProgress(), { running: false, progress: null });
  } finally {
    process.env.WORKBUDDY_SWITCH_URL = previousUrl;
  }
});

test('progress returns the companion wording while a switch runs', async () => {
  await withCompanion(
    {
      'GET /api/switch/progress': (): RouteResult => ({
        body: { running: true, progress: '正在关闭 WorkBuddy…' },
      }),
    },
    async () => {
      assert.deepEqual(await getWorkbuddySwitchProgress(), {
        running: true,
        progress: '正在关闭 WorkBuddy…',
      });
    },
  );
});

test('credits reports each usable account balance and reuses the read', async () => {
  await withCompanion(
    {
      ...statusRoutes(),
      'POST /api/credits': (request: CompanionRequest): RouteResult => ({
        body: {
          ok: true,
          accountId: JSON.parse(request.body).accountId,
          totalCapacity: 5317,
          totalRemaining: 2759.93,
        },
      }),
    },
    async (companion) => {
      const first = await getWorkbuddyAccountCredits();
      const second = await getWorkbuddyAccountCredits();

      assert.equal(first.available, true);
      assert.deepEqual(first.credits, [
        { accountId: 'acc-cn-1', remaining: 2759.93, total: 5317, error: null },
      ]);
      assert.deepEqual(second, first, 'the cached read must be reused');
      assert.equal(
        companion.requests.filter((request) => request.path === '/api/credits').length,
        1,
        'the ai-variant account is filtered, and the second call hits the cache',
      );
    },
  );
});

test('credits keeps the row when the companion refuses one balance', async () => {
  await withCompanion(
    {
      ...statusRoutes(),
      'POST /api/credits': (): RouteResult => ({
        body: { ok: false, accountId: 'acc-cn-1', error: '该账号凭据为加密信封态' },
      }),
    },
    async () => {
      const result = await getWorkbuddyAccountCredits();

      assert.equal(result.available, true);
      assert.deepEqual(result.credits, [
        { accountId: 'acc-cn-1', remaining: null, total: null, error: '该账号凭据为加密信封态' },
      ]);
    },
  );
});

test('credits skips an account that already needs a new sign-in', async () => {
  await withCompanion(
    {
      ...statusRoutes({ accounts: [{ ...CN_ACCOUNT, needsRelogin: true }, AI_ACCOUNT] }),
      'POST /api/credits': (): RouteResult => ({ body: { ok: true, totalRemaining: 1, totalCapacity: 1 } }),
    },
    async (companion) => {
      const result = await getWorkbuddyAccountCredits();

      assert.equal(result.credits[0]?.remaining, null);
      assert.match(result.credits[0]?.error ?? '', /sign-in/);
      assert.equal(
        companion.requests.some((request) => request.path === '/api/credits'),
        false,
        'an expired session must not trigger a billing call',
      );
    },
  );
});

test('credits degrades to unavailable when the companion is unreachable', async () => {
  const previousUrl = process.env.WORKBUDDY_SWITCH_URL;
  process.env.WORKBUDDY_SWITCH_URL = 'http://127.0.0.1:1';
  try {
    assert.deepEqual(await getWorkbuddyAccountCredits(), { available: false, credits: [] });
  } finally {
    process.env.WORKBUDDY_SWITCH_URL = previousUrl;
  }
});
