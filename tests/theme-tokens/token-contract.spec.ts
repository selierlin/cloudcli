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
 * literal. The net covers every literal colour shape a declaration can carry —
 * HSL triplets, hex and rgb()/rgba() — with two explicit exemptions. The
 * `--editor-*` board is written into `EditorView.theme()` rules that consume
 * complete CSS values, and 0-D deliberately keeps those as literal colours
 * rather than routing them through the HSL palette (§5.8 v8 states the scope
 * the test name used to overclaim). `--code-block-bg` is the same kind of
 * carrier for one value: the base dark editor page is Prism's One Dark
 * background (`#282c34`), which the palette has no step for, so that half is a
 * literal triplet while every overlay writes the palette entry its
 * `--editor-bg` uses. Font stacks are out of scope too: `--term-font-family`
 * holds a family list, not a colour. Size, duration and env() tokens are out of
 * scope. Reads declaration text for the same reason as above.
 */
test('no colour token holds a literal value outside the palette, the editor board and the code-block panel', () => {
  const css = readStylesheet();
  const literals: string[] = [];

  for (const match of css.matchAll(/^[ \t]*(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gm)) {
    const [, name, rawValue] = match;
    const value = rawValue.trim();
    if (name.startsWith(PALETTE_PREFIX)) continue;
    if (name.startsWith('--editor-')) continue;
    if (name === '--code-block-bg') continue;
    // The terminal board is no longer homogeneous (unlike every other `--term-*`
    // it holds no colour), so it is named here rather than left to the shape
    // filter below — a rewrite of this loop by family would otherwise have to
    // rediscover the exemption (§3.3). The shape filter already skips it today;
    // this line buys visibility, not a red test.
    if (name === '--term-font-family') continue;
    const isLiteralColour =
      HSL_TRIPLET.test(value) || /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\(/.test(value);
    if (!isLiteralColour) continue;
    literals.push(`${name}: ${value}`);
  }

  expect(
    literals,
    `colour tokens still holding literal values instead of var(--palette-*):\n${literals.join('\n')}`,
  ).toEqual([]);
});


/**
 * The touch-device hover-suppression blocks reference utility classes *as
 * selector text*, which no atom scanner sees (the selector-level consumer gap
 * 0-F recorded). The stage-0 rename retired the literal gray atoms and left
 * these selectors dead for the whole user-theme line until the review caught
 * it — this guard is what makes a future rename turn red instead of silently
 * detaching the rules again (§5.8 v8).
 */
test('the touch-hover suppression blocks reference the compatibility scale, not retired atoms', () => {
  const css = readStylesheet();

  const retired = css.match(
    /\.hover\\:bg-(?:gray|zinc|slate|neutral)-\d+|\.hover\\:text-(?:gray|zinc|slate|neutral)-\d+|\.dark\\:hover\\:bg-(?:gray|zinc|slate|neutral)-\d+/g,
  );
  const listed = retired ? retired.join('\n') : '';
  expect(retired, `retired literal atoms still referenced as selectors:\n${listed}`).toBeNull();

  // Anti-embers: the guards must still name the live classes, or the blocks
  // could go quietly empty while this test stays green.
  expect(css).toMatch(/\.hover\\:bg-n-gray-50:hover/);
  expect(css).toMatch(/\.hover\\:bg-n-gray-100:hover/);
  expect(css).toMatch(/\.dark\\:hover\\:bg-n-gray-700:hover/);
  expect(css).toMatch(/\.hover\\:text-n-gray-900:hover/);
});
