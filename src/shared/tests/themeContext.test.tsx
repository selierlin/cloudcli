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

/** The favicon link `applyThemeChrome` republishes, mirroring `index.html`. */
function ensureFaviconLink(): void {
  if (!document.querySelector('link[rel="icon"]')) {
    const link = document.createElement('link');
    link.setAttribute('rel', 'icon');
    link.setAttribute('href', '/icons/favicon-light-32.png');
    document.head.appendChild(link);
  }
}

const originalMatchMedia = window.matchMedia;
/** Listeners the provider registered on the emulated `prefers-color-scheme` query. */
let colorSchemeListeners: Array<(event: MediaQueryListEvent) => void> = [];

/**
 * Emulates an OS appearance so `system` mode has something to follow. jsdom's
 * `matchMedia` is a static stub, so the change event has to be driven by hand.
 */
const emulateSystemDarkAppearance = (matches: boolean) => {
  colorSchemeListeners = [];
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      colorSchemeListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      colorSchemeListeners = colorSchemeListeners.filter((entry) => entry !== listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
};

const changeSystemAppearance = (matches: boolean) => {
  colorSchemeListeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
};

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
  ensureFaviconLink();
  emulateSystemDarkAppearance(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  colorSchemeListeners = [];
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
 * `<html data-theme>` is how a theme's overlay is selected, so it has to be
 * written even when nothing is picked: the two appearance defaults are what the
 * document falls back to, and the attribute is the contract the overlay rules
 * and the contract tests key on.
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
 * theme-colour token falls back to the *base palette of the current appearance*
 * (§5.8 v8) instead of a white that a dark page never asked for. The resolved
 * colours themselves are pinned in the browser suite, where a stylesheet is present.
 */
test('the browser chrome follows the appearance', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(chromeContent('apple-mobile-web-app-status-bar-style'), 'default');
  assert.equal(chromeContent('theme-color'), '#f7f6f3');
  assert.equal(document.querySelector('link[rel="icon"]')?.getAttribute('href'), '/icons/favicon-light-32.png');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(chromeContent('apple-mobile-web-app-status-bar-style'), 'black-translucent');
  assert.equal(chromeContent('theme-color'), '#141414');
  assert.equal(document.querySelector('link[rel="icon"]')?.getAttribute('href'), '/icons/favicon-dark-32.png');
});

test('the registry keeps the appearance defaults and the overlay themes apart', () => {
  const ids = BUILTIN_THEMES.map((manifest) => manifest.id);
  assert.equal(new Set(ids).size, ids.length, 'built-in ids must be unique');

  for (const appearance of ['light', 'dark'] as const) {
    const matches = BUILTIN_THEMES.filter((manifest) => manifest.appearance === appearance);
    assert.equal(matches.length, 1, `expected exactly one built-in ${appearance} theme`);
    assert.ok(matches[0].id.startsWith('cc-'), 'built-in ids must keep the cc- prefix');
    assert.equal(
      matches[0].coverage,
      'full',
      'an appearance default is the whole palette, not an overlay',
    );
  }

  // `appearance: 'system'` is what marks a theme as an overlay: it is not bound to
  // one appearance, it is what the selector offers, and it is the only kind that
  // declares `[data-theme]` rules.
  const overlays = BUILTIN_THEMES.filter((manifest) => manifest.appearance === 'system');
  assert.ok(overlays.length > 0, 'the selector has nothing to offer without an overlay theme');
  for (const overlay of overlays) {
    assert.ok(overlay.id.startsWith('cc-'), 'built-in ids must keep the cc- prefix');
    assert.ok(overlay.coverage, `${overlay.id} must declare its reach for the selector badge`);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The overlay axis is orthogonal to the appearance one: `themeId` picks which
 * `[data-theme]` rule is layered on, while the light/dark/system capsule stays
 * the only thing deciding which half of the palette is in force. An overlay
 * theme paints both halves, which is why picking one here leaves the light
 * appearance alone.
 */
test('picking an overlay applies it to the document', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.themeId, null);
  assert.equal(result.current.resolvedThemeId, 'cc-light');

  act(() => {
    result.current.setThemeId('cc-ocean');
  });

  assert.equal(result.current.themeId, 'cc-ocean');
  assert.equal(result.current.resolvedThemeId, 'cc-ocean');
  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');
  assert.equal(readUserPreference('themeId', null), 'cc-ocean');
});

test('clearing the overlay returns to the appearance default', () => {
  writeUserPreference('themeId', 'cc-ocean');

  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');

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
    writeUserPreference('themeId', 'cc-ocean');
  });

  assert.equal(result.current.themeId, 'cc-ocean');
  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');
});

test('an overlay pick is stored even while the appearance follows the system', () => {
  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.themeMode, 'system');

  act(() => {
    result.current.setThemeId('cc-ocean');
  });

  assert.equal(readUserPreference('themeId', null), 'cc-ocean');
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
  writeUserPreference('themeId', 'cc-not-installed');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.themeId, 'cc-not-installed', 'the pick is still reported back');
  assert.equal(result.current.resolvedThemeId, 'cc-light');
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.ok(
    warn.mock.calls.some(([message]) => String(message).includes('cc-not-installed')),
    'the fallback must be announced rather than silent',
  );
});

test('a user who has never chosen a theme is following the system', () => {
  emulateSystemDarkAppearance(true);

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(result.current.isDarkMode, true);
  assert.equal(
    readUserPreference<unknown>('theme', null),
    null,
    'following the system is the default, not something to record',
  );
});

test('choosing "system" is stored and resolves against the OS', () => {
  emulateSystemDarkAppearance(true);
  writeUserPreference('theme', 'light');

  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.isDarkMode, false);

  act(() => {
    result.current.setThemeMode('system');
  });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(result.current.isDarkMode, true);
  assert.equal(readUserPreference('theme', null), 'system');
});

test('the OS switching appearance flips the theme while following the system', () => {
  writeUserPreference('theme', 'system');

  const { result } = renderHook(() => useTheme(), { wrapper });
  assert.equal(result.current.isDarkMode, false);

  act(() => {
    changeSystemAppearance(true);
  });

  assert.equal(result.current.isDarkMode, true);
  assert.ok(document.documentElement.classList.contains('dark'));
});

test('the OS switching appearance leaves a pinned theme alone', () => {
  writeUserPreference('theme', 'light');

  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    changeSystemAppearance(true);
  });

  assert.equal(result.current.themeMode, 'light');
  assert.equal(result.current.isDarkMode, false);
});

test('an explicit toggle leaves system mode behind', () => {
  writeUserPreference('theme', 'system');

  const { result } = renderHook(() => useTheme(), { wrapper });

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(result.current.themeMode, 'dark');
  assert.equal(readUserPreference('theme', null), 'dark');
});

test('a stored value written by a newer client falls back to following the system', () => {
  emulateSystemDarkAppearance(true);
  writeUserPreference('theme', 'solarized');

  const { result } = renderHook(() => useTheme(), { wrapper });

  assert.equal(result.current.themeMode, 'system');
  assert.equal(result.current.isDarkMode, true);
});
