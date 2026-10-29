import assert from 'node:assert/strict';
import test from 'node:test';

import { browserUseService, resolveViewport } from '@/modules/browser-use/browser-use.service.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

test('resolveViewport keeps a requested phone viewport', () => {
  assert.deepEqual(resolveViewport(390, 844), { width: 390, height: 844 });
});

test('resolveViewport falls back when a dimension is missing or unusable', () => {
  for (const value of [undefined, null, 0, 0.4, Number.NaN, Number.POSITIVE_INFINITY, '390']) {
    assert.deepEqual(resolveViewport(value, value), { width: 1440, height: 900 });
  }
});

test('resolveViewport rounds and clamps to the supported range', () => {
  // Chromium accepts both 0 and 1e6 in newContext and only fails in
  // page.screenshot, which would strand the session after it is registered.
  assert.deepEqual(resolveViewport(390.6, 844.2), { width: 391, height: 844 });
  assert.deepEqual(resolveViewport(1e6, 1e6), { width: 3840, height: 2160 });
  assert.deepEqual(resolveViewport(1, 1), { width: 1, height: 1 });
  assert.deepEqual(resolveViewport(-10, -10), { width: 1440, height: 900 });
});
