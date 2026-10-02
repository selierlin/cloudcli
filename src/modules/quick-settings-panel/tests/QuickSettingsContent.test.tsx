import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import { BUILTIN_THEMES } from '@/shared/constants';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import type { LLMProvider } from '@/shared/types';
import { readUserPreference, resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The compact colour-theme row the drawer adds next to the light/dark capsule.
 * It shares its options with the settings page's ThemeSelector through
 * `useThemeOptions`, so what the tests pin is that the drawer's select lists
 * the overlay themes (and nothing else) and that a pick takes the same effect
 * as a pick in the settings page.
 *
 * Like the settings-page selector tests, assertions read the registry and the
 * preference store rather than matching copy: the fake `t` returns keys.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/modules/quick-settings-panel/hooks/useChatFontSettings', () => ({
  useChatFontSettings: () => ({
    uiFontSize: '16',
    fontFamily: 'system',
    codeFontSize: '13',
    codeFontFamily: 'system',
    setUiFontSize: vi.fn(),
    setFontFamily: vi.fn(),
    setCodeFontSize: vi.fn(),
    setCodeFontFamily: vi.fn(),
  }),
}));

vi.mock('@/modules/quick-settings-panel/QuickSettingsExportSection', () => ({
  default: () => null,
}));

const overlayThemes = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

const renderContent = () => render(
  <ThemeProvider>
    <QuickSettingsContent
      messages={[]}
      provider={{} as LLMProvider}
      selectedProject={null}
      exportExpanded={false}
      onExportToggle={() => {}}
      isLoading={false}
    />
  </ThemeProvider>,
);

/** The row's select is the first one in the appearance section. */
function themeSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('select');
  assert.ok(select, 'the colour-theme row must render a select');
  return select;
}

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
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
  ensureChromeMeta('theme-color');
  ensureChromeMeta('apple-mobile-web-app-status-bar-style');
});

test('the drawer offers the default plus every overlay theme in a select', () => {
  const { container } = renderContent();

  const options = [...themeSelect(container).querySelectorAll('option')];
  assert.equal(
    options.length,
    overlayThemes.length + 1,
    'the appearance defaults must not appear: they are the base palette, not overlays',
  );
  assert.equal(options[0].value, '', 'the first option is the appearance default');

  const listedIds = new Set(options.slice(1).map((option) => option.value));
  assert.deepEqual(listedIds, new Set(overlayThemes.map((theme) => theme.id)));

  // The English name rides inside the option text exactly as it does as the
  // settings page's second line: the pick has to answer to both names.
  for (const theme of overlayThemes) {
    assert.ok(theme.nameEn, `${theme.id} ships an English name`);
    const option = options.find((entry) => entry.value === theme.id);
    assert.ok(
      option?.textContent?.includes(theme.nameEn),
      `${theme.id} must list its English name beside the Chinese one`,
    );
  }
});

test('picking a theme in the drawer writes it to the document and to the preference', () => {
  const ocean = overlayThemes.find((theme) => theme.id === 'cc-ocean');
  assert.ok(ocean, 'cc-ocean is registered');

  const { container } = renderContent();
  assert.equal(themeSelect(container).value, '', 'the default is in force before any pick');

  fireEvent.change(themeSelect(container), { target: { value: 'cc-ocean' } });

  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');
  assert.equal(readUserPreference('themeId', null), 'cc-ocean');
  assert.equal(themeSelect(container).value, 'cc-ocean');
});

test('choosing the default from the drawer clears the overlay', () => {
  writeUserPreference('themeId', 'cc-ocean');
  const { container } = renderContent();
  assert.equal(document.documentElement.dataset.theme, 'cc-ocean');

  fireEvent.change(themeSelect(container), { target: { value: '' } });

  assert.equal(readUserPreference('themeId', null), null);
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
});
