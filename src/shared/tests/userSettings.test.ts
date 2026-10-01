import assert from 'node:assert/strict';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

/**
 * The store that replaced a dozen hand-rolled localStorage readers with one
 * server-backed copy. What matters here is the two behaviours the move must not
 * get wrong: an existing install's settings survive the migration, and a read
 * stays synchronous so the first paint is not a flash of defaults.
 *
 * Each test loads a fresh module copy because the store reads its localStorage
 * mirror once at module scope.
 */

type SavedPayload = Record<string, unknown>;

const saved: SavedPayload[] = [];
let serverPreferences: Record<string, unknown> = {};
let preferencesRequestFailed = false;

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: async () => {
        if (preferencesRequestFailed) {
          throw new Error('offline');
        }
        return new Response(JSON.stringify({ success: true, preferences: serverPreferences }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      savePreferences: async (updates: SavedPayload) => {
        saved.push(updates);
        return new Response('{}', { status: 200 });
      },
    },
  },
}));

const loadStore = async () => {
  vi.resetModules();
  return import('@/shared/userSettings');
};

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  serverPreferences = {};
  preferencesRequestFailed = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a write is readable synchronously and reaches the server after the debounce', async () => {
  const store = await loadStore();

  store.writeUserPreference('theme', 'dark');

  assert.equal(store.readUserPreference('theme', 'light'), 'dark');
  assert.deepEqual(saved, [], 'the request must not fire on every keystroke');

  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ theme: 'dark' }]);
});

test('a burst of writes collapses into one request carrying every change', async () => {
  const store = await loadStore();

  store.writeUserPreference('theme', 'dark');
  store.writeUserPreference('userLanguage', 'de');
  store.writeUserPreference('tasksEnabled', true);

  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ theme: 'dark', userLanguage: 'de', tasksEnabled: true }]);
});

test('writing the value a preference already has sends nothing and notifies nobody', async () => {
  const store = await loadStore();
  store.writeUserPreference('theme', 'dark');
  await vi.advanceTimersByTimeAsync(500);
  saved.length = 0;

  const listener = vi.fn();
  store.subscribeToUserPreferences(listener);
  store.writeUserPreference('theme', 'dark');

  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, []);
  expect(listener).not.toHaveBeenCalled();
});

test('a value written in one page load is readable synchronously in the next', async () => {
  const first = await loadStore();
  first.writeUserPreference('theme', 'dark');

  // No hydrate: this is the very first paint of the next load, before any
  // network request could have resolved.
  const second = await loadStore();
  assert.equal(second.readUserPreference('theme', 'light'), 'dark');
});

test('hydrate adopts the server copy over the local mirror', async () => {
  const store = await loadStore();
  store.writeUserPreference('theme', 'dark');
  await vi.advanceTimersByTimeAsync(500);

  serverPreferences = { theme: 'light' };
  await store.hydrateUserPreferences();

  assert.equal(store.readUserPreference('theme', 'light'), 'light');
  assert.equal(store.hasHydratedUserPreferences(), true);
});

test('hydrate seeds a preference the server has never seen from its legacy key', async () => {
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('tasks-enabled', 'true');
  localStorage.setItem('selected-provider', 'codex');
  localStorage.setItem('uiPreferences', JSON.stringify({ showThinking: false }));

  const store = await loadStore();
  await store.hydrateUserPreferences();

  assert.equal(store.readUserPreference('theme', 'light'), 'dark');
  assert.equal(store.readUserPreference('tasksEnabled', false), true);
  assert.equal(store.readUserPreference('selectedProvider', 'claude'), 'codex');
  assert.deepEqual(store.readUserPreference('uiPreferences', {}), { showThinking: false });

  await vi.advanceTimersByTimeAsync(500);
  assert.equal(saved.length, 1, 'the migrated values are pushed up in one request');
  assert.equal((saved[0] as Record<string, unknown>).theme, 'dark');
});

test('hydrate splits the legacy claude-settings blob into permissions and sort order', async () => {
  localStorage.setItem('claude-settings', JSON.stringify({
    allowedTools: ['Read'],
    disallowedTools: ['Bash'],
    skipPermissions: true,
    projectSortOrder: 'date',
    lastUpdated: '2026-01-01T00:00:00.000Z',
  }));

  const store = await loadStore();
  await store.hydrateUserPreferences();

  assert.deepEqual(store.readUserPreference('claudePermissions', null), {
    allowedTools: ['Read'],
    disallowedTools: ['Bash'],
    skipPermissions: true,
  });
  assert.equal(store.readUserPreference('projectSortOrder', 'name'), 'date');
});

test('hydrate reassembles the four separate code-editor keys into one preference', async () => {
  localStorage.setItem('codeEditorWordWrap', 'true');
  localStorage.setItem('codeEditorShowMinimap', 'false');
  localStorage.setItem('codeEditorFontSize', '16');

  const store = await loadStore();
  await store.hydrateUserPreferences();

  assert.deepEqual(store.readUserPreference('codeEditorSettings', null), {
    wordWrap: true,
    showMinimap: false,
    fontSize: '16',
  });
});

test('a legacy value is never allowed to overwrite what the server already holds', async () => {
  localStorage.setItem('theme', 'dark');
  serverPreferences = { theme: 'light' };

  const store = await loadStore();
  await store.hydrateUserPreferences();

  assert.equal(store.readUserPreference('theme', 'light'), 'light');
  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [], 'nothing was migrated, so nothing is pushed up');
});

test('a failed hydrate keeps the mirrored values instead of snapping back to defaults', async () => {
  const store = await loadStore();
  store.writeUserPreference('theme', 'dark');
  await vi.advanceTimersByTimeAsync(500);

  preferencesRequestFailed = true;
  await store.hydrateUserPreferences();

  assert.equal(store.readUserPreference('theme', 'light'), 'dark');
  assert.equal(store.hasHydratedUserPreferences(), false);
});

