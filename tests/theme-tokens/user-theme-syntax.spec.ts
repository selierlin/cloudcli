import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Syntax slots under a user theme, in a real engine.
 *
 * Three questions can only be settled by a browser, and the jsdom suites cannot
 * ask any of them:
 *
 * 1. **Does an overlay naming a syntax slot actually win?** The slot resolves
 *    through `var()`, the base sheet is injected ahead of `<head>`'s content, and
 *    an overlay is appended to it — a document-order question, as
 *    `user-theme-tmtheme.spec.ts` argues for `.tmTheme` files. This spec asks the
 *    same of option A's `.json` and adds the negative control that suite lacks: a
 *    base sheet *appended* has to take the slot back, or the ordering claim is
 *    vacuous.
 * 2. **Which element carries the block's body colour?** The contract binds
 *    `--cc-syntax-block-foreground` to `pre[class*="language-"].color`, on the
 *    argument that both consumers replace `react-syntax-highlighter`'s
 *    `codeTagProps` and so the `code[…]` family never lands. Reading *both*
 *    elements is what shows the choice is right: a probe that read only one of
 *    them would pass just as happily with the token bound to the wrong one.
 * 3. **Is anything on the twelve `::selection` slots?** The sheet keys them by
 *    selector while the library looks colours up by class name, so they should
 *    have no channel to the page at all. That is a claim about a *browser*, so it
 *    is settled here by painting: a rule of our own does change the highlight,
 *    which is what shows the channel is live — and the colour this sheet states
 *    for that pseudo-element is not the one the engine paints, which is what
 *    shows nothing is on it.
 */

const FIXTURE_ID = 'user-fixture';

/** `#d55fde` — Vivid's magenta; no palette in this repo carries it. */
const KEYWORD_COLOUR = 'rgb(213, 95, 222)';
/** `#61afef` — One Dark's function blue, used here as a body colour nothing else has. */
const BLOCK_COLOUR = 'rgb(97, 175, 239)';

const THEME_BODY = JSON.stringify({
  tokens: {
    '--cc-syntax-keyword-color': '#d55fde',
    '--cc-syntax-block-foreground': '#61afef',
  },
});

const BLOCK_PROBE = '#cc-code-block-probe';
const BLOCK_TEXT = `${BLOCK_PROBE} code`;

/** Puts a `::selection` rule of our own in the document, or takes it away with `null`. */
async function setSelectionRule(page: Page, background: string | null): Promise<void> {
  await page.evaluate((colour) => {
    const id = 'cc-selection-probe';
    if (colour === null) {
      document.getElementById(id)?.remove();
      return;
    }
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement('style');
      element.id = id;
      document.head.appendChild(element);
    }
    element.textContent = `#cc-code-block-probe code::selection { background: ${colour}; }`;
  }, background);
}

/**
 * The colour most of an element's pixels are, as `"r,g,b"`.
 *
 * Under a selection that is the highlight: a code block is mostly glyphs, but the
 * highlight covers the whole line box, so it is the dominant colour by a wide
 * margin (measured: ~89% of the crop). Taking the dominant colour rather than
 * counting hits on a fixed value also side-steps the engines' own compositing —
 * Chromium paints `rgb(255,0,0)` as `254,50,50` — which is enough to make a
 * fixed-colour count report zero on a rule that plainly did land.
 */
