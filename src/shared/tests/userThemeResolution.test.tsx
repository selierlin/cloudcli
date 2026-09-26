import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * How the theme provider resolves a pick that names a file in the host's
 * themes folder.
 *
 * A user theme is the one overlay the bundle cannot answer for: whether its id
 * is real comes from a request, and so do its colours. So the provider has to
 * hold three things apart — a pick that is still being looked up, a pick the
 * listing ruled out, and a pick whose file could not be read — and only the
 * first of them is not yet a fallback. The tests below pin one per state, since
 * a fallback that shows up one request too early is exactly the flash the
 * boot-time cache exists to avoid.
 *
 * Each test loads a fresh module copy: the listing and the stylesheet are
 * module-level stores that only move forward within a session.
 */

const STYLE_CACHE_KEY = 'cloudcli.user-theme-style';

const entry = {
  id: 'user-borealis',
  name: 'Borealis',
  fileName: 'borealis.css',
  format: 'css' as const,
  modifiedAt: 42,
};

let listing: () => Promise<Response> = async () => new Response('{}', { status: 200 });
let file: () => Promise<Response> = async () => new Response(':root{--t:1}', { status: 200 });

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      list: () => listing(),
      file: () => file(),
    },
    user: { savePreferences: async () => new Response('{}', { status: 200 }) },
  },
}));

const listed = (themes: unknown[]): (() => Promise<Response>) =>
  async () => new Response(JSON.stringify({ themes }), { status: 200 });

/**
 * Loads a fresh copy of the app's theme modules around one hook, with the
 * stored preferences written before the provider reads them — the store is
 * read synchronously during render, so writing afterwards would be too late.
 */
async function loadTheme(
  preferences: Record<string, unknown> = {},
  { restoreCachedStyle = false }: { restoreCachedStyle?: boolean } = {},
) {
  vi.resetModules();
  const settings = await import('@/shared/userSettings');
  for (const [key, value] of Object.entries(preferences)) {
    settings.writeUserPreference(key as never, value);
  }

  const styles = await import('@/shared/userThemeStyles');
  if (restoreCachedStyle) {
    styles.applyBootUserThemeStyle();
  }

  const context = await import('@/shared/context/ThemeContext');
  const opened = renderHook(() => context.useTheme(), {
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(context.ThemeProvider, null, children),
  });

  return { ...opened, styles, settings };
}

/** Lets every pending response and the re-render it causes run to completion. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** The two metas `applyThemeChrome` publishes to, mirroring `index.html`. */
function ensureChromeMeta(name: string): void {
  if (!document.querySelector(`meta[name="${name}"]`)) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
}

const warned = (needle: string): boolean =>
  vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes(needle));