test('hydrate cancels a write queued before it, so a second device cannot clobber the server', async () => {
  // The failure this pins, observed end to end: on a device with an empty
  // mirror, ThemeProvider started on the system default and queued
  // `theme: light`; hydrate then delivered the stored `dark` and the component
  // stopped writing because the in-memory value already matched — so the stale
  // `light` flushed a moment later and reset the user's theme for every device.
  serverPreferences = { theme: 'dark' };
  const store = await loadStore();

  store.writeUserPreference('theme', 'light');
  await store.hydrateUserPreferences();
  await vi.advanceTimersByTimeAsync(500);

  assert.deepEqual(saved, [], 'the pre-hydrate write must not reach the server');
  assert.equal(store.readUserPreference('theme', null), 'dark');
});

test('hydrate leaves a queued write for a key the server has no answer for', async () => {
  serverPreferences = { theme: 'dark' };
  const store = await loadStore();

  store.writeUserPreference('userLanguage', 'de');
  await store.hydrateUserPreferences();
  await vi.advanceTimersByTimeAsync(500);

  assert.deepEqual(saved, [{ userLanguage: 'de' }]);
});

test('reset clears the copy so the next user does not inherit the previous one', async () => {
  const store = await loadStore();
  store.writeUserPreference('theme', 'dark');

  store.resetUserPreferences();

  assert.equal(store.readUserPreference('theme', 'light'), 'light');
  assert.equal(localStorage.getItem('user-preferences'), null);
});

test('a value pinned for the next hydrate outranks the server copy and is pushed up', async () => {
  // The case this exists for: a value written before the client has a session,
  // where the server cannot be told yet. Adopting the server's copy wholesale
  // would undo it, so the pin has to survive the hydrate — and reach the server,
  // or the next load would adopt the old value all over again.
  const store = await loadStore();
  store.writeUserPreference('themeId', 'paste-1');
  await vi.advanceTimersByTimeAsync(500);
  saved.length = 0;

  serverPreferences = { themeId: 'paste-1' };
  store.preferLocalValueOnHydrate('themeId', null);
  await store.hydrateUserPreferences();

  const mirror = JSON.parse(localStorage.getItem('user-preferences') ?? '{}') as Record<string, unknown>;
  assert.equal(mirror.themeId, null, 'the pin has to win over the copy the server just sent');

  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ themeId: null }], 'and it has to be sent, not merely held locally');
});

test('a pinned value does not leak past a sign-out', async () => {
  const store = await loadStore();
  serverPreferences = { themeId: 'paste-1' };
  store.preferLocalValueOnHydrate('themeId', null);

  store.resetUserPreferences();
  await store.hydrateUserPreferences();

  const mirror = JSON.parse(localStorage.getItem('user-preferences') ?? '{}') as Record<string, unknown>;
  assert.equal(mirror.themeId, 'paste-1', 'the next user did not ask for the previous one\'s reset');
});


test('hydrate migrates legacy fonts and provider model choices into user preferences', async () => {
  localStorage.setItem('fontSettings.uiFontSize', '18');
  localStorage.setItem('fontSettings.fontFamily', 'system');
  localStorage.setItem('fontSettings.terminalFontFamily', 'fira-code');
  localStorage.setItem('claude-model', 'sonnet');
  localStorage.setItem('claude-effort', 'high');
  localStorage.setItem('codex-model', 'gpt-5.4');

  const store = await loadStore();
  await store.hydrateUserPreferences();

  assert.deepEqual(store.readUserPreference('fontSettings', null), {
    uiFontSize: '18',
    fontFamily: 'system',
    terminalFontFamily: 'fira-code',
  });
  assert.deepEqual(store.readUserPreference('providerModelSettings', null), {
    claude: { model: 'sonnet', effort: 'high' },
    codex: { model: 'gpt-5.4' },
  });

  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{
    fontSettings: {
      uiFontSize: '18',
      fontFamily: 'system',
      terminalFontFamily: 'fira-code',
    },
    providerModelSettings: {
      claude: { model: 'sonnet', effort: 'high' },
      codex: { model: 'gpt-5.4' },
    },
  }]);
});

test('server font and model preferences take precedence over legacy browser values', async () => {
  localStorage.setItem('fontSettings.uiFontSize', '18');
  localStorage.setItem('claude-model', 'sonnet');
  serverPreferences = {
    fontSettings: { uiFontSize: '16' },
    providerModelSettings: { claude: { model: 'opus' } },
  };

  const store = await loadStore();
  await store.hydrateUserPreferences();

  assert.deepEqual(store.readUserPreference('fontSettings', null), { uiFontSize: '16' });
  assert.deepEqual(store.readUserPreference('providerModelSettings', null), {
    claude: { model: 'opus' },
  });
  assert.deepEqual(saved, []);
});

test('font readers use the server-backed preference and writers update it', async () => {
  const store = await loadStore();
  const fontSettings = await import('@/shared/fontSettings');
  const chosen = {
    uiFontSize: '18',
    terminalFontSize: '15',
    fontFamily: 'system' as const,
    codeFontSize: '14',
    codeFontFamily: 'fira-code' as const,
    terminalFontFamily: 'fira-code' as const,
  };

  fontSettings.writeFontSettings(chosen);
  assert.deepEqual(fontSettings.readFontSettings(), chosen);
  assert.deepEqual(store.readUserPreference('fontSettings', null), chosen);

  await vi.advanceTimersByTimeAsync(500);
  assert.deepEqual(saved, [{ fontSettings: chosen }]);
});
