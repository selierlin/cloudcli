import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach } from 'node:test';

import {
  WorkbuddyProviderAuth,
  resetWorkbuddyCommandForTests,
} from '@/modules/providers/list/workbuddy/workbuddy-auth.provider.js';

const MOCK_CLI = path.resolve(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wb-mock-cli.mjs'),
);
const MISSING_CLI = path.join('/nonexistent', 'codebuddy-missing');
const ORIGINAL_PATH = process.env.PATH;

// Resolution and version-probe results are cached, so every test starts from
// a clean slate; the env overrides are removed so tests control exactly which
// detection branch (override / PATH / embedded) is exercised.
beforeEach(() => {
  resetWorkbuddyCommandForTests();
  delete process.env.CODEBUDDY_COMMAND;
  delete process.env.WORKBUDDY_EMBEDDED_CLI;
});

afterEach(() => {
  resetWorkbuddyCommandForTests();
  delete process.env.CODEBUDDY_COMMAND;
  delete process.env.WORKBUDDY_EMBEDDED_CLI;
  if (ORIGINAL_PATH === undefined) delete process.env.PATH;
  else process.env.PATH = ORIGINAL_PATH;
});

test('getStatus reports an installed but desktop-managed WorkBuddy engine', async () => {
  process.env.CODEBUDDY_COMMAND = MOCK_CLI;

  const status = await new WorkbuddyProviderAuth().getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.authVerified, false);
  assert.equal(status.method, 'workbuddy_desktop');
  assert.equal(status.error, undefined);
});

test('getStatus reports installed but unauthenticated when the command cannot run', async () => {
  process.env.CODEBUDDY_COMMAND = MISSING_CLI;

  const status = await new WorkbuddyProviderAuth().getStatus();

  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.equal(status.method, null);
  assert.equal(status.error, 'codebuddy CLI is present but failed to run');
});

test('getStatus reports not installed when neither PATH nor the embedded engine exists', async () => {
  // Empty PATH root plus a bogus embedded path: nothing to detect, so the
  // status must not fabricate a bare `codebuddy` fallback and claim installed.
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-auth-empty-'));
  try {
    process.env.PATH = `${emptyDir}:/usr/bin:/bin`;
    process.env.WORKBUDDY_EMBEDDED_CLI = MISSING_CLI;

    const status = await new WorkbuddyProviderAuth().getStatus();

    assert.equal(status.installed, false);
    assert.equal(status.authenticated, false);
    assert.equal(status.method, null);
    assert.ok(status.error?.includes('not found'), `error: ${status.error}`);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('getStatus detects a codebuddy executable on PATH', async () => {
  // The WorkBuddy engine is exposed as a `codebuddy` command (e.g. mapped by
  // the desktop app), so a PATH hit must count as installed.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-auth-bin-'));
  try {
    fs.writeFileSync(path.join(binDir, 'codebuddy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${binDir}:/usr/bin:/bin`;

    const status = await new WorkbuddyProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
    assert.equal(status.authVerified, false);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test('getStatus detects the CLI embedded in WorkBuddy.app', async () => {
  // With no override and no PATH hit, the embedded engine path decides.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-auth-embedded-'));
  try {
    const embeddedEngine = path.join(tempDir, 'codebuddy');
    // A shell script avoids the node-bin PATH dependency of the mock CLI's
    // `env node` shebang, since the probe PATH deliberately excludes it.
    fs.writeFileSync(embeddedEngine, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${tempDir}:/usr/bin:/bin`;
    process.env.WORKBUDDY_EMBEDDED_CLI = embeddedEngine;

    const status = await new WorkbuddyProviderAuth().getStatus();

    assert.equal(status.installed, true);
    assert.equal(status.authenticated, false);
    assert.equal(status.authVerified, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
