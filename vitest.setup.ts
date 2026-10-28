import { cleanup } from '@testing-library/react';
import { transferableAbortController } from 'node:util';
import { afterEach } from 'vitest';

// jsdom publishes its own `AbortController`/`AbortSignal`, which live in the
// test realm rather than Node's. Code that bridges the two — React Router's
// `navigate()` hands a signal to the `Request` constructor, and undici only
// accepts its own `AbortSignal` — then fails with `Expected signal (...) to be
// an instance of AbortSignal`. Taking the classes off a controller that Node
// itself built keeps both sides in one realm; browser behaviour is unchanged,
// since a browser has only one realm to begin with.
const nodeAbort = transferableAbortController();
for (const name of ['AbortController', 'AbortSignal'] as const) {
  const implementation = name === 'AbortController' ? nodeAbort.constructor : nodeAbort.signal.constructor;
  Object.defineProperty(globalThis, name, {
    value: implementation,
    configurable: true,
    writable: true,
  });
}

// The suite asserts English copy. The app follows the saved language and falls
// back to zh-CN, so a clean profile would silently translate every assertion
// target. Seed the preference mirror before any module reads it.
localStorage.setItem('user-preferences', JSON.stringify({ userLanguage: 'en' }));

// Auto-cleanup only self-registers when vitest globals are enabled, and they are
// not. Without this, a hook rendered in one test stays mounted — with its timers
// and effects live — for the rest of the file.
afterEach(cleanup);

// jsdom ships no `matchMedia`, and components that pick a layout from the
// viewport call it during render. Report the desktop breakpoint, which is the
// layout the sidebar row tests assert on.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
