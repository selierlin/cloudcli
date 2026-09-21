import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import {
  OmpProviderAuth,
  resetOmpCommandForTests,
} from '@/modules/providers/list/omp/omp-auth.provider.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'omp-probe-mock-cli.mjs'),
);
const MISSING_CLI = path.join('/nonexistent', 'omp-missing');

beforeEach(() => {
  resetOmpCommandForTests();
  delete process.env.OMP_COMMAND;
  delete process.env.MOCK_AUTH;
});

afterEach(() => {
  resetOmpCommandForTests();
  delete process.env.OMP_COMMAND;
  delete process.env.MOCK_AUTH;
});

test('getStatus reports authenticated when a default model route is configured', async () => {
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_AUTH = 'ready';

  const status = await new OmpProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.provider, 'omp');
  assert.equal(status.authenticated, true);
  // OMP exposes no credential-status query, so credentials stay unverified.
  assert.equal(status.authVerified, false);
  assert.equal(status.method, 'omp_config');
  assert.equal(status.error, undefined);
});

test('getStatus reports unauthenticated when no default model is configured', async () => {
  process.env.OMP_COMMAND = MOCK_CLI;
  process.env.MOCK_AUTH = 'unconfigured';

  const status = await new OmpProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.authVerified, false);
  assert.equal(status.method, null);
  assert.ok(status.error?.includes('no default model'), `error: ${status.error}`);
});

test('getStatus stays unknown when the config probe cannot be read', async () => {
  for (const mode of ['probe_error', 'garbage']) {
    resetOmpCommandForTests();
    process.env.OMP_COMMAND = MOCK_CLI;
    process.env.MOCK_AUTH = mode;

    const status = await new OmpProviderAuth().getStatus();
    assert.equal(status.installed, true, `mode: ${mode}`);
    assert.equal(status.authenticated, false, `mode: ${mode}`);
    assert.equal(status.method, null, `mode: ${mode}`);
    assert.ok(status.error?.includes('Could not read omp configuration'), `mode: ${mode} error: ${status.error}`);
  }
});

test('getStatus reports installed but unauthenticated when the command cannot run', async () => {
  process.env.OMP_COMMAND = MISSING_CLI;

  const status = await new OmpProviderAuth().getStatus();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
  assert.equal(status.error, 'omp CLI is present but failed to run');
});

test('getStatus reports not installed when neither OMP_COMMAND nor PATH resolves', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-auth-empty-'));
  try {
    const originalPath = process.env.PATH;
    process.env.PATH = `${emptyDir}:/usr/bin:/bin`;

    const status = await new OmpProviderAuth().getStatus();
    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.equal(status.method, null);
    assert.ok(status.error?.includes('not found'), `error: ${status.error}`);

    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
