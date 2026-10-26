import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createPublicSharesRouter, createSharesRouter } from '../shares.routes.js';
import { createSharesService } from '../shares.service.js';

const HTML = '<!DOCTYPE html><html><head><title>Shared</title></head><body><p>shared-marker</p></body></html>';

type StoredRow = {
  shareId: string;
  tokenHash: string;
  token: string;
  sessionId: string | null;
  title: string;
  fileName: string;
  byteSize: number;
  messageCount: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

type SharesStore = Parameters<typeof createSharesService>[0]['store'];

async function startServer() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-shares-routes-'));
  const rows = new Map<string, StoredRow>();
  const store: SharesStore = {
    insert(input) {
      rows.set(input.shareId, { ...input, createdAt: new Date().toISOString(), revokedAt: null });
    },
    findByTokenHash(tokenHash) {
      return [...rows.values()].find((row) => row.tokenHash === tokenHash) ?? null;
    },
    list() {
      return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    revoke(shareId) {
      const row = rows.get(shareId);
      if (!row || row.revokedAt) return null;
      row.revokedAt = new Date().toISOString();
      return row;
    },
    remove(shareId) {
      rows.delete(shareId);
    },
  };
  const service = createSharesService({ store, directory });
  const app = express();
  app.use(express.json());
  app.use('/api/shares', createSharesRouter(service));
  app.use('/s', createPublicSharesRouter(service));
  // Mirrors the entrypoint's AppError handler; without it a rejected create
  // would surface as Express's default 500 page.
  app.use((error: Error & { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ success: false, error: { code: error.code, message: error.message } });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test('a created share is readable without any credential', async () => {
  const { base, close } = await startServer();
  try {
    const created = await fetch(`${base}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: HTML, title: 'A conversation', sessionId: 's-1', messageCount: 2 }),
    });
    assert.equal(created.status, 201);
    const payload = await created.json() as { share: { urlPath: string; token: string } };
    assert.equal(payload.share.urlPath, `/s/${payload.share.token}`);

    const page = await fetch(`${base}${payload.share.urlPath}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.match(await page.text(), /shared-marker/);
  } finally {
    close();
  }
});

test('an unknown token answers 404 and a revoked one answers 410', async () => {
  const { base, close } = await startServer();
  try {
    const unknown = await fetch(`${base}/s/${'a'.repeat(43)}`);
    assert.equal(unknown.status, 404);

    const created = await fetch(`${base}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: HTML, title: 'T' }),
    });
    const { share } = await created.json() as { share: { shareId: string; token: string } };

    const revoked = await fetch(`${base}/api/shares/${share.shareId}`, { method: 'DELETE' });
    assert.equal(revoked.status, 204);

    const gone = await fetch(`${base}/s/${share.token}`);
    assert.equal(gone.status, 410);
    assert.match(await gone.text(), /链接已失效/);

    assert.equal((await fetch(`${base}/api/shares/${share.shareId}`, { method: 'DELETE' })).status, 404);
  } finally {
    close();
  }
});

test('the create route rejects a body that is not an export document', async () => {
  const { base, close } = await startServer();
  try {
    const response = await fetch(`${base}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<p>plain fragment</p>', title: 'T' }),
    });
    assert.equal(response.status, 400);
    const payload = await response.json() as { error: { code: string } };
    assert.equal(payload.error.code, 'INVALID_TRANSCRIPT');
  } finally {
    close();
  }
});

test('the public page forbids scripts, so an uploaded document cannot run one', async () => {
  const { base, close } = await startServer();
  try {
    // The document is stored verbatim, so the protocol-level policy is the only
    // thing standing between an uploaded snapshot and the reader's token: a
    // script served from the app's own origin could read localStorage.
    const created = await fetch(`${base}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: '<!DOCTYPE html><html><body><script>alert(1)</script><img src=x onerror=alert(2)></body></html>',
        title: 'Hostile',
      }),
    });
    const { share } = await created.json() as { share: { urlPath: string } };

    const page = await fetch(`${base}${share.urlPath}`);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy') ?? '';
    // No `script-src` at all: it falls back to `default-src 'none'`.
    assert.equal(csp.includes('script-src'), false);
    assert.match(csp, /default-src 'none'/);
  } finally {
    close();
  }
});

test('GET /api/shares returns the list the settings screen manages', async () => {
  const { base, close } = await startServer();
  try {
    const create = async (title: string) => {
      const response = await fetch(`${base}/api/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: HTML, title, sessionId: 's-1', messageCount: 2 }),
      });
      return (await response.json()) as { share: { shareId: string; urlPath: string } };
    };

    const first = await create('First');
    const second = await create('Second');

    const listed = await fetch(`${base}/api/shares`);
    assert.equal(listed.status, 200);
    const payload = (await listed.json()) as {
      shares: Array<{ shareId: string; urlPath: string | null; status: string }>;
    };
    const byId = new Map(payload.shares.map((share) => [share.shareId, share]));
    assert.equal(byId.get(first.share.shareId)?.urlPath, first.share.urlPath);
    assert.equal(byId.get(second.share.shareId)?.status, 'active');

    await fetch(`${base}/api/shares/${second.share.shareId}`, { method: 'DELETE' });
    const afterRevoke = (await (await fetch(`${base}/api/shares`)).json()) as {
      shares: Array<{ shareId: string; urlPath: string | null; status: string }>;
    };
    const revoked = afterRevoke.shares.find((share) => share.shareId === second.share.shareId);
    assert.equal(revoked?.status, 'revoked');
    assert.equal(revoked?.urlPath, null);
  } finally {
    close();
  }
});
