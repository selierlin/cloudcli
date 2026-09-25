import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import MarkdownCodeBlock from '@/modules/code-editor/markdown/MarkdownCodeBlock';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * MarkdownCodeBlock used to hand Prism the light or dark theme object depending
 * on `isDarkMode`. `react-syntax-highlighter` re-tokenizes a block whenever its
 * `style` prop changes, so a theme toggle re-highlighted every mounted preview.
 * It now renders with the shared variable theme, which keeps the prop constant.
 *
 * These tests pin the observable half of that: every token colour is a
 * `var(--cc-syntax-N)` reference, the same in both appearances, and the injected
 * stylesheet declares those variables. A literal colour would mean the theme
 * object was being selected again rather than resolved by the cascade.
 */

const CODE = 'const answer = 41;\n';

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton and outlives localStorage.clear().
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
});

const renderBlock = (theme: 'light' | 'dark') => {
  localStorage.setItem('theme', theme);
  writeUserPreference('theme', theme);
  return render(
    <ThemeProvider>
      <MarkdownCodeBlock className="language-ts">{CODE}</MarkdownCodeBlock>
    </ThemeProvider>,
  );
};

/** The colour each highlighted token is painted with, in document order. */
const tokenColours = (container: HTMLElement): string[] => {
  const colours: string[] = [];
  for (const token of container.querySelectorAll<HTMLElement>('span.token[style]')) {
    if (token.style.color) {
      colours.push(token.style.color);
    }
  }
  return colours;
};

test('every token colour is a variable reference, not a literal', () => {
  const colours = tokenColours(renderBlock('light').container);
  assert.ok(colours.length > 0, 'expected the highlighted block to colour its tokens');

  for (const colour of colours) {
    assert.match(colour, /^var\(--cc-syntax-\d+\)$/, `token colour "${colour}" is not a variable`);
  }
});

test('the highlighted <pre> reads its own colour from a variable too', () => {
  const pre = renderBlock('light').container.querySelector('pre');
  assert.ok(pre, 'expected the fenced block to render a highlighted <pre>');

  assert.match(
    pre.getAttribute('style') ?? '',
    /color:\s*var\(--cc-syntax-\d+\)/,
    'the <pre> colour must come from the shared variable theme',
  );
});

test('light and dark render the same token colours', () => {
  // Identical output is the point: if the appearance selected a different theme
  // object, these two lists would differ and the style prop would have changed.
  assert.deepEqual(tokenColours(renderBlock('dark').container), tokenColours(renderBlock('light').container));
});

test('the injected stylesheet declares the variables the block references', () => {
  const colours = tokenColours(renderBlock('dark').container);

  const stylesheet = document.querySelector('style#cc-syntax-theme');
  assert.ok(stylesheet, 'expected the shared syntax theme stylesheet to be injected');

  const css = stylesheet.textContent ?? '';
  for (const colour of colours) {
    const variable = /var\((--cc-syntax-\d+)\)/.exec(colour)?.[1];
    assert.ok(variable, `unexpected token colour "${colour}"`);
    assert.ok(css.includes(`${variable}:`), `${variable} is referenced but not declared`);
  }
});
