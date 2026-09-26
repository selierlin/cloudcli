import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  BASE_PAIR_COLORS,
  CONTRAST_PAIRS,
  contrastRatioOfTriplets,
  findContrastWarnings,
} from '@/shared/userThemeContrast';
import type { ThemeColorValue } from '@/shared/userThemeContrast';

/**
 * §5.10's contrast check for user themes (§5.10 v2).
 *
 * The decisions worth pinning here are all about *what a verdict is a verdict
 * about*: a user theme is usually partial, so the side it does not state comes
 * from the base, and every warning that comes back has to be about something the
 * author actually wrote. The other half is what stops a pair from being judged at
 * all — a value only the stylesheet could resolve, a cycle — where the honest
 * answer is silence rather than a guess.
 *
 * These are the values the browser-backed guard (`tests/theme-tokens/contrast.spec.ts`)
 * measures the base with, so the numbers asserted below are the same numbers that
 * suite reads out of a real paint.
 */

/** A declaration map of literal triplets, the shape the compiler hands this module. */
function literals(tokens: Record<string, string>): Map<string, ThemeColorValue> {
  return new Map(
    Object.entries(tokens).map(([token, triplet]) => [token, { kind: 'literal', triplet }]),
  );
}

/** The warnings as `appearance ink on surface`, which is what makes a wrong one readable. */
function described(warnings: ReturnType<typeof findContrastWarnings>): string[] {
  return warnings.map(({ appearance, ink, surface }) => `${appearance} ${ink} on ${surface}`);
}

test('the base clears its own floors, so a warning is always about the author', () => {
  assert.deepEqual(
    findContrastWarnings(new Map(), 'system'),
    [],
    'every pair the contract names is measured, and the shipped base passes all of them in both appearances',
  );
});

test('a theme is judged against the base for the side it does not state', () => {
  // §5.5's own example. It moves `--primary` and `--ring` and leaves the label
  // colour to the base — which is how the whole `coverage: accent` class is
  // written, so a check that only read pairs the file states twice would have
  // nothing to say about the themes users actually paste.
  const warnings = findContrastWarnings(
    literals({ '--primary': '175 84% 32%', '--ring': '175 84% 32%' }),
    'system',
  );

  assert.deepEqual(
    described(warnings),
    ['light --primary-foreground on --primary'],
    'the light base puts near-white text on that teal; the dark base puts near-black on it, which passes',
  );
  assert.equal(warnings[0].ratio.toFixed(2), '3.49');
  assert.equal(warnings[0].min, 4.5);
});

test('the ring is held to its own floor, not the text one', () => {
  // The same accent, measured as the focus indicator it also is: 3.38:1 clears
  // §5.10's hard clause and would have failed if every pair took 4.5.
  const ratio = contrastRatioOfTriplets('175 84% 32%', BASE_PAIR_COLORS.light['--background']);
  assert.ok(ratio !== null && ratio >= 3 && ratio < 4.5, `expected a ratio between the two floors, got ${ratio}`);
  assert.deepEqual(
    described(findContrastWarnings(literals({ '--ring': '175 84% 32%' }), 'light')),
    [],
  );
});

test('a theme scoped to one appearance is judged in that one only', () => {
  // A teal dark enough to carry near-white text, which is exactly what the dark
  // base's near-black label cannot sit on.
  const tokens = literals({ '--primary': '175 84% 20%' });

  assert.deepEqual(findContrastWarnings(tokens, 'light'), [], 'a light-scoped theme never meets the dark base');
  assert.deepEqual(findContrastWarnings(tokens, 'dark').map(({ appearance }) => appearance), ['dark']);
  assert.deepEqual(
    findContrastWarnings(tokens, 'system').map(({ appearance }) => appearance),
    ['dark'],
    'a system theme meets both bases, and the warning says which of them it fails on',
  );
});

test('a reference is followed through the file before the base is consulted', () => {
  // `--foreground: var(--background)` is a real way to write an unreadable theme,
  // and both sides have to be the file's values for the pair to mean anything.
  // The page is dark on purpose: the base's own `--background` is near-white, so
  // a resolver that read the target out of the base instead of out of the file
  // would find a light ink that passes — and report nothing.
  const warnings = findContrastWarnings(
    new Map<string, ThemeColorValue>([
      ['--foreground', { kind: 'reference', target: '--background' }],
      ['--background', { kind: 'literal', triplet: '0 0% 8%' }],
    ]),
    'light',
  );

  assert.deepEqual(
    described(warnings),
    ['light --foreground on --background', 'light --muted-foreground on --background'],
    'the text on its own page, and the base\'s secondary text on the page the theme made near-black',
  );
  assert.equal(warnings[0].ratio.toFixed(2), '1.00', 'the text and the page behind it are the same colour');
});

test('a value only the stylesheet could resolve is not guessed at', () => {
  // A palette reference is legal and the base table does not hold it: the value
  // arrives through the cascade, which this has no browser to follow.
  assert.deepEqual(
    findContrastWarnings(
      new Map<string, ThemeColorValue>([['--foreground', { kind: 'reference', target: '--palette-sand-950' }]]),
      'light',
    ),
    [],
    'silence is not a pass — the pair is left unchecked rather than measured against the wrong colour',
  );
});

test('a reference cycle resolves to nothing rather than hanging', () => {
  assert.deepEqual(
    findContrastWarnings(
      new Map<string, ThemeColorValue>([
        ['--foreground', { kind: 'reference', target: '--background' }],
        ['--background', { kind: 'reference', target: '--foreground' }],
      ]),
      'light',
    ),
    [],
    'neither side ever names a colour, so there is nothing to measure',
  );
});

test('the base table answers for every token the pairs name', () => {
  // A token missing here would not fail loudly: the pair would resolve one side
  // to null and be skipped, which looks exactly like a theme that passes.
  const named = new Set(CONTRAST_PAIRS.flatMap(({ ink, surface }) => [ink, surface]));

  for (const appearance of ['light', 'dark'] as const) {
    for (const token of named) {
      assert.ok(
        BASE_PAIR_COLORS[appearance][token],
        `the ${appearance} base has to answer for ${token}, named by a pair`,
      );
    }
  }
});

test('the ratio is the one the browser paints, not the one the arithmetic starts from', () => {
  // The base's tightest pair, which is also the one that moved a palette step in
  // 1-H. Rounded to whole channels it is 4.62 — the number the browser-backed
  // suite measures — while the unrounded arithmetic gives 4.59. A warning that
  // disagreed with the guard about a borderline theme would be worse than none.
  assert.equal(
    contrastRatioOfTriplets(
      BASE_PAIR_COLORS.light['--muted-foreground'],
      BASE_PAIR_COLORS.light['--background'],
    )?.toFixed(2),
    '4.62',
  );
  assert.equal(contrastRatioOfTriplets('210 40% 98%', '175 84% 32%')?.toFixed(2), '3.49');
  assert.equal(
    contrastRatioOfTriplets('#ffffff', '44 22% 96%'),
    null,
    'a value that is not a triplet has no ratio, rather than a wrong one',
  );
  assert.equal(
    contrastRatioOfTriplets('0.5rem', '44 22% 96%'),
    null,
    'and a value with too few numbers has none either — read as a triplet it would be NaN, not silence',
  );
});
