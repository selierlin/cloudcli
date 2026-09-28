import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { readFontSettings } from '@/shared/utils';

/**
 * The terminal's face is stored alongside the other font choices, so it inherits
 * their upgrade behaviour: a key that was never written reads as the default, and
 * a key holding something unrecognisable falls back rather than reaching xterm.
 *
 * That default is `'theme'` — "no opinion" — which is what keeps the terminal's
 * font identical to what it was before the setting existed (§8.1/P1): the theme's
 * `--term-font-family` answers, and its base-layer value is the shipped stack.
 */

beforeEach(() => {
  localStorage.clear();
});

test('a terminal font choice that was never written reads as "theme"', () => {
  assert.equal(readFontSettings().terminalFontFamily, 'theme');
});

test('an unrecognised terminal font choice falls back to "theme"', () => {
  localStorage.setItem('fontSettings.terminalFontFamily', 'comic-sans');

  assert.equal(readFontSettings().terminalFontFamily, 'theme');
});

test('a real terminal font choice survives the read', () => {
  localStorage.setItem('fontSettings.terminalFontFamily', 'fira-code');

  assert.equal(readFontSettings().terminalFontFamily, 'fira-code');
});
