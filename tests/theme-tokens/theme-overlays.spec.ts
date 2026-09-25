import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BUILTIN_THEMES } from '@/shared/constants';

/**
 * The overlay contract.
 *
 * `cc-light` / `cc-dark` carry no overlay: they *are* the base palette the
 * stylesheet declares in `:root` / `.dark`, and the document falls back to one
 * of them whenever no overlay is picked. Every other built-in theme is an
 * overlay selected by `<html data-theme>` (see `BUILTIN_THEMES`), so the two
 * things this suite has to hold are:
 *
 * 1. **The overlay wins.** Its declarations must resolve as written in the
 *    browser, rather than being shadowed by another declaration of the same
 *    token. Note what this does *not* prove: in the processed stylesheet the
 *    base palette is not actually inside a `@layer` (Tailwind v3 flattens the
 *    source's `@layer base` into plain rules, measured at 0 `@layer` at-rules in
 *    both the fixture and the build), so today the win rests on document order.
 *    The design's rule — overlays are plain CSS, never inside a `@layer` — is
 *    therefore enforced *structurally* below, and is a robustness constraint
 *    rather than something the resolved values can evidence: a layered overlay
 *    would be ordered into that layer's bucket, and which way that falls depends
 *    on the layer order (later layers beat earlier ones; only unlayered beats
 *    all of them).
 * 2. **It wins by exactly as much as `coverage` claims.** An `accent` theme is
 *    allowed to move the accent family and the surfaces derived from it, and
 *    nothing else — no substrate, terminal, editor or graph token. That is the
 *    promise the selector's badge makes to the user, so it is asserted token by
 *    token rather than eyeballed.
 *
 * The overrides themselves are read out of the overlay block, so a change to a
 * theme's values flows into the expectations without a second hand-maintained
 * list.
 */

const STYLESHEET_PATH = fileURLToPath(new URL('../../src/index.css', import.meta.url));

/** Comments would otherwise contribute braces and `--x:` names to the scans below. */
const CSS = readFileSync(STYLESHEET_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const OVERLAY_THEMES = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

type TokenRead = { tokens: Record<string, string>; rendered: Record<string, string> };
type Appearance = 'light' | 'dark';

const APPEARANCES: Appearance[] = ['light', 'dark'];

/**
 * The surfaces each coverage class is about. `accent` may move *only* the
 * accent family; `full` is expected to reach substrate, terminal and graph as
 * well, and must leave the near-neutral compatibility scale alone — those ramps
 * are the Tailwind skeleton's waypoint, and a theme that retints them would be
 * silently changing ~1.5k utility sites rather than the surfaces it advertises.
 */
const SURFACES: Record<string, string[]> = {
  substrate: [
    '--background',
    '--foreground',
    '--card',
    '--popover',
    '--border',
    '--input',
    '--muted',
    '--muted-foreground',
    '--secondary',
    '--accent',
    '--nav-glass-bg',
    '--nav-divider-color',
    '--nav-input-bg',
  ],
  terminal: [
    '--term-background',
    '--term-foreground',
    '--term-cursor',
    '--term-selection-bg',
    '--term-ansi-red',
    '--term-ansi-bright-cyan',
    '--term-error',
  ],
  editor: [
    '--editor-bg',
    '--editor-fg',
    '--editor-gutter-bg',
    '--editor-panel-bg',
    '--editor-toolbar-fg',
    '--editor-loading-bg',
  ],
  graph: ['--graph-lane-1', '--graph-lane-5', '--graph-lane-10'],
  compatScale: ['--n-gray-100', '--n-gray-700', '--n-white', '--n-black'],
};

const ACCENT_SURFACES = ['--primary', '--ring', '--nav-tab-glow', '--nav-input-focus-ring'];

/** Which surface families each coverage class promises to move. */
const MUST_MOVE: Record<string, string[]> = {
  accent: ACCENT_SURFACES,
  full: [...SURFACES.substrate, ...SURFACES.terminal, ...SURFACES.graph],
};

/** Which surface families it promises *not* to move. */
const MUST_NOT_MOVE: Record<string, string[]> = {
  accent: [
    ...SURFACES.substrate,
    ...SURFACES.terminal,
    ...SURFACES.editor,
    ...SURFACES.graph,
    ...SURFACES.compatScale,
  ],
  full: [...SURFACES.compatScale],
};

/** The index of the `{` opening the rule whose selector starts at `from`. */
function openBraceAfter(from: number): number {
  return CSS.indexOf('{', from);
}

/** How many `@layer` blocks enclose `index`, by brace matching. */
function layerDepthAt(index: number): number {
  const enclosing: boolean[] = [];
  let opensLayer = false;

  for (let i = 0; i < index; i += 1) {
    const character = CSS[i];
    if (character === '{') {
      enclosing.push(opensLayer);
      opensLayer = false;
    } else if (character === '}') {
      enclosing.pop();
    } else if (character === '@') {
      const atRule = /^@(layer|media|supports|container|scope)\b/.exec(CSS.slice(i, i + 20));
      if (atRule) opensLayer = atRule[1] === 'layer';
    }
  }

  return enclosing.filter(Boolean).length;
}

type Overlay = {
  /** `--token: value` pairs the overlay block declares. */
  declared: Record<string, string>;
  /** The overrides that replace an existing base value, as `[name, baseValue]`. */
  replaced: [string, string][];
  /** Line number of the block, for failure messages. */
  line: number;
};

function readOverlay(themeId: string, baseTokens: Record<string, string>): Overlay {
  const selector = `[data-theme="${themeId}"]`;
  const start = CSS.indexOf(selector);
  expect(start, `${selector} is not declared in src/index.css`).toBeGreaterThan(-1);

  const body = CSS.slice(openBraceAfter(start) + 1, CSS.indexOf('}', start));
  const declared: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declared[match[1]] = match[2].trim();
  }

  const replaced = Object.entries(declared)
    .filter(([name]) => name in baseTokens)
    .map(([name]) => [name, baseTokens[name]] as [string, string]);

  return { declared, replaced, line: CSS.slice(0, start).split('\n').length };
}

