import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { GRAPH_LANE_COUNT, laneTint } from '@/modules/git-panel/utils/commitGraph';

/**
 * The History view's commit-graph lanes now come from `--graph-lane-1..10`
 * (see `commitGraph.ts`), which the stylesheet derives from an HSL palette.
 * This suite pins the whole chain — declaration, browser resolution and the
 * `hsl(var(--graph-lane-N))` shape the JS hands to SVG — back to the hex array
 * the graph shipped with, because phase 0 promises it renders exactly as before.
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

