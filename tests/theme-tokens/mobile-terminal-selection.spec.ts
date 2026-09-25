import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The mobile long-press selection chrome (handle + context menu) is inline CSS
 * that `mobileTerminalSelection.ts` writes onto elements it creates. Its colours
 * used to be literals; they now resolve through tokens, so a theme recolours the
 * chrome along with everything else. This suite pins them back to what the
 * literals painted, in both appearances and on both engines.
 */

/**
 * What the literals resolved to before tokenization, in the browser's own
 * serialisation (`#3b82f6` -> `rgb(59, 130, 246)`). Kept as the resolved colour
 * on purpose: a failure should read as "the menu changed colour", not as "two
 * spellings of the same colour differ".
 */
const EXPECTED: Record<string, string> = {
  handleBackground: 'rgb(59, 130, 246)', // #3b82f6
  handleBorder: '2px solid rgb(255, 255, 255)', // 2px solid #fff
  handleBoxShadow: 'rgba(0, 0, 0, 0.3) 0px 2px 8px 0px', // 0 2px 8px rgba(0,0,0,0.3)
  menuBackground: 'rgb(31, 41, 55)', // #1f2937
  menuBorder: '1px solid rgba(255, 255, 255, 0.12)', // 1px solid rgba(255,255,255,0.12)
  menuBoxShadow: 'rgba(0, 0, 0, 0.4) 0px 6px 20px 0px', // 0 6px 20px rgba(0,0,0,0.4)
  buttonColor: 'rgb(249, 250, 251)', // #f9fafb
};

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

test('the selection chrome paints what its literals did', async ({ page }) => {
  await openFixture(page);

  const chrome = await readChrome(page, 'light');

  const drifts = Object.entries(EXPECTED)
    .filter(([property, expected]) => chrome[property] !== expected)
    .map(
      ([property, expected]) =>
        `${property}: expected ${expected}, got ${String(chrome[property])}`,
    );

  expect(drifts, `selection chrome drifted:\n${drifts.join('\n')}`).toEqual([]);
});

test('the selection chrome does not vary by appearance', async ({ page }) => {
  await openFixture(page);

  // The chrome sits on the terminal, which keeps its dark board in both
  // appearances — a light terminal is a theme's decision, not this phase's.
  expect(await readChrome(page, 'dark')).toEqual(await readChrome(page, 'light'));
});
