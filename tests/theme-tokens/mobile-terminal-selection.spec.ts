import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The mobile long-press selection chrome (handle + context menu) is inline CSS
 * that `mobileTerminalSelection.ts` writes onto elements it creates. It sits on
 * the terminal board, and the board follows the appearance, so the chrome has to
 * as well: the ring, the menu surface, its hairline and its label resolve
 * through tokens the appearance flips, while the brand fill and the two black
 * shadows stay put. This suite pins what the browser paints, per appearance, on
 * both engines.
 */

/**
 * The resolved colour in the browser's own serialisation (`#3b82f6` ->
 * `rgb(59, 130, 246)`), kept resolved on purpose: a failure should read as "the
 * menu changed colour", not as "two spellings of the same colour differ".
 *
 * The dark column is close to what the old appearance-agnostic literals painted
 * — the drift is the tint Tailwind's blue-grey `gray-800` carried, which the ink
 * ramp does not — and the light column is new, because the old chrome only ever
 * had one palette.
 */
const EXPECTED: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    handleBackground: 'rgb(59, 130, 246)', // --palette-brand-400
    handleBorder: '2px solid rgb(13, 11, 8)', // --foreground (sand-950)
    handleBoxShadow: 'rgba(0, 0, 0, 0.3) 0px 2px 8px 0px',
    menuBackground: 'rgb(235, 234, 229)', // --muted (sand-100)
    menuBorder: '1px solid rgba(13, 11, 8, 0.12)', // --foreground / 0.12
    menuBoxShadow: 'rgba(0, 0, 0, 0.4) 0px 6px 20px 0px',
    buttonColor: 'rgb(13, 11, 8)', // --foreground
  },
  dark: {
    handleBackground: 'rgb(59, 130, 246)',
    handleBorder: '2px solid rgb(239, 238, 236)', // --foreground (ink-100)
    handleBoxShadow: 'rgba(0, 0, 0, 0.3) 0px 2px 8px 0px',
    menuBackground: 'rgb(43, 43, 43)', // --muted (ink-850)
    menuBorder: '1px solid rgba(239, 238, 236, 0.12)',
    menuBoxShadow: 'rgba(0, 0, 0, 0.4) 0px 6px 20px 0px',
    buttonColor: 'rgb(239, 238, 236)',
  },
};

const APPEARANCES = ['light', 'dark'] as const;

/** The luminance of a `rgb(...)` string, so a flip can be asserted in one direction. */
function luma(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

async function readChrome(
  page: Page,
  appearance: 'light' | 'dark',
): Promise<Record<string, string>> {
  return page.evaluate((next) => {
    window.__THEME_TOKENS__!.read(next);
    return window.__THEME_TOKENS__!.readMobileSelectionChrome();
  }, appearance);
}

test('the selection chrome paints the tokens the appearance resolves', async ({ page }) => {
  await openFixture(page);

  const drifts: string[] = [];
  for (const appearance of APPEARANCES) {
    const chrome = await readChrome(page, appearance);
    for (const [property, expected] of Object.entries(EXPECTED[appearance])) {
      if (chrome[property] !== expected) {
        drifts.push(
          `${appearance}.${property}: expected ${expected}, got ${String(chrome[property])}`,
        );
      }
    }
  }

  expect(drifts, `selection chrome drifted:\n${drifts.join('\n')}`).toEqual([]);
});

test('the selection chrome follows the appearance, and the brand fill does not', async ({ page }) => {
  await openFixture(page);

  const light = await readChrome(page, 'light');
  const dark = await readChrome(page, 'dark');

  // The direction is asserted, not just "they differ": swapping the two halves
  // would leave a bare inequality green. The surface lightens with the page and
  // the label darkens, which is the same inversion the rest of the app makes.
  expect(luma(light.menuBackground)).toBeGreaterThan(luma(dark.menuBackground));
  expect(luma(light.buttonColor)).toBeLessThan(luma(dark.buttonColor));
  expect(light.handleBorder).not.toEqual(dark.handleBorder);
  expect(light.menuBorder).not.toEqual(dark.menuBorder);

  // The fill is the brand colour, which describes the owner rather than the
  // board, so it stays put — the guard that keeps "follows the appearance" from
  // quietly becoming "everything moves".
  expect(light.handleBackground).toEqual(dark.handleBackground);
});
