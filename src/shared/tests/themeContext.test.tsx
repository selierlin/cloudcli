import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

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

/**
 * The two metas `applyThemeChrome` publishes to, mirroring `index.html`. They are
 * created here because the applier only writes metas the shell already ships.
 */
function ensureChromeMeta(name: string): void {
  if (!document.querySelector(`meta[name="${name}"]`)) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
}

function chromeContent(name: string): string | null {
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
}

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
  ensureChromeMeta('theme-color');
  ensureChromeMeta('apple-mobile-web-app-status-bar-style');
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
  assert.equal(document.documentElement.style.colorScheme, 'dark');
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

/**
 * `color-scheme` is the only part of applying the appearance the UA acts on
 * directly, so it is published on `<html>` instead of being left to the OS
 * preference — native form controls and scroll containers that carry no
 * scrollbar utility used to stay in the OS appearance even after the app had
 * been switched to the other one. The setup clears the property, so the light
 * assertion below is evidence the effect wrote it rather than a leftover.
 */
test('the resolved appearance is published as color-scheme', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(document.documentElement.style.colorScheme, 'light');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(document.documentElement.style.colorScheme, 'dark');
});

/**
 * The browser chrome — the OS status bar on iOS, the address bar elsewhere — sits
 * outside the page and so cannot read a token, which is why the effect publishes it
 * through `applyThemeChrome` at all. jsdom ships no stylesheet, so the pair below
 * pins both halves: the status bar tracks the appearance, and an unresolvable
 * theme-colour token keeps the colour `index.html` ships instead of publishing
 * whatever a failed resolution left behind. The resolved colours themselves are
 * pinned in the browser suite, where a stylesheet is present.
 */
test('the browser chrome follows the appearance', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(chromeContent('apple-mobile-web-app-status-bar-style'), 'default');
  assert.equal(chromeContent('theme-color'), '#ffffff');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(chromeContent('apple-mobile-web-app-status-bar-style'), 'black-translucent');
});

test('both appearances are registered as built-in themes', () => {
  for (const appearance of ['light', 'dark'] as const) {
    const matches = BUILTIN_THEMES.filter((manifest) => manifest.appearance === appearance);
    assert.equal(matches.length, 1, `expected exactly one built-in ${appearance} theme`);
    assert.ok(matches[0].id.startsWith('cc-'), 'built-in ids must keep the cc- prefix');
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The overlay axis is orthogonal to the appearance one: `themeId` picks which
 * `[data-theme]` rule is layered on, while the light/dark/system capsule stays
 * the only thing deciding which half of the palette is in force. A pick is
 * therefore applied on top of the appearance, not instead of it — which is why
 * choosing `cc-dark` here leaves the light appearance alone.
 */
test('picking an overlay applies it to the document', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.themeId, null);
  assert.equal(result.current.resolvedThemeId, 'cc-light');

  act(() => {
    result.current.setThemeId('cc-dark');
  });

  assert.equal(result.current.themeId, 'cc-dark');
  assert.equal(result.current.resolvedThemeId, 'cc-dark');
  assert.equal(document.documentElement.dataset.theme, 'cc-dark');
  assert.equal(readUserPreference('themeId', null), 'cc-dark');
});

test('clearing the overlay returns to the appearance default', () => {
  writeUserPreference('themeId', 'cc-dark');

  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(document.documentElement.dataset.theme, 'cc-dark');

  act(() => {
    result.current.setThemeId(null);
  });

  assert.equal(result.current.themeId, null);
  assert.equal(result.current.resolvedThemeId, 'cc-light');
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.equal(readUserPreference('themeId', null), null);
});

/**
 * The overlay is the one theme setting worth carrying to another device on its
 * own, so it is adopted from the preference store whatever the local appearance
 * is doing — including while that appearance follows the OS.
 */
test('an overlay picked elsewhere is adopted here', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    writeUserPreference('themeId', 'cc-dark');
  });

  assert.equal(result.current.themeId, 'cc-dark');
  assert.equal(document.documentElement.dataset.theme, 'cc-dark');
});

test('an overlay pick is stored even while the appearance follows the system', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.theme, 'system');

  act(() => {
    result.current.setThemeId('cc-dark');
  });

  assert.equal(readUserPreference('themeId', null), 'cc-dark');
  assert.equal(
    readUserPreference('theme', null),
    null,
    'the appearance key keeps its system exemption',
  );
});

/**
 * A theme mirrored from a device that has it installed may not exist here. The
 * picker keeps showing the user's own choice, so the fallback has to be loud
 * instead of silent — and the document still has to come out with an id a rule
 * actually declares, never one nothing matches.
 */
test('an overlay this device does not ship falls back to the appearance default', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeUserPreference('themeId', 'cc-ocean');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.themeId, 'cc-ocean', 'the pick is still reported back');
  assert.equal(result.current.resolvedThemeId, 'cc-light');
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.ok(
    warn.mock.calls.some(([message]) => String(message).includes('cc-ocean')),
    'the fallback must be announced rather than silent',
  );
});
