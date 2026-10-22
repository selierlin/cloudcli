import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { isImeKeyEvent } from '@/shared/utils';

/**
 * The guard every Escape handler consults.
 *
 * Three sources have to be covered because they fail on different platforms:
 * `isComposing` (Chrome/Firefox), `keyCode` 229 (some Windows IMEs), and the
 * short window after `compositionend` (Safari dispatches the end first, so the
 * flag is already false when the keydown arrives).
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const escapeKey = (overrides: { isComposing?: boolean; keyCode?: number } = {}) => ({
  keyCode: 27,
  ...overrides,
});

test('a plain Escape belongs to the app', () => {
  vi.advanceTimersByTime(1000);
  assert.equal(isImeKeyEvent(escapeKey()), false);
});

test('Escape pressed during a composition belongs to the IME', () => {
  assert.equal(isImeKeyEvent(escapeKey({ isComposing: true })), true);
});

test('keyCode 229 marks the press as the IME’s even without isComposing', () => {
  assert.equal(isImeKeyEvent(escapeKey({ keyCode: 229 })), true);
});

test('a React synthetic event is judged by its native event', () => {
  const native = escapeKey({ isComposing: true });
  // React's synthetic wrapper carries its own `isComposing` that can lag behind
  // the native one; the native value is the one the browser actually set.
  assert.equal(isImeKeyEvent({ isComposing: false, keyCode: 27, nativeEvent: native }), true);
});

test('a key arriving just after compositionend still belongs to the IME', () => {
  vi.advanceTimersByTime(1000);
  window.dispatchEvent(new CompositionEvent('compositionend'));
  assert.equal(isImeKeyEvent(escapeKey()), true);

  // Safari's ordering only spans the synchronous gap between the two events; a
  // person pressing Escape again is far slower than the window.
  vi.advanceTimersByTime(31);
  assert.equal(isImeKeyEvent(escapeKey()), false);
});