/**
 * The tokens an overlay is *allowed* to move: the ones it redeclares, plus
 * every token whose base value mentions a value it replaced (the L2 tokens that
 * resolve through an overridden L1 family — `--primary` through
 * `--palette-brand-500`, `--nav-tab-glow` through the same family with alpha,
 * and so on).
 */
function derivedMoves(
  baseTokens: Record<string, string>,
  replaced: [string, string][],
): Set<string> {
  const allowed = new Set<string>();
  for (const [name, baseValue] of replaced) {
    allowed.add(name);
    for (const [token, value] of Object.entries(baseTokens)) {
      if (value.includes(baseValue)) allowed.add(token);
    }
  }
  return allowed;
}

async function read(
  page: Page,
  themeId: string | null,
  appearance: Appearance,
): Promise<TokenRead> {
  return page.evaluate(
    ({ id, ap }) => window.__THEME_TOKENS__!.readWithTheme(id, ap),
    { id: themeId, ap: appearance },
  );
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

function differing(base: Record<string, string>, other: Record<string, string>): string[] {
  return Object.keys(base).filter((name) => base[name] !== other[name]);
}

test('every overlay theme is declared outside any @layer', () => {
  expect(OVERLAY_THEMES.length, 'no overlay theme is registered').toBeGreaterThan(0);

  const layered: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    const selector = `[data-theme="${theme.id}"]`;
    const start = CSS.indexOf(selector);
    expect(start, `${selector} is not declared in src/index.css`).toBeGreaterThan(-1);
    if (layerDepthAt(start) > 0) layered.push(selector);
  }

  expect(
    layered,
    `overlays must be declared outside any @layer (an overlay inside one is ordered into that ` +
      `layer's bucket, so whether it wins depends on the layer order):\n${layered.join('\n')}`,
  ).toEqual([]);
});

test('an overlay may only redeclare tokens the base stylesheet declares', async ({ page }) => {
  await openFixture(page);
  const base = await read(page, null, 'light');

  const unknown: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    const overlay = readOverlay(theme.id, base.tokens);
    expect(Object.keys(overlay.declared).length, `${theme.id} declares no tokens`).toBeGreaterThan(0);
    for (const name of Object.keys(overlay.declared)) {
      // A name the base does not declare would enter the token baseline from the
      // overlay alone and read as empty on `<html>` — the baseline suite would
      // report it as uncovered, so it is rejected here with a clearer message.
      if (!(name in base.tokens)) unknown.push(`${theme.id} declares ${name}`);
    }
  }

  expect(unknown, `overlay tokens with no base declaration:\n${unknown.join('\n')}`).toEqual([]);
});

for (const theme of OVERLAY_THEMES) {
  test(`${theme.id} (${theme.coverage}) wins in both appearances, and by exactly its declared reach`, async ({ page }) => {
    await openFixture(page);

    for (const appearance of APPEARANCES) {
      const base = await read(page, null, appearance);
      const themed = await read(page, theme.id, appearance);
      const overlay = readOverlay(theme.id, base.tokens);

      // 1. The declarations resolve as written — the overlay is not shadowed by
      //    another declaration of the same token in the processed stylesheet.
      const unresolved = Object.entries(overlay.declared)
        .filter(([name, value]) => themed.tokens[name] !== value)
        .map(([name, value]) => `${name}: declared ${value}, resolved ${themed.tokens[name]}`);

      // 2. Nothing beyond the reach `coverage` advertises moved.
      const moved = new Set(differing(base.tokens, themed.tokens));
      const allowed = derivedMoves(base.tokens, overlay.replaced);
      const beyondReach = [...moved].filter((name) => !allowed.has(name));

      expect(
        unresolved,
        `${theme.id} overlay is shadowed in ${appearance}:\n${unresolved.join('\n')}`,
      ).toEqual([]);

      const mustMove = MUST_MOVE[theme.coverage ?? 'full'].filter((name) => !moved.has(name));
      const mustNotMove = MUST_NOT_MOVE[theme.coverage ?? 'full'].filter((name) => moved.has(name));

      expect(
        mustMove,
        `${theme.id} claims coverage "${theme.coverage}" but left these unchanged in ${appearance}:\n${mustMove.join('\n')}`,
      ).toEqual([]);
      expect(
        mustNotMove,
        `${theme.id} (coverage "${theme.coverage}") moved surfaces it does not advertise:\n${mustNotMove.join('\n')}`,
      ).toEqual([]);
      expect(
        beyondReach,
        `${theme.id} moved tokens outside its reach in ${appearance}:\n${beyondReach.join('\n')}`,
      ).toEqual([]);
    }
  });
}

test('the accent theme is the identity when no overlay is picked', async ({ page }) => {
  await openFixture(page);

  // The regression this guards: `data-theme` is written by ThemeContext on every
  // appearance change, and the two appearance defaults are the ids it writes
  // when nothing is picked. They carry no overlay, so the document must resolve
  // to the untouched base palette.
  for (const appearance of APPEARANCES) {
    const base = await read(page, null, appearance);
    for (const defaultTheme of BUILTIN_THEMES.filter((t) => t.appearance !== 'system')) {
      const themed = await read(page, defaultTheme.id, appearance);
      expect(
        differing(base.tokens, themed.tokens),
        `the default theme ${defaultTheme.id} is expected to carry no overlay of its own`,
      ).toEqual([]);
    }
  }
});
