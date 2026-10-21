import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postcss from 'postcss';
import type { Declaration, Rule } from 'postcss';
import { describe, expect, test } from 'vitest';

/**
 * Chrome drops every `::-webkit-scrollbar` rule on an element, and on its
 * descendants, the moment a non-`auto` `scrollbar-width` or `scrollbar-color`
 * reaches it. The app shipped exactly that on `.dark { scrollbar-width: thin }`
 * for a year: the per-theme boards in `~/.cloudcli/themes/` (14 of the 22 paint
 * a thumb — macOS's inset pill, win9x's sunken well) were silently discarded and
 * every list rendered a stock bar over an opaque track instead.
 *
 * Nothing about that failure is loud — no build error, no console warning, and
 * the app still "has a scrollbar" — so the invariant is pinned here rather than
 * left to whoever next reaches for `scrollbar-color` to tint something.
 *
 * The rule: the standard properties may only be declared in the Firefox-only
 * `@supports` branch (Firefox has no scrollbar pseudo-elements, so it needs
 * them), or as `scrollbar-width: none` to hide a bar outright, which cannot
 * collide with a `::-webkit-scrollbar` rule because both sides hide it.
 */
const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const stylesheet = postcss.parse(CSS);

const firefoxBranchDeclarations = (): Set<Declaration> => {
  const allowed = new Set<Declaration>();
  stylesheet.walkAtRules('supports', (atRule) => {
    if (/^not\s+selector\(::-webkit-scrollbar\)$/.test(atRule.params.trim())) {
      atRule.walkDecls((decl) => {
        allowed.add(decl);
      });
    }
  });
  return allowed;
};

const declaredValue = (rule: Rule | undefined, prop: string): string | undefined =>
  rule?.nodes.find((node): node is Declaration => node.type === 'decl' && node.prop === prop)?.value;

const allDeclarations = (): Map<string, string> => {
  const found = new Map<string, string>();
  stylesheet.walkRules(':root', (rule) => {
    rule.walkDecls((decl) => {
      found.set(decl.prop, decl.value);
    });
  });
  return found;
};

describe('scrollbar chrome', () => {
  test('the standard properties only ever appear in the Firefox branch', () => {
    const allowed = firefoxBranchDeclarations();
    const offenders: string[] = [];
    stylesheet.walkDecls(/^scrollbar-(width|color)$/, (decl) => {
      if (decl.prop === 'scrollbar-width' && decl.value.trim() === 'none') return;
      if (allowed.has(decl)) return;
      const selector = (decl.parent as Rule | undefined)?.selector ?? '(no selector)';
      offenders.push(`${decl.prop}: ${decl.value} — ${selector}`);
    });

    expect(
      offenders,
      'These would make Chrome ignore every ::-webkit-scrollbar rule, including the ones the user themes ship.',
    ).toEqual([]);
  });

  test('the bar itself is declared once and reads the tokens', () => {
    const rules: Rule[] = [];
    stylesheet.walkRules((rule) => {
      if (rule.selector.includes('::-webkit-scrollbar')) rules.push(rule);
    });

    const find = (pseudo: string) =>
      rules.find((rule) => new RegExp(`^\\*\\s*::${pseudo}$`).test(rule.selector.trim()));

    expect(
      declaredValue(find('-webkit-scrollbar'), 'width'),
      'one width for every scroll container',
    ).toBe('var(--scrollbar-size)');
    expect(
      declaredValue(find('-webkit-scrollbar-thumb'), 'background-color'),
      'the thumb follows the theme',
    ).toBe('hsl(var(--scrollbar-thumb))');
    expect(
      declaredValue(find('-webkit-scrollbar-track'), 'background'),
      'an empty track is what stops the bar reading as a gutter',
    ).toBe('var(--scrollbar-track)');
  });

  test('the tokens resolve through the palette, not a literal colour', () => {
    const declared = allDeclarations();

    expect(declared.get('--scrollbar-size')).toBe('8px');
    expect(declared.get('--scrollbar-thumb')).toBe('var(--muted-foreground) / 0.35');
    expect(declared.get('--scrollbar-thumb-hover')).toBe('var(--muted-foreground) / 0.6');
    expect(declared.get('--scrollbar-track')).toBe('transparent');
  });

  test('the colour slots stay triplets, never a finished colour', () => {
    const declared = allDeclarations();
    // The consumer is `hsl(var(--scrollbar-thumb))`: a value that already is a
    // colour renders `hsl(hsl(...))`, which the browser drops without a word,
    // leaving the thumb transparent. Pinning the values above only pins
    // today's literals; this pins the shape they have to keep.
    const offenders = ['--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrollbar-track']
      .filter((name) => {
        const value = declared.get(name)?.trim();
        return value !== undefined && value !== 'transparent' && !value.startsWith('var(');
      });

    expect(offenders, 'a finished colour here would silently paint no thumb').toEqual([]);
  });
});
