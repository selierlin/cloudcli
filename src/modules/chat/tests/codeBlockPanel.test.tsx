import assert from 'node:assert/strict';

import { test } from 'vitest';
import { render } from '@testing-library/react';

import { Markdown } from '@/modules/chat/transcript/Markdown';

/**
 * The chat code block sits on `--code-block-bg` rather than `--muted` above a
 * compatibility atom, so the panel follows the appearance's editor page and a
 * theme can move it.
 *
 * What a real engine resolves `bg-code-block/50` to is answered on the fixture
 * page (`tests/theme-tokens/code-block-surface.spec.ts`). This file holds the
 * half no probe there can see: that the *consumer* asks for that token at all.
 * A probe assembled in the fixture keeps passing if this markup goes back to
 * `bg-muted/50`, so the class names are pinned here instead.
 */

const CODE_MARKDOWN = '```ts\nconst answer = 41;\n```\n';

test('the chat code block paints the code-block token in both appearances', () => {
  const { container } = render(<Markdown>{CODE_MARKDOWN}</Markdown>);

  const panel = container.querySelector<HTMLElement>('.markdown-code-block');
  assert.ok(panel, 'expected the fenced block to render a .markdown-code-block panel');

  const classes = panel.className;
  assert.ok(classes.includes('bg-code-block/50'), `the light half should paint the token, got "${classes}"`);
  assert.ok(classes.includes('dark:bg-code-block'), `the dark half should paint it opaque, got "${classes}"`);
  assert.ok(!classes.includes('bg-muted/50'), 'the panel should no longer read --muted');
  assert.ok(!classes.includes('n-zinc-900'), 'the dark half should no longer be a compatibility atom');
});
