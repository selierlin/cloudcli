import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  mcpServersDb,
} from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/services/mcp.service.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const withTempHome = async (run: () => Promise<void>): Promise<void> => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-conn-'));
  const restoreHome = patchHomeDir(tempRoot);
  try {
    await run();
  } finally {
    restoreHome();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};

const withDatabase = async (run: () => Promise<void>): Promise<void> => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-conn-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await fs.writeFile(databasePath, '');
  await initializeDatabase();

  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
};

/** Swaps in a fake `fetch` for one test, recording every request it saw. */
const withStubbedFetch = async <T>(
  respond: () => Response,
  run: (calls: Array<{ url: string; headers: Record<string, string> }>) => Promise<T>,
): Promise<T> => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return respond();
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const jsonRpcSuccess = (): Response => new Response(
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { serverInfo: { name: 'probe-target' }, protocolVersion: '2024-11-05' },
  }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

test('test connection restores redacted headers from the saved provider server', { concurrency: false }, async () => {
  await withTempHome(async () => {
    await providerMcpService.upsertProviderMcpServer('claude', {
      name: 'remote',
      scope: 'user',
      transport: 'http',
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer real-secret' },
    });

    await withStubbedFetch(jsonRpcSuccess, async (calls) => {
      const result = await providerMcpService.testMcpConnectivity({
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: '<redacted>' },
        source: { kind: 'provider', provider: 'claude', name: 'remote', scope: 'user' },
      });

      assert.equal(result.ok, true);
      // The persisted secret went out, not the response-only marker.
      assert.equal(calls[0].headers.Authorization, 'Bearer real-secret');
    });
  });
});

test('test connection with no source sends the headers exactly as given', { concurrency: false }, async () => {
  await withTempHome(async () => {
    await withStubbedFetch(jsonRpcSuccess, async (calls) => {
      await providerMcpService.testMcpConnectivity({
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: '<redacted>' },
      });

      assert.equal(calls[0].headers.Authorization, '<redacted>');
    });
  });
});

test('test connection restores redacted headers from the catalog row', { concurrency: false }, async () => {
  await withDatabase(async () => {
    const entry = mcpServersDb.createCatalogEntry({
      name: 'catalog-remote',
      transport: 'http',
      config: {
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer catalog-secret' },
      },
    });

    await withStubbedFetch(jsonRpcSuccess, async (calls) => {
      const result = await providerMcpService.testMcpConnectivity({
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: '<redacted>' },
        source: { kind: 'catalog', id: entry.id },
      });

      assert.equal(result.ok, true);
      assert.equal(calls[0].headers.Authorization, 'Bearer catalog-secret');
    });
  });
});

test('test connection surfaces the failing status and response body', { concurrency: false }, async () => {
  await withStubbedFetch(
    () => new Response('Unauthorized: invalid token', { status: 401, statusText: 'Unauthorized' }),
    async () => {
      const result = await providerMcpService.testMcpConnectivity({
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
      });

      assert.equal(result.ok, false);
      assert.equal(result.status, 401);
      assert.match(result.error ?? '', /401/);
      assert.match(result.error ?? '', /invalid token/);
    },
  );
});

test('test connection caps a long error body instead of echoing it whole', { concurrency: false }, async () => {
  const longBody = 'x'.repeat(2000);

  await withStubbedFetch(
    () => new Response(longBody, { status: 400, statusText: 'Bad Request' }),
    async () => {
      const result = await providerMcpService.testMcpConnectivity({
        transport: 'http',
        url: 'https://mcp.example.test/mcp',
      });

      assert.equal(result.ok, false);
      assert.ok((result.error ?? '').length < 400);
      assert.match(result.error ?? '', /400/);
    },
  );
});
