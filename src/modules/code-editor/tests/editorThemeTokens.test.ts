import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { test } from 'vitest';

import { collectSyntaxVariables, syntaxTheme } from '@/shared/syntaxTheme';
import { editorChrome, editorHighlightStyle } from '@/modules/code-editor/utils/editorTheme';

/**
 * Guards the editor theme's two silent failure modes.
 *
 * A colour left as a literal stops following the theme, and a misspelled token
 * name makes the declaration invalid — the browser then keeps whatever the
 * previous rule set, which looks almost right and is therefore easy to miss.
 * Both are checked against the declarations themselves, since resolving would
 * hide the indirection.
 */

const EDITOR_MODULE = join(process.cwd(), 'src', 'modules', 'code-editor');
const STYLESHEET = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

const declaredEditorTokens = new Set(
  [...STYLESHEET.matchAll(/(--editor-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
);
const declaredSyntaxTokens = new Set(Object.values(collectSyntaxVariables(syntaxTheme.style)));

const TOKEN_REFERENCE = /^var\((--editor-[a-z0-9-]+)\)$/;

/** Every string leaf of a nested rule object. */
const values = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(values);
  }
  return [];
};

const chromeValues = values(editorChrome);

test('every chrome colour is a token reference', () => {
  for (const value of chromeValues) {
    assert.match(value, /^var\(--editor-[a-z0-9-]+\)$/, `chrome holds a literal value: ${value}`);
  }
});

test('every editor token the chrome references is declared', () => {
  const referenced = chromeValues.flatMap((value) => {
    const match = TOKEN_REFERENCE.exec(value);
    return match ? [match[1]] : [];
  });
  assert.ok(referenced.length > 0, 'the chrome references no tokens at all');

  const missing = referenced.filter((token) => !declaredEditorTokens.has(token));
  assert.deepEqual(missing, [], 'these editor tokens are referenced but never declared');
});

test('every highlight colour is a token reference', () => {
  for (const spec of editorHighlightStyle.specs) {
    if (!spec.color) {
      continue;
    }
    assert.match(
      spec.color,
      /^var\(--(?:cc-syntax|editor)-[a-z0-9-]+\)$/,
      `a highlight spec holds a literal colour: ${spec.color}`,
    );
  }
});

test('the syntax slots the highlighter borrows exist in the Prism sheet', () => {
  const borrowed = editorHighlightStyle.specs.flatMap((spec) => {
    const match = /^var\((--cc-syntax-\d+)\)$/.exec(spec.color ?? '');
    return match ? [match[1]] : [];
  });
  // The whole point of sharing is that most of the highlighter comes from Prism.
  assert.ok(borrowed.length >= 10, `only ${borrowed.length} syntax slots are borrowed`);

  const missing = borrowed.filter((token) => !declaredSyntaxTokens.has(token));
  assert.deepEqual(missing, [], 'these syntax variables are not declared by the Prism sheet');
});

test('the editor no longer depends on the upstream one-dark theme', () => {
  const sources = readdirSync(EDITOR_MODULE, { recursive: true, encoding: 'utf8' })
    .filter((entry) => (entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.startsWith('tests'))
    .map((entry) => readFileSync(join(EDITOR_MODULE, entry), 'utf8'));

  // Matching the import (not a bare mention) so the module may still explain in
  // prose what it replaced.
  const offenders = sources.filter((source) => /from '@codemirror\/theme-one-dark'/.test(source));
  assert.deepEqual(offenders, [], 'one-dark is still imported somewhere in the module');
});
