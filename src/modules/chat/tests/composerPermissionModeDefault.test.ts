import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import { WORKBUDDY_SETTINGS_STORAGE_KEY } from '@/shared/constants';
import type { LLMProvider, PermissionMode } from '@/shared/types';

/**
 * The composer's permission mode used to fall back to the settings default for
 * DSH alone. It now does so for every provider that has a settings panel, which
 * is what makes the omp/openclaw pickers (and the pre-existing pi/zcode/codex
 * ones) do anything at all.
 *
 * These drive the real hook: they seed a stored default and read the resolved
 * `permissionMode`, so dropping the fallback or letting the stored value win
 * over an explicit composer pick fails them.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    // The preference store PATCHes through api.user; it is stubbed rather than
    // exercised here, which keeps these tests about mode resolution.
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      available: () => okJson({ success: true, data: { providers: [] } }),
      // A null capability payload leaves the hook on its static fallback matrix,
      // which is the same matrix the backend advertises for these providers.
      capabilities: () => okJson({ success: true, data: null }),
      models: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

/** Renders the hook, switches it onto `provider` and returns the resolved mode. */
const resolvedModeFor = async (provider: LLMProvider): Promise<PermissionMode> => {
  const { useChatProviderState } = await import(
    '@/modules/chat/hooks/useChatProviderState'
  );
  const view = renderHook(() =>
    useChatProviderState({ selectedSession: null, selectedProject: null }),
  );

  if (provider !== 'claude') {
    await act(async () => {
      view.result.current.setProvider(provider);
    });
  }
  await waitFor(() => {
    assert.equal(view.result.current.provider, provider);
  });

  return view.result.current.permissionMode;
};

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
  vi.resetModules();
});

afterEach(() => {
  resetUserPreferences();
  vi.resetModules();
});

test('a stored settings default seeds the mode for a provider that has a permission panel', async () => {
  writeUserPreference('openclawPermissions', { permissionMode: 'auto' });

  assert.equal(await resolvedModeFor('openclaw'), 'auto');
});

test('the fallback is not DSH-only: pi and omp read their own stored defaults', async () => {
  writeUserPreference('piPermissions', { permissionMode: 'readonly' });
  writeUserPreference('ompPermissions', { permissionMode: 'readonly' });

  assert.equal(await resolvedModeFor('pi'), 'readonly');
  assert.equal(await resolvedModeFor('omp'), 'readonly');
});

test('dsh still reads its stored default', async () => {
  writeUserPreference('dshPermissions', { permissionMode: 'auto' });

  assert.equal(await resolvedModeFor('dsh'), 'auto');
});

test('workbuddy reads its mode from its own browser-local blob', async () => {
  localStorage.setItem(WORKBUDDY_SETTINGS_STORAGE_KEY, JSON.stringify({ permissionMode: 'plan' }));

  assert.equal(await resolvedModeFor('workbuddy'), 'plan');
});

test('a mode picked in the composer outranks the stored default', async () => {
  writeUserPreference('openclawPermissions', { permissionMode: 'auto' });
  localStorage.setItem('permissionMode-last-openclaw', 'default');

  assert.equal(await resolvedModeFor('openclaw'), 'default');
});

test('a stored mode the provider no longer offers is ignored', async () => {
  // `bypassPermissions` is not in openclaw's mode set, so the fallback must not
  // hand the runtime a mode it would reject.
  writeUserPreference('openclawPermissions', { permissionMode: 'bypassPermissions' });

  assert.equal(await resolvedModeFor('openclaw'), 'default');
});

test('a stored mode for one provider does not leak into another', async () => {
  writeUserPreference('piPermissions', { permissionMode: 'readonly' });

  assert.equal(await resolvedModeFor('openclaw'), 'default');
});
