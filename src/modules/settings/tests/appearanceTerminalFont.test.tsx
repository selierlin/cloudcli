import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import AppearanceSettingsTab from '@/modules/settings/tabs/AppearanceSettingsTab';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { resetUserPreferences } from '@/shared/userSettings';

/**
 * The terminal's face is a choice the terminal cannot read off the stylesheet by
 * itself, so the settings page is where it is made and the only place a user can
 * express "no opinion". Two things therefore have to hold: the "follow the theme"
 * option is on offer (without it a pick could never be taken back), and choosing
 * one lands in the same store the terminal reads.
 *
 * The fake `t` returns its key, so the assertions name the keys rather than the
 * copy in any one locale — that also pins which keys the new row actually asks for.
 */

// `@/modules/i18n` initialises i18next at import time, so the mock has to carry
// the plugin it hands to `.use()` even though nothing here goes through it.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      list: async () => new Response('{}', { status: 200 }),
      file: async () => new Response('', { status: 200 }),
    },
    user: { savePreferences: async () => new Response('{}', { status: 200 }) },
  },
}));

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

function renderTab() {
  const noop = () => {};
  return render(
    <ThemeProvider>
      <AppearanceSettingsTab
        projectSortOrder="name"
        onProjectSortOrderChange={noop}
        codeEditorSettings={{ wordWrap: false, showMinimap: false, lineNumbers: true, fontSize: '13' }}
        onCodeEditorWordWrapChange={noop}
        onCodeEditorShowMinimapChange={noop}
        onCodeEditorLineNumbersChange={noop}
        onCodeEditorFontSizeChange={noop}
      />
    </ThemeProvider>,
  );
}

/** The control in the row whose label is the terminal font setting. */
const terminalFontSelect = (container: HTMLElement): HTMLSelectElement => {
  const label = [...container.querySelectorAll('div')].find(
    (node) => node.textContent === 'appearanceSettings.fontSettings.terminalFontFamily.label',
  );
  // label → its wrapper → the row, which also holds the control.
  const select = label?.parentElement?.parentElement?.querySelector('select');
  assert.ok(select, 'the terminal font picker must be on screen');
  return select;
};

test('the terminal font picker offers "follow the theme" and every monospace face', () => {
  const { container } = renderTab();
  const select = terminalFontSelect(container);

  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ['theme', 'system', 'jetbrains-mono', 'fira-code', 'cascadia-code', 'source-code-pro', 'hack', 'ibm-plex-mono'],
  );
  // The sentinel needs copy of its own; the faces reuse the code-block labels
  // rather than duplicating seven names.
  assert.equal(
    select.options[0].textContent,
    'appearanceSettings.fontSettings.terminalFontFamilyOptions.theme',
  );
  assert.equal(
    [...select.options][1].textContent,
    'appearanceSettings.fontSettings.codeFontFamilyOptions.system',
  );
});

test('picking a face stores it where the terminal reads settings from', () => {
  const { container } = renderTab();
  const select = terminalFontSelect(container);

  fireEvent.change(select, { target: { value: 'fira-code' } });

  assert.equal(localStorage.getItem('fontSettings.terminalFontFamily'), 'fira-code');
  assert.equal(terminalFontSelect(container).value, 'fira-code');
});