beforeEach(() => {
  localStorage.clear();
  // The listing sits behind the session token, and the store declines to ask
  // without one.
  localStorage.setItem('auth-token', 'header.payload.signature');
  document.querySelectorAll('style[data-cloudcli-user-theme]').forEach((element) => element.remove());
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
  ensureChromeMeta('theme-color');
  ensureChromeMeta('apple-mobile-web-app-status-bar-style');
  listing = listed([]);
  file = async () => new Response(':root{--t:1}', { status: 200 });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('a theme from the listing is applied once its stylesheet is in the document', async () => {
  listing = listed([entry]);
  const { result } = await loadTheme({ themeId: 'user-borealis' });
  await settle();

  assert.deepEqual(result.current.userThemes, [
    { id: 'user-borealis', name: 'Borealis', source: 'user', appearance: 'system' },
  ]);
  assert.equal(result.current.resolvedThemeId, 'user-borealis');
  assert.equal(document.documentElement.dataset.theme, 'user-borealis');
  assert.equal(result.current.themeFallback, null);
  assert.ok(
    document.querySelector('style[data-cloudcli-user-theme="user-borealis"]'),
    'the theme is only in force because its stylesheet is, so the element has to be there',
  );
});

test('a pick is not reported missing while the listing is still on its way', async () => {
  let answer = (): void => {};
  listing = () => new Promise<Response>((resolve) => {
    answer = () => resolve(new Response(JSON.stringify({ themes: [entry] }), { status: 200 }));
  });

  const { result } = await loadTheme({ themeId: 'user-borealis' });

  assert.equal(result.current.themeFallback, null, 'an answer that is coming is not an answer of "no"');
  assert.equal(result.current.resolvedThemeId, 'cc-light');
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.equal(warned('user-borealis'), false, 'nothing is announced before it is known');

  answer();
  await settle();

  assert.equal(result.current.themeFallback, null);
  assert.equal(result.current.resolvedThemeId, 'user-borealis');
});

test('a user theme the listing does not offer falls back and says so', async () => {
  listing = listed([entry]);
  const { result } = await loadTheme({ themeId: 'user-gone' });
  await settle();

  assert.deepEqual(result.current.themeFallback, { id: 'user-gone', reason: 'missing' });
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.equal(result.current.resolvedThemeId, 'cc-light');
  assert.ok(warned('user-gone'), 'the pick the user made has to stay findable');
  assert.equal(result.current.themeId, 'user-gone', 'the pick itself is still reported back');
});

test('a listed theme whose file cannot be read falls back as a load failure', async () => {
  listing = listed([entry]);
  file = async () => new Response('nope', { status: 404 });
  const { result } = await loadTheme({ themeId: 'user-borealis' });
  await settle();

  assert.deepEqual(result.current.themeFallback, { id: 'user-borealis', reason: 'loadFailed' });
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.equal(result.current.userThemes.length, 1, 'the theme is still offered: its file is what failed');
});

test('a listing that could not be read is a failure, not a theme that is missing', async () => {
  listing = async () => {
    throw new Error('offline');
  };
  const { result } = await loadTheme({ themeId: 'user-borealis' });
  await settle();

  assert.deepEqual(result.current.themeFallback, { id: 'user-borealis', reason: 'loadFailed' });
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
});

test('the cached stylesheet is in force on the first render, before the listing answers', async () => {
  localStorage.setItem(
    STYLE_CACHE_KEY,
    JSON.stringify({ id: 'user-borealis', modifiedAt: 42, css: ':root{--cached:1}' }),
  );
  let answer = (): void => {};
  listing = () => new Promise<Response>((resolve) => {
    answer = () => resolve(new Response(JSON.stringify({ themes: [entry] }), { status: 200 }));
  });

  const { result } = await loadTheme({ themeId: 'user-borealis' }, { restoreCachedStyle: true });

  assert.equal(
    result.current.resolvedThemeId,
    'user-borealis',
    'the first paint has to be the cached theme, not the default it would settle on later',
  );
  assert.equal(document.documentElement.dataset.theme, 'user-borealis');
  assert.equal(result.current.themeFallback, null);

  answer();
  await settle();
  assert.equal(result.current.resolvedThemeId, 'user-borealis');
});

/**
 * A pasted theme is the second source, and its whole difference from a file is
 * that nothing about it is a request: the content is already in the preference
 * mirror, so it resolves without the listing ever being consulted.
 */
const pasted = {
  id: 'paste-1',
  name: 'Deep sea',
  content: JSON.stringify({ name: 'Deep sea', tokens: { '--primary': '175 84% 32%' } }),
};

test('a pasted theme is applied from the preference mirror, without waiting for the listing', async () => {
  // The listing is deliberately left unanswered: a paste does not come from it,
  // and a pick that waited for a request it does not depend on would show the
  // default for as long as that request took.
  let answer = (): void => {};
  listing = () => new Promise<Response>((resolve) => {
    answer = () => resolve(new Response(JSON.stringify({ themes: [] }), { status: 200 }));
  });

  const { result } = await loadTheme({ themeId: 'paste-1', userThemePastes: [pasted] });

  // Before its stylesheet is in the document the theme is not yet in force, and
  // that must not read as "missing": a hint the next frame retracts is worse than
  // the wait, which is exactly why a paste resolves from the mirror rather than
  // from an answer that has not arrived.
  assert.equal(result.current.themeFallback, null);

  await settle();

  assert.deepEqual(result.current.userThemes, [
    { id: 'paste-1', name: 'Deep sea', source: 'user-paste', appearance: 'system' },
  ]);
  assert.equal(result.current.resolvedThemeId, 'paste-1');
  assert.equal(document.documentElement.dataset.theme, 'paste-1');
  assert.equal(result.current.themeFallback, null);
  assert.ok(
    document.querySelector('style[data-cloudcli-user-theme="paste-1"]'),
    'the paste is in force only because its stylesheet is in the document',
  );

  answer();
  await settle();
  assert.equal(result.current.resolvedThemeId, 'paste-1');
});

test('a pick naming a pasted theme that is gone is reported missing', async () => {
  const { result } = await loadTheme({ themeId: 'paste-9' });
  await settle();

  assert.deepEqual(result.current.themeFallback, { id: 'paste-9', reason: 'missing' });
  assert.equal(result.current.resolvedThemeId, 'cc-light');
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.ok(warned('paste-9'), 'the pick the user made has to stay findable');
});

test('a pasted theme that cannot compile is a load failure, not a missing theme', async () => {
  // Stored content is compiled when it is pasted, so this should not happen — but
  // the two reasons read differently to a user, and reporting the wrong one sends
  // them looking for a file that never existed.
  const { result } = await loadTheme({
    themeId: 'paste-1',
    userThemePastes: [{ id: 'paste-1', name: 'Broken', content: 'not json' }],
  });
  await settle();

  assert.deepEqual(result.current.themeFallback, { id: 'paste-1', reason: 'loadFailed' });
  assert.equal(result.current.resolvedThemeId, 'cc-light');
});
