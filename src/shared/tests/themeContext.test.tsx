import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test } from 'vitest';

import { BUILTIN_THEMES } from '@/shared/constants';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import {
  readUserPreference,
  resetUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * The theme is stored server-side, so the provider has to distinguish a theme
 * the user picked from one this device merely started on. Persisting the
 * latter — which an effect keyed on the state does, on mount, before the stored
 * theme has been fetched — writes a device's system default over the user's
 * real choice on every other device.
 */

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ThemeProvider, null, children);

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

test('mounting stores no theme for a user who has never chosen one', () => {
  renderHook(() => useTheme(), { wrapper });

  assert.equal(
    readUserPreference<unknown>('theme', null),
    null,
    'a device must not record the theme it happened to start on',
  );
});

test('mounting does not overwrite the stored theme', () => {
  writeUserPreference('theme', 'dark');

  renderHook(() => useTheme(), { wrapper });

  assert.equal(readUserPreference('theme', null), 'dark');
});

test('a stored theme is applied on the first render', () => {
  writeUserPreference('theme', 'dark');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.isDarkMode, true);
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('toggling stores the theme the user picked', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.isDarkMode, false);

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(result.current.isDarkMode, true);
  assert.equal(readUserPreference('theme', null), 'dark');
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('system mode stays local when another device has an explicit theme', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    // Stands in for a hydrate delivering the theme chosen on another device.
    writeUserPreference('theme', 'dark');
  });

  assert.equal(result.current.isDarkMode, false);
  assert.equal(readUserPreference('theme', null), 'dark');
});

/**
 * `<html data-theme>` is how a theme's overlay is selected, so it has to track
 * the appearance even while every built-in theme resolves to the base palette —
 * the attribute is the contract the overlay rules and the contract tests key on.
 */
test('the built-in theme id follows the appearance', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(document.documentElement.dataset.theme, 'cc-light');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(document.documentElement.dataset.theme, 'cc-dark');
});

test('both appearances are registered as built-in themes', () => {
  for (const appearance of ['light', 'dark'] as const) {
    const matches = BUILTIN_THEMES.filter((manifest) => manifest.appearance === appearance);
    assert.equal(matches.length, 1, `expected exactly one built-in ${appearance} theme`);
    assert.ok(matches[0].id.startsWith('cc-'), 'built-in ids must keep the cc- prefix');
  }
});
