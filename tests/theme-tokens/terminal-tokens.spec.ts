import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ITheme } from '@xterm/xterm';

/**
 * The terminal's colours live in the stylesheet (`--term-*`), but xterm paints
 * into a canvas and needs concrete values, so `useShellTerminal` resolves them
 * at runtime through `readTerminalTheme`. This suite pins that whole chain —
 * declaration, browser resolution and the JS mapping — back to the hex board the
 * terminal shipped with, because phase 0 promises it renders exactly as before.
 */

/**
 * The board as it was hardcoded in `useShellTerminal.ts` before tokenization.
 * Kept in hex on purpose: a failure should read as "the terminal changed
 * colour", not as "two HSL triplets differ in the third decimal".
 */
const ORIGINAL_BOARD = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
} satisfies Partial<ITheme>;

/** Each semantic alias and the ANSI colour it must mirror. */
const SEMANTIC_ALIASES: Record<string, string> = {
  '--term-error': '--term-ansi-red',
  '--term-success': '--term-ansi-green',
  '--term-warning': '--term-ansi-yellow',
  '--term-info': '--term-ansi-blue',
};

function hexToRgb(hex: string): string {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgb(${channels.join(', ')})`;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

async function readTerminalTheme(page: Page, appearance: 'light' | 'dark'): Promise<ITheme> {
  return page.evaluate((next) => {
    window.__THEME_TOKENS__!.read(next);
    return window.__THEME_TOKENS__!.readTerminalTheme();
  }, appearance);
}

test('the resolved terminal theme still renders the pre-tokenization board', async ({ page }) => {
  await openFixture(page);

  const theme = await readTerminalTheme(page, 'dark');
  const resolved = new Map<string, unknown>(Object.entries(theme));

  expect(Object.keys(theme).sort()).toEqual(Object.keys(ORIGINAL_BOARD).sort());

  const drifts: string[] = [];
  for (const [key, hex] of Object.entries(ORIGINAL_BOARD)) {
    const expected = hexToRgb(hex);
    if (resolved.get(key) !== expected) {
      drifts.push(`${key}: expected ${expected}, got ${String(resolved.get(key))}`);
    }
  }

  expect(drifts, `terminal colours drifted:\n${drifts.join('\n')}`).toEqual([]);
});

test('the semantic aliases resolve to their ANSI counterpart', async ({ page }) => {
  await openFixture(page);

  const { rendered } = await page.evaluate(() => window.__THEME_TOKENS__!.read('dark'));

  const mismatches = Object.entries(SEMANTIC_ALIASES)
    .filter(([alias, source]) => rendered[alias] !== rendered[source])
    .map(([alias, source]) => `${alias} = ${rendered[alias]}, ${source} = ${rendered[source]}`);

  expect(mismatches, `semantic aliases drifted:\n${mismatches.join('\n')}`).toEqual([]);
});

test('the terminal board is the same in light and dark', async ({ page }) => {
  await openFixture(page);

  // The board stays dark in both appearances during this phase: a light
  // terminal is a theme's decision, so the two maps must be identical.
  expect(await readTerminalTheme(page, 'light')).toEqual(await readTerminalTheme(page, 'dark'));
});

/**
 * `extendedAnsi` used to overwrite 256-colour slots 16-31 with a VGA palette.
 * Those slots are the first 16 entries of the 6x6x6 cube, so overriding them
 * corrupts the cube rather than defining a second ANSI ramp; dropping the field
 * hands the slots back to xterm. This is the one intentional rendering
 * difference of the terminal tokenization, recorded in the design document.
 */
test('extendedAnsi is no longer overridden', async ({ page }) => {
  await openFixture(page);

  expect((await readTerminalTheme(page, 'dark')).extendedAnsi).toBeUndefined();
});
