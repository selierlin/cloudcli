import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import ThemeSelector from '@/modules/settings/ThemeSelector';
import { BUILTIN_THEMES } from '@/shared/constants';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { readUserPreference, resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The overlay selector. Two things it has to get right beyond writing the pick:
 * it must offer the overlay themes and nothing else (the appearance defaults are
 * the capsule's job), and it must keep a pick this build does not ship visible
 * while the document falls back — the user picked it elsewhere, so a selector
 * that showed nothing and said nothing would look like the pick had been lost.
 *
 * Which id the *selected* option is derived from is deliberately not pinned: in
 * the current registry `themeId` and `resolvedThemeId` mark the same option in
 * every reachable state (an installed overlay resolves to itself, and everything
 * else resolves to an appearance default that carries no overlay), so a test of
 * that choice would pass either way and prove nothing. What the tests do pin is
 * the filter an id outside the overlay set needs, and the fallback hint, which
 * does compare the two ids.
 *
 * The assertions read the registry and the preference store rather than matching
 * copy, so they stay independent of the locale files: the fake `t` returns keys.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options ? `${key}:${JSON.stringify(options)}` : key
    ),
    i18n: { language: 'en' },
  }),
}));

const overlayThemes = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

const manifestFor = (id: string) => {
  const found = BUILTIN_THEMES.find((theme) => theme.id === id);
  assert.ok(found, `${id} is not registered`);
  return found;
};

/**
 * Option buttons are found through their label, not by accessible name: the
 * coverage badge renders inside the button, so it joins the accessible name and
 * matching on the theme name alone would not resolve.
 */
function optionButton(container: HTMLElement, label: string): HTMLButtonElement {
  const labelSpan = [...container.querySelectorAll('span')].find((span) => span.textContent === label);
  assert.ok(labelSpan, `no option is labelled ${label}`);
  const button = labelSpan.closest('button');
  assert.ok(button, `the option labelled ${label} is not rendered as a button`);
  return button;
}

const renderSelector = () => render(
  <ThemeProvider>
    <ThemeSelector />
  </ThemeProvider>,
);

/**
 * A meta `applyThemeChrome` writes to, mirroring `index.html`. Created here because
 * the applier only touches metas the shell already ships.
 */
function ensureChromeMeta(name: string): void {
  if (!document.querySelector(`meta[name="${name}"]`)) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
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

test('the selector offers the default plus every overlay theme, badged by its declared reach', () => {
  const { container } = renderSelector();

  const radios = container.querySelectorAll('[role="radio"]');
  assert.equal(
    radios.length,
    overlayThemes.length + 1,
    'the appearance defaults must not appear: they are the base palette, not overlays',
  );
  assert.equal(
    container.querySelector('[role="radiogroup"]')?.getAttribute('aria-label'),
    'themeSelector.label',
  );

  const defaultOption = optionButton(container, 'themeSelector.default');
  assert.equal(
    defaultOption.querySelectorAll('span').length,
    1,
    'the default option claims no reach, so it carries no badge',
  );

  for (const theme of overlayThemes) {
    const option = optionButton(container, theme.name);
    assert.ok(
      option.textContent?.includes(`themeSelector.coverage.${theme.coverage}`),
      `${theme.id} must show the "${theme.coverage}" badge its registry entry declares`,
    );
  }

  // The badge is not decorative: it is the promise the contract suite asserts token
  // by token, so at least one theme of each kind has to be on offer.
  assert.deepEqual(
    [...new Set(overlayThemes.map((theme) => theme.coverage))].sort(),
    ['accent', 'full'],
  );
  assert.equal(container.querySelectorAll('[role="status"]').length, 0);
});

test('picking an overlay writes it to the document and to the preference', () => {
  const ocean = manifestFor('cc-ocean');
  const { container } = renderSelector();

  assert.equal(optionButton(container, 'themeSelector.default').getAttribute('aria-checked'), 'true');

  fireEvent.click(optionButton(container, ocean.name));

  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');
  assert.equal(readUserPreference('themeId', null), 'cc-ocean');
  assert.equal(optionButton(container, ocean.name).getAttribute('aria-checked'), 'true');
  assert.equal(optionButton(container, 'themeSelector.default').getAttribute('aria-checked'), 'false');
});

test('choosing the default clears the overlay', () => {
  writeUserPreference('themeId', 'cc-ocean');
  const { container } = renderSelector();

  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');

  fireEvent.click(optionButton(container, 'themeSelector.default'));

  assert.equal(readUserPreference('themeId', null), null);
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
});

/**
 * A default-alias id carries no overlay of its own, and `setThemeId` accepts one.
 * Marking no option at all in that state would read as "nothing is selected", so
 * the alias has to fall back to the default option.
 */
test('a default-alias pick reads as the default option rather than as nothing', () => {
  writeUserPreference('themeId', 'cc-dark');
  const { container } = renderSelector();

  assert.equal(document.documentElement.dataset.theme, 'cc-dark');
  assert.equal(optionButton(container, 'themeSelector.default').getAttribute('aria-checked'), 'true');
});

/**
 * The regression this guards: a pick that is stored but not applied has to be
 * explained — the document falls back, yet the selector still has to say which
 * theme is missing. It also pins the document coming out with an id a rule
 * declares rather than with the uninstalled one.
 */
test('a pick this device does not ship is surfaced instead of silently dropped', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  writeUserPreference('themeId', 'cc-not-installed');

  const { container } = renderSelector();

  const status = container.querySelector('[role="status"]');
  assert.ok(status, 'the fallback has to be visible, not only logged');
  assert.ok(status.textContent?.includes('themeSelector.notInstalled'));
  assert.ok(
    status.textContent?.includes('cc-not-installed'),
    'the hint has to name the theme that is missing',
  );

  // The document still comes out with an id a rule declares. The pick stays on the
  // user's choice, which no option here represents, so the default is marked.
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
  assert.equal(optionButton(container, 'themeSelector.default').getAttribute('aria-checked'), 'true');
  for (const theme of overlayThemes) {
    assert.equal(optionButton(container, theme.name).getAttribute('aria-checked'), 'false');
  }
});
