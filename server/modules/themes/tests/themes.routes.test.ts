import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import themesRoutes from '@/modules/themes/themes.routes.js';

/**
 * The routes resolve `~/.cloudcli/themes` per request, so pointing HOME at a
 * scratch folder is enough to drive them without touching the real one — no
 * injection seam needed. Each test file runs in its own process, so the override
 * cannot leak into other suites.
 */
const scratchHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-themes-home-'));
process.env.HOME = scratchHome;
const themesDir = path.join(scratchHome, '.cloudcli', 'themes');
await fs.mkdir(themesDir, { recursive: true });
await fs.writeFile(
  path.join(themesDir, 'dracula.css'),
  '[data-theme="user-dracula"] { --primary: 1 2% 3%; }',
);
await fs.writeFile(path.join(themesDir, 'borealis.json'), '{"name":"Borealis"}');
await fs.writeFile(path.join(themesDir, 'notes.txt'), 'not a theme');
await fs.writeFile(path.join(themesDir, 'importer.css'), '@import url("https://x/y.css");');
await fs.writeFile(path.join(themesDir, 'huge.css'), `/* ${'x'.repeat(256 * 1024)} */`);

/** Runs `check` against the real router on an ephemeral port, then tears it down. */
async function withThemesApi(check: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api/themes', themesRoutes);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const { port } = server.address() as { port: number };
  try {
    await check(`http://127.0.0.1:${port}/api/themes`);
  } finally {
    server.close();
  }
}

test('GET / lists the usable theme files and skips the rejected ones', async () => {
  await withThemesApi(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);

    const body = (await response.json()) as { themes: Array<{ id: string; fileName: string }> };
    assert.deepEqual(
      body.themes.map((theme) => theme.id),
      ['user-borealis', 'user-dracula'],
    );
    // The wrong extension, the oversized file and the `@import` stylesheet are
    // absent; only the two usable themes are offered.
    assert.deepEqual(
      body.themes.map((theme) => theme.fileName),
      ['borealis.json', 'dracula.css'],
    );
  });
});

test('GET /:fileName serves a theme verbatim with its content type', async () => {
  await withThemesApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/dracula.css`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /--primary/);
  });
});

test('GET /:fileName maps rejected files to 400 and unknown ones to 404', async () => {
  await withThemesApi(async (baseUrl) => {
    // Rejected content (`@import`, over the size cap) and an escape attempt.
    for (const name of ['importer.css', 'huge.css', '..%2Fauth.db']) {
      const response = await fetch(`${baseUrl}/${name}`);
      assert.equal(response.status, 400, `${name} should be refused`);
    }

    const missing = await fetch(`${baseUrl}/absent.css`);
    assert.equal(missing.status, 404);
  });
});
