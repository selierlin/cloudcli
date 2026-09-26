import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { GRAPH_LANE_COUNT, laneColor, laneTint } from '@/modules/git-panel/utils/commitGraph';

/**
 * The History view's commit-graph lanes now come from `--graph-lane-1..10`
 * (see `commitGraph.ts`), which the stylesheet derives from an HSL palette.
 * This suite pins the whole chain — declaration, browser resolution and the
 * `hsl(var(--graph-lane-N))` shape the JS hands to SVG — back to the hex array
 * the graph shipped with, because phase 0 promises it renders exactly as before.
 *
 * Lanes past the token board are the one deliberate exception (§5.12): instead
 * of wrapping onto lane 1's colour they rotate hue through two stylesheet
 * parameters. Those tests assert the formula resolves as written in a real
 * engine — jsdom does not evaluate `hsl(calc(...))` at all.
 */

/**
 * The palette as it was hardcoded in `commitGraph.ts` before tokenization.
 * Kept in hex on purpose: a failure should read as "a lane changed colour", not
 * as "two HSL triplets differ in the third decimal".
 */
const ORIGINAL_LANES = [
  '#0ea5e9', // sky
  '#f97316', // orange
  '#a855f7', // purple
  '#22c55e', // green
  '#ef4444', // red
  '#eab308', // yellow
  '#14b8a6', // teal
  '#ec4899', // pink
  '#6366f1', // indigo
  '#84cc16', // lime
];

