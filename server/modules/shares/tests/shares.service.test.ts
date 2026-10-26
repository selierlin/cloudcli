import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSharesService } from '../shares.service.js';

type StoredRow = Parameters<Parameters<typeof createSharesService>[0]['store']['insert']>[0];
type Row = StoredRow & { revokedAt: string | null; createdAt: string };

/** In-memory stand-in for the repository; keeps the service tests filesystem-only. */
function createStore() {
  const rows = new Map<string, Row>();
  return {
    rows,
    insert(input: StoredRow) {
      rows.set(input.shareId, { ...input, revokedAt: null, createdAt: new Date().toISOString() });
    },
    findByTokenHash(tokenHash: string) {
      return [...rows.values()].find((row) => row.tokenHash === tokenHash) ?? null;
    },
    list() {
      return [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    revoke(shareId: string) {
      const row = rows.get(shareId);
      if (!row || row.revokedAt) return null;
      row.revokedAt = new Date().toISOString();
      return row;
    },
    remove(shareId: string) {
      rows.delete(shareId);
    },
  };
}

async function createService() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-shares-'));
  const store = createStore();
  return { directory, store, service: createSharesService({ store, directory }) };
}

const HTML = '<!DOCTYPE html><html><body><p>hello</p></body></html>';

test('createShare writes the file and stores the link so it can be shown again', async () => {
  const { directory, store, service } = await createService();

  const created = await service.createShare({
    html: HTML,
    title: 'A conversation',
    sessionId: 'session-1',
    messageCount: 3,
  });

  assert.equal(created.urlPath, `/s/${created.token}`);
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await fs.readFile(path.join(directory, `${created.shareId}.html`), 'utf8'), HTML);

  const row = store.rows.get(created.shareId);
  assert.ok(row);
  assert.match(row.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(row.tokenHash, created.token);
  assert.equal(row.token, created.token);
  assert.equal(row.sessionId, 'session-1');
  assert.equal(row.messageCount, 3);

  const remaining = Date.parse(created.expiresAt) - Date.now();
  assert.ok(remaining > 6.9 * 24 * 60 * 60 * 1000 && remaining <= 7 * 24 * 60 * 60 * 1000);
});

test('resolveShare returns the file for a live token and distinguishes every miss', async () => {
  const { service } = await createService();
  const created = await service.createShare({ html: HTML, title: 'T' });

  assert.deepEqual(await service.resolveShare('not-a-token'), { status: 'missing' });

  const live = await service.resolveShare(created.token);
  assert.equal(live.status, 'ok');
  assert.ok(live.status === 'ok' && live.filePath.endsWith('.html'));
  assert.equal(live.status === 'ok' && live.title, 'T');

  await service.revokeShare(created.shareId);
  assert.deepEqual(await service.resolveShare(created.token), { status: 'revoked' });
});

test('revokeShare deletes the readable copy and is idempotent', async () => {
  const { directory, service } = await createService();
  const created = await service.createShare({ html: HTML, title: 'T' });

  assert.equal(await service.revokeShare(created.shareId), true);
  await assert.rejects(fs.access(path.join(directory, `${created.shareId}.html`)));
  assert.equal(await service.revokeShare(created.shareId), false);
  assert.equal(await service.revokeShare('never-existed'), false);
});

test('an expired share is dropped on access instead of being served', async () => {
  const { directory, store, service } = await createService();
  const created = await service.createShare({ html: HTML, title: 'T' });
  const row = store.rows.get(created.shareId);
  assert.ok(row);
  row.expiresAt = new Date(Date.now() - 1000).toISOString();

  assert.deepEqual(await service.resolveShare(created.token), { status: 'expired' });
  assert.equal(store.rows.has(created.shareId), false);
  await assert.rejects(fs.access(path.join(directory, `${created.shareId}.html`)));
});

test('a row whose file disappeared resolves as missing and is cleaned up', async () => {
  const { directory, store, service } = await createService();
  const created = await service.createShare({ html: HTML, title: 'T' });
  await fs.rm(path.join(directory, `${created.shareId}.html`));

  assert.deepEqual(await service.resolveShare(created.token), { status: 'missing' });
  assert.equal(store.rows.has(created.shareId), false);
});

test('createShare rejects a payload that is not the export document', async () => {
  const { service } = await createService();

  await assert.rejects(
    service.createShare({ html: '   ', title: 'T' }),
    (error: Error & { code?: string }) => error.code === 'EMPTY_TRANSCRIPT',
  );
  await assert.rejects(
    service.createShare({ html: '<div>not a document</div>', title: 'T' }),
    (error: Error & { code?: string }) => error.code === 'INVALID_TRANSCRIPT',
  );
});

test('listShares keeps the link readable until revoke, then stops handing it out', async () => {
  const { store, service } = await createService();
  const first = await service.createShare({ html: HTML, title: 'First' });
  const second = await service.createShare({ html: HTML, title: 'Second', messageCount: 4 });
  store.rows.get(first.shareId)!.createdAt = '2026-10-01T00:00:00.000Z';
  store.rows.get(second.shareId)!.createdAt = '2026-10-02T00:00:00.000Z';

  const listed = await service.listShares();
  assert.deepEqual(listed.map((share) => share.title), ['Second', 'First']);
  assert.equal(listed[0].urlPath, `/s/${second.token}`);
  assert.equal(listed[0].status, 'active');
  assert.equal(listed[0].messageCount, 4);

  await service.revokeShare(second.shareId);
  const afterRevoke = await service.listShares();
  assert.equal(afterRevoke[0].status, 'revoked');
  assert.equal(afterRevoke[0].urlPath, null);
  assert.ok(afterRevoke[0].revokedAt);
});

test('listShares sweeps expired rows and their files without waiting for a visit', async () => {
  const { directory, store, service } = await createService();
  const live = await service.createShare({ html: HTML, title: 'Live' });
  const dead = await service.createShare({ html: HTML, title: 'Dead' });
  store.rows.get(dead.shareId)!.expiresAt = new Date(Date.now() - 1000).toISOString();

  const listed = await service.listShares();
  assert.deepEqual(listed.map((share) => share.shareId), [live.shareId]);
  assert.equal(store.rows.has(dead.shareId), false);
  await assert.rejects(fs.access(path.join(directory, `${dead.shareId}.html`)));
});

// The boot hook calls this directly: a share that is neither opened nor listed
// would otherwise keep its HTML past the expiry the link page promised.
test('sweepExpired cleans up without a listing or a visit', async () => {
  const { directory, store, service } = await createService();
  const live = await service.createShare({ html: HTML, title: 'Live' });
  const dead = await service.createShare({ html: HTML, title: 'Dead' });
  store.rows.get(dead.shareId)!.expiresAt = new Date(Date.now() - 1000).toISOString();

  await service.sweepExpired();

  assert.equal(store.rows.has(dead.shareId), false);
  assert.equal(store.rows.has(live.shareId), true);
  await assert.rejects(fs.access(path.join(directory, `${dead.shareId}.html`)));
  await fs.access(path.join(directory, `${live.shareId}.html`));
});
