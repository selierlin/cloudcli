import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from 'tailwindcss';
import { describe, expect, test } from 'vitest';

import {
  EXTREME_TOKENS,
  NEUTRAL_FAMILIES,
  NEUTRAL_STEPS,
  SCALE_TOKEN_NAMES,
  familyHex,
  hexToHslTriplet,
  hslTripletToHex,
  paletteName,
  readDeclarations,
  tokenName,
} from '@/shared/tests/neutralScale';
import {
  MIGRATED_UTILITIES,
  MODIFIER_SHAPES,
  compileUtilities,
} from '@/shared/tests/neutralScaleCompiler';

/**
 * Equivalence gate for the neutral compatibility scale.
 *
 * 0-E rewrites ~1.5k hardcoded neutral utility classes (`bg-gray-100
 * dark:bg-gray-700`) into tokenised ones (`bg-n-gray-100 dark:bg-n-gray-700`).
 * The slice promises the browser renders the same colour, which is only true if
 * the whole chain holds:
 *
 *   class  ->  tailwind config  ->  hsl(var(--n-gray-100))
 *          ->  --n-gray-100  ->  --palette-gray-100  ->  Tailwind's literal
 *
 * Each link is asserted below, so a broken one names the exact family and step
 * rather than showing up as a diffuse visual diff. Sibling guarantees: the
 * resolved value of every token is pinned by `tests/theme-tokens` (a real
 * browser), and the remaining literal classes are counted by
 * `themeHardcodedAtoms`.
 *
 * Read as declaration text, not computed values: `getComputedStyle` expands
 * `var()`, which would hide the very indirection under test.
 */

/**
 * Resolved from the workspace root rather than `import.meta.url`: under
 * Vitest's module runner the latter is not a `file:` URL, and the suite always
 * runs with the repo root as cwd.
 */
const REPO_ROOT = process.cwd();
const CSS = readFileSync(join(REPO_ROOT, 'src/index.css'), 'utf8');

const loadConfigModule = await import('tailwindcss/loadConfig.js');
const loadConfig = (loadConfigModule.default ?? loadConfigModule) as unknown as (
  path: string,
) => Config;

const PROBED_APPEARANCES = ['light', 'dark'] as const;
const baseline: Record<
  string,
  { tokens: Record<string, string>; rendered: Record<string, string> }
> = JSON.parse(
  readFileSync(join(REPO_ROOT, 'tests/theme-tokens/token-baseline.json'), 'utf8'),
);

const declarations = readDeclarations(CSS);

/**
 * Every tokenised class the migration can write, across the three declaration
 * families and the three modifier shapes, compiled once. The extremes ride
 * along because `bg-n-white` / `bg-n-black` are legal rewrites too.
 */
const MIGRATED_CLASSES = [
  ...NEUTRAL_FAMILIES.flatMap((family) =>
    NEUTRAL_STEPS.flatMap((step) =>
      MIGRATED_UTILITIES.flatMap((utility) =>
        MODIFIER_SHAPES.map(({ suffix }) => `${utility}-n-${family}-${step}${suffix}`),
      ),
    ),
  ),
  ...['white', 'black'].flatMap((extreme) =>
    MIGRATED_UTILITIES.flatMap((utility) =>
      MODIFIER_SHAPES.map(({ suffix }) => `${utility}-n-${extreme}${suffix}`),
    ),
  ),
];

const compiled = await compileUtilities(MIGRATED_CLASSES);

const occurrenceCount = (name: string) =>
  [...CSS.matchAll(new RegExp(`^[ \\t]*${name}\\s*:`, 'gm'))].length;

/** `('gray', 100)` -> `gray-100`, for failure messages. */
const label = (family: string, step: number) => `${family}-${step}`;

