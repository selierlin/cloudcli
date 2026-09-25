import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Token contract gate for the stylesheet.
 *
 * The baseline is the checked-in ground truth for every resolved token value in
 * both appearances. A palette refactor (rewriting `--background: 44 22% 96%` into
 * `--background: var(--palette-sand-50)`) is only provably neutral if the
 * resolved values are byte-identical afterwards — the browser does the
 * resolution, so this suite compares exactly that.
 *
 * Regenerate the baseline only when a token change is intended:
 *
 *   UPDATE_THEME_BASELINE=1 npm run test:theme-tokens
 */

const BASELINE_PATH = fileURLToPath(new URL('./token-baseline.json', import.meta.url));
const STYLESHEET_PATH = fileURLToPath(new URL('../../src/index.css', import.meta.url));

const UPDATE_BASELINE = process.env.UPDATE_THEME_BASELINE === '1';

type Appearance = 'light' | 'dark';

type TokenRead = {
  tokens: Record<string, string>;
  rendered: Record<string, string>;
};

type Snapshot = Record<Appearance, TokenRead>;

const APPEARANCES: Appearance[] = ['light', 'dark'];

/** `44 22% 96%`, `36 25% 4%`, `0 0% 17% / 0.5` — the shape of a colour token. */
const HSL_TRIPLET = /^(?:\d+(?:\.\d+)?%?\s+){2}\d+(?:\.\d+)?%(?:\s*\/\s*[\d.]+%?)?$/;

const PALETTE_PREFIX = '--palette-';

function readStylesheet(): string {
  return readFileSync(STYLESHEET_PATH, 'utf8');
}

async function captureSnapshot(page: Page): Promise<Snapshot> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));

  return page.evaluate(() => ({
    light: window.__THEME_TOKENS__!.read('light'),
    dark: window.__THEME_TOKENS__!.read('dark'),
  }));
}

function readBaseline(): Snapshot {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Snapshot;
}

/** Token values must not move: this is the "no visual change" promise, measured. */
test('resolved token values match the checked-in baseline', async ({ page }) => {
  const actual = await captureSnapshot(page);

  if (UPDATE_BASELINE) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  const baseline = readBaseline();
  const drifts: string[] = [];

  for (const appearance of APPEARANCES) {
    const expectedTokens = baseline[appearance].tokens;
    const actualTokens = actual[appearance].tokens;

    for (const [name, expected] of Object.entries(expectedTokens)) {
      const got = actualTokens[name];
      if (got !== expected) {
        drifts.push(`${appearance} ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      }
    }

    for (const [token, expected] of Object.entries(baseline[appearance].rendered)) {
      const got = actual[appearance].rendered[token];
      if (got !== expected) {
        drifts.push(`${appearance} rendered ${token}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      }
    }
  }

  expect(drifts, `token values drifted:\n${drifts.join('\n')}`).toEqual([]);
});

/** Nothing may be added to the contract without an explicit baseline update. */
test('baseline covers every token the stylesheet declares', async ({ page }) => {
  const actual = await captureSnapshot(page);
  const baseline = readBaseline();

  const uncovered: string[] = [];
  for (const appearance of APPEARANCES) {
    for (const name of Object.keys(actual[appearance].tokens)) {
      if (!(name in baseline[appearance].tokens)) {
        uncovered.push(`${appearance} ${name}`);
      }
    }
  }

  expect(
    uncovered,
    `tokens present in the stylesheet but missing from the baseline:\n${uncovered.join('\n')}\n` +
      'Regenerate with: UPDATE_THEME_BASELINE=1 npm run test:theme-tokens',
  ).toEqual([]);
});

/**
 * The palette indirection must be real: an L1 token nothing consumes is the
 * exact failure mode this refactor exists to prevent, because overriding it
 * would silently change nothing.
 *
 * This reads declarations rather than resolved values: `getComputedStyle`
 * expands `var()` before returning, so an indirection is invisible there.
 */
test('every palette token is consumed by at least one declaration', () => {
  const css = readStylesheet();

  const declared = [...css.matchAll(/^[ \t]*(--palette-[a-z0-9-]+)\s*:/gm)].map((match) => match[1]);
  expect(declared.length, 'the stylesheet declares no palette tokens').toBeGreaterThan(0);

  const consumed = new Set([...css.matchAll(/var\(\s*(--palette-[a-z0-9-]+)/g)].map((match) => match[1]));

  const orphans = declared.filter((name) => !consumed.has(name));
  expect(orphans, `palette tokens no declaration references:\n${orphans.join('\n')}`).toEqual([]);
});

/**
 * Colour declarations must resolve through the palette rather than hold a
 * literal. Size, duration and env() tokens are out of scope; only HSL triplets
 * are classified as colours. Reads declaration text for the same reason as
 * above.
 */
test('no colour token holds a literal value outside the palette', () => {
  const css = readStylesheet();
  const literals: string[] = [];

  for (const match of css.matchAll(/^[ \t]*(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gm)) {
    const [, name, rawValue] = match;
    const value = rawValue.trim();
    if (name.startsWith(PALETTE_PREFIX)) continue;
    if (!HSL_TRIPLET.test(value)) continue;
    literals.push(`${name}: ${value}`);
  }

  expect(
    literals,
    `colour tokens still holding literal values instead of var(--palette-*):\n${literals.join('\n')}`,
  ).toEqual([]);
});
