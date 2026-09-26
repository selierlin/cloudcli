import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The forced way out of a theme that loaded but left the interface unusable.
 *
 * What is pinned here is the whole of the channel's contract: which URLs ask for
 * it, what it must leave behind (no pick, no stylesheet, and a URL that does not
 * ask again), and — the part that is easy to miss — that the cleared pick is not
 * undone by the preference hydrate that follows. The client has no session at
 * boot, so without that last piece the reset would last exactly until sign-in.
 */

const saved: Array<Record<string, unknown>> = [];
let serverPreferences: Record<string, unknown> = {};
/** Holds the next theme-file request open, so a test can decide when it lands. */
let fileResponse: Promise<Response> | null = null;

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      file: () => fileResponse ?? Promise.resolve(new Response(':root{--late:1}', { status: 200 })),
    },
    user: {
      preferences: async () => new Response(
        JSON.stringify({ preferences: serverPreferences }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
      savePreferences: async (updates: Record<string, unknown>) => {
        saved.push(updates);
        return new Response('{}', { status: 200 });
      },
    },
  },
}));

const loadStores = async () => {
  vi.resetModules();
  const reset = await import('@/shared/themeReset');
  const settings = await import('@/shared/userSettings');
  return { reset, settings };
};

const injectedElement = (): Element | null => document.querySelector('style[data-cloudcli-user-theme]');

const seedInjectedTheme = (): void => {
  const element = document.createElement('style');
  element.setAttribute('data-cloudcli-user-theme', 'paste-1');
  element.textContent = '[data-theme="paste-1"] { --background: 0 0% 100%; }';
  document.head.appendChild(element);
};

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  serverPreferences = {};
  fileResponse = null;
  document.querySelectorAll('style[data-cloudcli-user-theme]').forEach((element) => element.remove());
  window.history.replaceState(null, '', '/');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('only the exact reset value asks for a reset', async () => {
  const { reset } = await loadStores();

  assert.equal(reset.isThemeResetRequested(''), false);
  assert.equal(reset.isThemeResetRequested('?theme=dark'), false);
  assert.equal(reset.isThemeResetRequested('?theme='), false);
  assert.equal(reset.isThemeResetRequested('?theme=default'), true);
  assert.equal(reset.isThemeResetRequested('?foo=1&theme=default'), true);
  assert.equal(reset.isThemeResetRequested('?theme=Default'), false);
});

test('the reset drops the pick and the stylesheet, and removes the parameter', async () => {
  const { reset, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'paste-1');
  seedInjectedTheme();
  window.history.replaceState(null, '', '/settings?theme=default&tab=appearance');

  assert.equal(reset.applyThemeResetRequest(), true);

  assert.equal(
    settings.readUserPreference('themeId', 'unset'),
    'unset',
    'the pick is what has to go — the theme itself stays in the list',
  );
  assert.equal(injectedElement(), null, 'the stylesheet would otherwise keep painting the theme that was escaped');
  assert.equal(
    window.location.search,
    '?tab=appearance',
    'leaving the parameter in place would reset on every reload, so no other theme could be kept',
  );
});

test('a URL without the parameter changes nothing', async () => {
  const { reset, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'paste-1');
  seedInjectedTheme();
  window.history.replaceState(null, '', '/settings?tab=appearance');

  assert.equal(reset.applyThemeResetRequest(), false);

  assert.equal(settings.readUserPreference<string | null>('themeId', null), 'paste-1');
  assert.ok(injectedElement(), 'the working theme must not be disturbed by an unrelated URL');
});

test('a theme whose file is still in flight cannot land after the reset', async () => {
  const { reset } = await loadStores();
  const styles = await import('@/shared/userThemeStyles');
  window.history.replaceState(null, '', '/?theme=default');

  let settleFile!: (response: Response) => void;
  fileResponse = new Promise<Response>((resolve) => {
    settleFile = resolve;
  });

  const pending = styles.applyUserThemeStyle({
    kind: 'file',
    entry: { id: 'user-borealis', name: 'Borealis', fileName: 'borealis.css', format: 'css', modifiedAt: 42 },
  }, true);

  reset.applyThemeResetRequest();
  settleFile(new Response(':root{--late:1}', { status: 200 }));
  await pending;

  assert.equal(
    document.querySelector('style[data-cloudcli-user-theme]'),
    null,
    'the response is the theme the user just escaped, so it has to be dropped rather than injected',
  );
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null, warnings: [] });
});

test('the cleared pick is not undone by the hydrate that follows it', async () => {
  const { reset, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'paste-1');
  await vi.advanceTimersByTimeAsync(500);
  saved.length = 0;

  // The server still holds the pick the user is escaping — the reset ran before
  // this client had a session, so it could not have told it otherwise.
  serverPreferences = { themeId: 'paste-1' };
  window.history.replaceState(null, '', '/?theme=default');
  reset.applyThemeResetRequest();

  await settings.hydrateUserPreferences();

  const mirror = JSON.parse(localStorage.getItem('user-preferences') ?? '{}') as Record<string, unknown>;
  assert.equal(mirror.themeId, null, 'the hydrate must not put the unusable pick back');
  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ themeId: null }], 'and the server has to end up agreeing, or the next load returns it');
});