describe('the palette holds Tailwind’s neutral ramps verbatim', () => {
  for (const family of NEUTRAL_FAMILIES) {
    for (const step of NEUTRAL_STEPS) {
      test(`--palette-${label(family, step)} is Tailwind ${label(family, step)}`, () => {
        const hex = familyHex(family, step);
        expect(declarations.get(paletteName(family, step)), `${paletteName(family, step)} (from ${hex})`)
          .toBe(hexToHslTriplet(hex));
      });
    }
  }

  test('no step exists outside the Tailwind ramps', () => {
    const prefix = /^--palette-(gray|zinc|slate|neutral)-/;
    const declared = [...declarations.keys()].filter((name) => prefix.test(name));
    const expected = NEUTRAL_FAMILIES.flatMap((family) =>
      NEUTRAL_STEPS.map((step) => paletteName(family, step)),
    );
    expect(declared.sort()).toEqual(expected.sort());
  });

  /**
   * The equivalence above is circular on its own — both sides go through
   * `hexToHslTriplet`. This closes it: one-decimal HSL must reproduce Tailwind's
   * hex exactly, otherwise the whole chain faithfully preserves a colour that
   * is *nearly* the original one.
   */
  for (const family of NEUTRAL_FAMILIES) {
    test(`the one-decimal triplet form is lossless for the ${family} ramp`, () => {
      const lossy = NEUTRAL_STEPS.filter(
        (step) => hslTripletToHex(hexToHslTriplet(familyHex(family, step))) !== familyHex(family, step),
      );
      expect(
        lossy,
        `steps the triplet form cannot reproduce byte for byte:\n${lossy
          .map((step) => `${label(family, step)} (${familyHex(family, step)})`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('the --n-* tokens forward to the palette', () => {
  for (const family of NEUTRAL_FAMILIES) {
    for (const step of NEUTRAL_STEPS) {
      test(`--n-${label(family, step)} points at its palette step`, () => {
        expect(declarations.get(tokenName(family, step))).toBe(
          `var(${paletteName(family, step)})`,
        );
      });
    }
  }

  test('--n-white / --n-black reuse the palette extremes', () => {
    expect(declarations.get('--n-white')).toBe('var(--palette-white)');
    expect(declarations.get('--n-black')).toBe('var(--palette-black)');
  });

  test('no token exists outside the declared vocabulary', () => {
    const declared = [...declarations.keys()].filter((name) => /^--n-/.test(name));
    expect(declared.sort()).toEqual([...SCALE_TOKEN_NAMES, ...EXTREME_TOKENS].sort());
  });

  /**
   * The scale is appearance-agnostic: light versus dark stays the site's choice
   * of step. A `.dark` override would silently collapse that, so the tokens are
   * declared exactly once.
   */
  test('every --n-* token is declared exactly once', () => {
    const duplicated = [...SCALE_TOKEN_NAMES, ...EXTREME_TOKENS].filter(
      (name) => occurrenceCount(name) !== 1,
    );
    expect(duplicated, `declared zero or several times:\n${duplicated.join('\n')}`).toEqual([]);
  });
});

describe('Tailwind resolves every token back to itself', () => {
  test('the config registers every ramp as hsl(var(--n-*))', async () => {
    const config = await loadConfig(join(REPO_ROOT, 'tailwind.config.js'));
    const colors = config.theme?.extend?.colors as Record<string, unknown>;

    const mismatched: string[] = [];
    for (const family of NEUTRAL_FAMILIES) {
      const registered = colors[`n-${family}`] as Record<string, string> | undefined;
      const expected = Object.fromEntries(
        NEUTRAL_STEPS.map((step) => [String(step), `hsl(var(${tokenName(family, step)}))`]),
      );
      if (JSON.stringify(registered) !== JSON.stringify(expected)) {
        mismatched.push(`n-${family}: ${JSON.stringify(registered)}`);
      }
    }
    expect(
      mismatched,
      `ramps whose registration is not one hsl(var(--n-*)) per step:\n${mismatched.join('\n')}`,
    ).toEqual([]);

    expect(colors['n-white']).toBe('hsl(var(--n-white))');
    expect(colors['n-black']).toBe('hsl(var(--n-black))');
  });
});

/** Every `(suffix-free name, token)` the migration can name, ramps plus extremes. */
const MIGRATED_TOKENS: Array<{ name: string; token: string }> = [
  ...NEUTRAL_FAMILIES.flatMap((family) =>
    NEUTRAL_STEPS.map((step) => ({
      name: `${family}-${step}`,
      token: tokenName(family, step),
    })),
  ),
  ...(['white', 'black'] as const).map((extreme) => ({
    name: extreme,
    token: `--n-${extreme}`,
  })),
];

/**
 * The far end of the chain: what the renamed class actually emits.
 *
 * The links above prove a token *holds* the literal's value; this proves the
 * class that consumes it *declares* that value. A bulk search-and-replace can
 * satisfy every value-level check and still be wrong here — by naming a class
 * Tailwind does not generate, or by losing the alpha, which only survives
 * because the token form interpolates it inside `hsl()` where the literal form
 * used the separate `--tw-*-opacity` variable.
 */
describe('Tailwind emits the token form for every migrated class', () => {
  for (const { suffix, alpha } of MODIFIER_SHAPES) {
    const shape = suffix || 'plain';

    test(`bg/text/border with the ${shape} modifier declare hsl(var(--n-*)${
      alpha ? ` / ${alpha}` : ''
    })`, () => {
      const mismatches: string[] = [];
      for (const { name, token } of MIGRATED_TOKENS) {
        for (const utility of MIGRATED_UTILITIES) {
          const className = `${utility}-n-${name}${suffix}`;
          const body = compiled.get(className) ?? '';
          const declared = body.split(';').filter((part) => part.trim()).length;
          const actual = body.slice(body.indexOf(':') + 1).trim();
          const expected = alpha ? `hsl(var(${token}) / ${alpha})` : `hsl(var(${token}))`;
          if (declared !== 1 || actual !== expected) {
            mismatches.push(
              `${className}: ${declared} declaration(s) -> ${actual || '(empty)'} (expected ${expected})`,
            );
          }
        }
      }
      expect(
        mismatches,
        `classes whose compiled declaration is not the tokenised one:\n${mismatches.join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('the rendered baseline covers the scale', () => {
  for (const appearance of PROBED_APPEARANCES) {
    test(`every --n-* token resolves in ${appearance}`, () => {
      const unprobed = [...SCALE_TOKEN_NAMES, ...EXTREME_TOKENS].filter(
        (name) => !(name in baseline[appearance].rendered),
      );
      expect(
        unprobed,
        `tokens with no browser-resolved baseline:\n${unprobed.join('\n')}\n` +
          'Add them to tests/theme-tokens/main.ts and run UPDATE_THEME_BASELINE=1 npm run test:theme-tokens',
      ).toEqual([]);
    });
  }

  /** The two extremes must stay pure white / black in both appearances. */
  test('the extremes do not move with appearance', () => {
    for (const name of EXTREME_TOKENS) {
      const light = baseline.light.rendered[name];
      const dark = baseline.dark.rendered[name];
      expect(dark, `${name} differs between appearances`).toBe(light);
      expect(light).toMatch(/^rgb\(/);
    }
  });
});