function hexToRgb(hex: string): string {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgb(${channels.join(', ')})`;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

test('the graph lanes render the hex array commitGraph.ts shipped', async ({ page }) => {
  await openFixture(page);

  const { rendered } = await page.evaluate(() => window.__THEME_TOKENS__!.read('light'));

  expect(ORIGINAL_LANES).toHaveLength(GRAPH_LANE_COUNT);

  const drifts = ORIGINAL_LANES.flatMap((hex, index) => {
    const token = `--graph-lane-${index + 1}`;
    const expected = hexToRgb(hex);
    const got = rendered[token];
    return got === expected ? [] : [`${token}: expected ${expected}, got ${String(got)}`];
  });

  expect(drifts, `graph lanes drifted:\n${drifts.join('\n')}`).toEqual([]);
});

test('the graph lane board is the same in light and dark', async ({ page }) => {
  await openFixture(page);

  // The lanes were picked to sit on either background, so like the terminal
  // board they do not vary by appearance: a lane-coloured theme is a theme's
  // decision, not this phase's.
  const light = await page.evaluate(() => window.__THEME_TOKENS__!.read('light').rendered);
  const dark = await page.evaluate(() => window.__THEME_TOKENS__!.read('dark').rendered);

  const mismatches = Array.from(
    { length: GRAPH_LANE_COUNT },
    (_, index) => `--graph-lane-${index + 1}`,
  )
    .filter((token) => light[token] !== dark[token])
    .map((token) => `${token}: light ${String(light[token])}, dark ${String(dark[token])}`);

  expect(mismatches, `graph lanes vary by appearance:\n${mismatches.join('\n')}`).toEqual([]);
});

/**
 * The HEAD ref badge tints its background with the lane colour. It used to
 * append `22` to the hex; `laneTint` spells the same alpha in HSL instead. The
 * reference is rendered alongside rather than hardcoded, so the assertion is
 * "the two paint the same" and not "the alpha string looks right".
 */
test('the ref-badge tint still paints what appending `22` to the hex did', async ({ page }) => {
  await openFixture(page);

  const comparisons = await page.evaluate((tints) => {
    const host = document.createElement('div');
    host.style.setProperty('transition', 'none');
    document.body.appendChild(host);

    const paint = (value: string): string => {
      const el = document.createElement('div');
      el.style.setProperty('transition', 'none');
      el.style.backgroundColor = value;
      host.appendChild(el);
      return getComputedStyle(el).backgroundColor;
    };

    return tints.map(([hex, expression]) => ({
      hex,
      reference: paint(`${hex}22`),
      actual: paint(expression),
    }));
  }, ORIGINAL_LANES.map((hex, index) => [hex, laneTint(index)] as const));

  const drifts = comparisons
    .filter(({ reference, actual }) => reference !== actual)
    .map(({ hex, reference, actual }) => `${hex}22: expected ${reference}, got ${actual}`);

  expect(drifts, `ref-badge tints drifted:\n${drifts.join('\n')}`).toEqual([]);
});

/**
 * §5.12's parametric fallback. The lane expression and the reference spell the
 * same hue two ways — `calc` over the stylesheet's two parameters versus a
 * plain number computed here from those same declared parameters — so two
 * painted elements agreeing is "the formula resolves as written", not a
 * tautology. The anti-wrap property (a fallback lane never repeats one of the
 * ten token colours) is asserted against the token lanes' own resolved values.
 */
test('lanes past the token board rotate hue and never repeat a token lane', async ({ page }) => {
  await openFixture(page);

  const reads = await page.evaluate((data) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const paint = (value: string): string => {
      const el = document.createElement('div');
      el.style.setProperty('transition', 'none');
      el.style.backgroundColor = value;
      host.appendChild(el);
      return getComputedStyle(el).backgroundColor;
    };

    const rootStyle = getComputedStyle(document.documentElement);
    const base = Number(rootStyle.getPropertyValue('--graph-lane-base-hue'));
    const step = Number(rootStyle.getPropertyValue('--graph-lane-hue-step'));

    return {
      base,
      step,
      tokenColors: data.tokenExpressions.map(paint),
      // The lane expressions were built in Node; the references spell the same
      // hue as a plain number computed here from the declared parameters.
      fallbackReads: data.fallback.map(({ lane, color, tint }) => ({
        actual: paint(color),
        reference: paint(`hsl(${base + step * lane} 70% 55%)`),
        tintActual: paint(tint),
        tintReference: paint(`hsl(${base + step * lane} 70% 55% / calc(34 / 255))`),
      })),
    };
  }, {
    tokenExpressions: Array.from(
      { length: GRAPH_LANE_COUNT },
      (_, index) => `hsl(var(--graph-lane-${index + 1}))`,
    ),
    fallback: [10, 11, 12, 13, 14].map((lane) => ({
      lane,
      color: laneColor(lane),
      tint: laneTint(lane),
    })),
  });

  expect(Number.isFinite(reads.base), `--graph-lane-base-hue read as ${reads.base}`).toBe(true);
  expect(Number.isFinite(reads.step), `--graph-lane-hue-step read as ${reads.step}`).toBe(true);

  const drifts: string[] = [];
  reads.fallbackReads.forEach(({ actual, reference, tintActual, tintReference }, index) => {
    const lane = index + GRAPH_LANE_COUNT;
    if (actual !== reference) drifts.push(`lane ${lane + 1}: expected ${reference}, got ${actual}`);
    if (tintActual !== tintReference) {
      drifts.push(`lane ${lane + 1} tint: expected ${tintReference}, got ${tintActual}`);
    }
    if (reads.tokenColors.includes(actual)) {
      drifts.push(`lane ${lane + 1} repeats a token lane's colour: ${actual}`);
    }
  });
  const distinct = new Set(reads.fallbackReads.map(({ actual }) => actual));
  if (distinct.size !== reads.fallbackReads.length) {
    drifts.push('two fallback lanes painted the same colour');
  }

  expect(drifts, `fallback lanes drifted:\n${drifts.join('\n')}`).toEqual([]);
});

/**
 * The two parameters are the contract that lets a theme retune the overflow
 * lanes without touching `commitGraph.ts`; overriding them has to move the
 * fallback colour and nothing else.
 */
test('the hue parameters retune the fallback lanes and leave the token board alone', async ({ page }) => {
  await openFixture(page);

  const reads = await page.evaluate((expressions) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const paint = (value: string): string => {
      const el = document.createElement('div');
      el.style.setProperty('transition', 'none');
      el.style.backgroundColor = value;
      host.appendChild(el);
      return getComputedStyle(el).backgroundColor;
    };

    const root = document.documentElement;
    const before = paint(expressions.fallback);
    const tokenBefore = paint(expressions.token);
    root.style.setProperty('--graph-lane-hue-step', '40');
    const after = paint(expressions.fallback);
    const tokenAfter = paint(expressions.token);
    root.style.removeProperty('--graph-lane-hue-step');
    const restored = paint(expressions.fallback);

    return { before, after, restored, tokenBefore, tokenAfter };
  }, { fallback: laneColor(12), token: laneColor(4) });

  expect(reads.before, 'sanity: fallback lane painted').not.toBe('rgba(0, 0, 0, 0)');
  expect(reads.after).not.toBe(reads.before);
  expect(reads.restored).toBe(reads.before);
  expect(reads.tokenAfter).toBe(reads.tokenBefore);
});