async function dominantColour(page: Page, selector: string): Promise<string> {
  const png = await page.locator(selector).screenshot();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });

  const counts = new Map<string, number>();
  for (let index = 0; index < data.length; index += info.channels) {
    const key = `${data[index]},${data[index + 1]},${data[index + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts].sort((left, right) => right[1] - left[1])[0][0];
}

test('a token theme can name a syntax slot, and the base sheet cannot take it back', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async ({ id, body }) => {
    const api = window.__THEME_TOKENS__!;
    const base = api.readSyntaxToken('keyword');

    await api.applyUserTheme({ id, fileName: 'fixture.json', format: 'json', css: body });
    const themed = api.readSyntaxToken('keyword');

    // The base sheet arriving late, at the front where the module puts it.
    api.reinjectSyntaxStyleSheet();
    return { base, themed, afterLateBase: api.readSyntaxToken('keyword') };
  }, { id: FIXTURE_ID, body: THEME_BODY });

  expect(result.themed, 'the slot is addressed through SYNTAX_TOKEN_MAP, so the theme’s colour has to arrive').toBe(
    KEYWORD_COLOUR,
  );
  expect(result.base, 'the base palette has a keyword colour of its own').not.toBe(KEYWORD_COLOUR);
  expect(
    result.afterLateBase,
    'the base sheet is inserted ahead of any overlay, so arriving late cannot take the override away',
  ).toBe(KEYWORD_COLOUR);
});

test('that ordering claim has teeth: a base sheet appended last takes the slot back', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async ({ id, body }) => {
    const api = window.__THEME_TOKENS__!;
    const base = api.readSyntaxToken('keyword');

    await api.applyUserTheme({ id, fileName: 'fixture.json', format: 'json', css: body });
    const wins = api.readSyntaxToken('keyword');

    // Same declarations, landed after the overlay instead of before it.
    api.reinjectSyntaxStyleSheet('last');
    const loses = api.readSyntaxToken('keyword');

    api.reinjectSyntaxStyleSheet();
    return { base, wins, loses, restored: api.readSyntaxToken('keyword') };
  }, { id: FIXTURE_ID, body: THEME_BODY });

  expect(result.wins).toBe(KEYWORD_COLOUR);
  expect(
    result.loses,
    'appended after the overlay, the base sheet has to win — that is what the production insertion order exists to prevent',
  ).toBe(result.base);
  expect(result.restored).toBe(KEYWORD_COLOUR);
});

test('the block body colour is what both <pre> and <code> paint, and it falls back together', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async ({ id, body }) => {
    const api = window.__THEME_TOKENS__!;
    const base = api.readCodeBlockColours();

    await api.applyUserTheme({ id, fileName: 'fixture.json', format: 'json', css: body });
    const themed = api.readCodeBlockColours();

    // Take the one declaration back out of the theme's own sheet: what the page
    // shows afterwards is the layer underneath, which is the base palette.
    const removed = api.removeDeclaration('style[data-cloudcli-user-theme]', '--cc-syntax-block-foreground');
    const afterRemoval = api.readCodeBlockColours();

    return { base, themed, afterRemoval, removed };
  }, { id: FIXTURE_ID, body: THEME_BODY });

  expect(result.base.pre, 'the base palette declares this slot in both appearances').not.toBe('');
  expect(result.base.code, '<code> carries no colour of its own, so it inherits this one').toBe(result.base.pre);

  expect(result.themed.pre, 'the theme moved the slot, so the block moved with it').toBe(BLOCK_COLOUR);
  expect(result.themed.code, 'and both elements moved together').toBe(BLOCK_COLOUR);

  expect(result.removed, 'the declaration has to have been there to be removed').toBeGreaterThan(0);
  expect(
    result.afterRemoval.pre,
    'removing it has to fall back to the base value — if <pre> kept the theme colour, the token is not what paints it',
  ).toBe(result.base.pre);
  expect(
    result.afterRemoval.code,
    '<code> falls back with <pre> rather than on a path of its own: it is inheriting, not declaring',
  ).toBe(result.base.pre);
});

test('the ::selection slots have a live channel with nothing of the Prism sheet on it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__THEME_TOKENS__!.readCodeBlockColours());
  await page.locator(BLOCK_TEXT).selectText();

  const fallback = await dominantColour(page, BLOCK_TEXT);

  // A rule of our own does reach the page, so the channel is live: the highlight
  // changes colour when one is in the document.
  await setSelectionRule(page, 'rgb(255, 0, 0)');
  const forced = await dominantColour(page, BLOCK_TEXT);

  // And the engine paints the Prism sheet's own selection colour as something
  // else again — so a live channel would be visible here if anything used it.
  await setSelectionRule(page, 'hsl(220, 13%, 28%)');
  const prismSlot = await dominantColour(page, BLOCK_TEXT);

  await setSelectionRule(page, null);
  const restored = await dominantColour(page, BLOCK_TEXT);

  expect(forced, 'a ::selection rule of ours has to be able to change the highlight').not.toBe(fallback);
  expect(
    prismSlot,
    'the Prism slot colour has to paint differently from the engine default — otherwise this probe could not tell the two apart',
  ).not.toBe(fallback);
  expect(prismSlot, 'and the two forced colours have to be distinguishable from each other').not.toBe(forced);
  expect(
    restored,
    'the engine default is what the page shows with no rule in the document, so nothing is painting the Prism sheet’s selection colour',
  ).toBe(fallback);
});
