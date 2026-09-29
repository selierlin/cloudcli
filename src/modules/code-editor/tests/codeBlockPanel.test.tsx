import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import MarkdownCodeBlock from '@/modules/code-editor/markdown/MarkdownCodeBlock';
import MermaidDiagram from '@/modules/code-editor/markdown/MermaidDiagram';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The two code-block panels the code-editor module owns, on the same board the
 * chat transcript uses.
 *
 * `MarkdownCodeBlock` used to hand the light appearance `hsl(var(--muted))` and
 * let the dark one fall through to Prism's own `pre` background — two boards for
 * one element, and the dark one not a token a theme could reach. Both now write
 * `hsl(var(--code-block-bg))`. Rendering both appearances is what makes that
 * observable: a `background` selected per appearance reads correctly in each
 * half and only disagrees when the two are compared.
 *
 * What a real engine resolves the token to is answered on the fixture page
 * (`tests/theme-tokens/code-block-surface.spec.ts`); these assertions are about
 * the markup, which no engine-side probe can see.
 */

/** Keeps the diagram in its "not rendered yet" state, which is the raw-source `<pre>`. */
vi.mock('mermaid', () => ({
  default: { initialize: () => undefined, render: () => new Promise(() => {}) },
}));

const CODE = 'const answer = 41;\n';

const APPEARANCES = ['light', 'dark'] as const;

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton and outlives localStorage.clear().
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
});

/** The `style` attribute on the highlighted `<pre>`, rendered under one appearance. */
const editorPreStyle = (appearance: (typeof APPEARANCES)[number]): string => {
  localStorage.setItem('theme', appearance);
  writeUserPreference('theme', appearance);

  const { container, unmount } = render(
    <ThemeProvider>
      <MarkdownCodeBlock className="language-ts">{CODE}</MarkdownCodeBlock>
    </ThemeProvider>,
  );
  const style = container.querySelector('pre')?.getAttribute('style') ?? '';
  unmount();
  return style;
};

test('the editor preview paints the code-block token, the same board in both appearances', () => {
  const styles = APPEARANCES.map(editorPreStyle);

  for (const [index, style] of styles.entries()) {
    assert.match(
      style,
      /background:\s*hsl\(var\(--code-block-bg\)\)/,
      `the panel's own token should reach the <pre> in ${APPEARANCES[index]}, got "${style}"`,
    );
  }

  // One declaration, one value: a board chosen per appearance reads correctly in
  // each half on its own and only disagrees here, which is how the old
  // light-only `--muted` behaved.
  assert.equal(styles[1], styles[0], 'the two appearances should draw the same board');
});

test('the mermaid source fallback paints the same token in both appearances', () => {
  // MermaidDiagram picks its diagram theme from `useTheme`; MarkdownCodeBlock no
  // longer reads it, so only this one needs the provider for that reason.
  const { container } = render(
    <ThemeProvider>
      <MermaidDiagram code={'graph TD;\n  A-->B;\n'} />
    </ThemeProvider>,
  );

  const pre = container.querySelector('pre');
  assert.ok(pre, 'expected the raw-source fallback to render a <pre>');

  const classes = pre.className;
  assert.ok(classes.includes('bg-code-block/50'), `the light half should paint the token, got "${classes}"`);
  assert.ok(classes.includes('dark:bg-code-block'), `the dark half should paint it opaque, got "${classes}"`);
  assert.ok(!classes.includes('bg-muted/50'), 'the fallback should no longer read --muted');
  assert.ok(!classes.includes('n-zinc-900'), 'the dark half should no longer be a compatibility atom');
});
