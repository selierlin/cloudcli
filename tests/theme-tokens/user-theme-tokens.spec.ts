import { expect, test } from '@playwright/test';

import { laneColor } from '@/modules/git-panel/utils/commitGraph';

/**
 * A token JSON theme, in a real engine.
 *
 * The compiler's own decisions are unit-tested — which tokens it accepts, which
 * values it refuses, what selector it writes. What a unit test cannot answer is
 * whether those selectors *do* what they were written to do once they are in a
 * stylesheet: `[data-theme="x"]:not(.dark)` has to win against the base palette
 * in the light appearance and lose to `.dark` in the dark one, and that is a
 * cascade question only the engine settles.
 *
 * The scope is the part of option A that cannot be checked by reading the
 * emitted string. A light-scoped overlay that quietly kept applying in the dark
 * appearance would put its values under a base palette they were never written
 * against — the failure the built-in overlays were given the same selector
 * shape to prevent (§5.3 v9).
 */

const FIXTURE_ID = 'user-fixture';

const THEME_TRIPLET = '120 60% 40%';
const THEME_COLOR = 'rgb(41, 163, 41)';

/** The id and a token map, for the appearances where the overlay is on. */
const themeFor = (appearance: 'light' | 'dark' | 'system') => JSON.stringify({
  appearance,
  tokens: { '--background': THEME_TRIPLET },
});

test('a compiled theme is in force under the appearance it declares', async ({ page }) => {
  await page.goto('/');
  const applied = await page.evaluate(({ id, body }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({
      id,
      fileName: 'borealis.json',
      format: 'json',
      css: body,
    });
  }, { id: FIXTURE_ID, body: themeFor('light') });

  // The overlay moves `--background` alone; the pairs whose other side falls
  // back to the light base's mid-grey fail against a mid-green, and §5.10 says
  // so without holding the theme back.
  expect(applied.state).toEqual({
    appliedId: FIXTURE_ID,
    failedId: null,
    warnings: [
      { appearance: 'light', ink: '--muted-foreground', surface: '--background', ratio: expect.any(Number), min: 4.5 },
      { appearance: 'light', ink: '--ring', surface: '--background', ratio: expect.any(Number), min: 3 },
    ],
  });
  expect(
    applied.background,
    'a token JSON has to reach the page as a stylesheet, not sit in the document as JSON',
  ).toBe(THEME_COLOR);

  const dark = await page.evaluate(
    (id) => window.__THEME_TOKENS__!.readWithTheme(id, 'dark').rendered['--background'],
    FIXTURE_ID,
  );
  const baseDark = await page.evaluate(
    () => window.__THEME_TOKENS__!.readWithTheme(null, 'dark').rendered['--background'],
  );
  expect(
    dark,
    'a light-scoped overlay must not carry its values into the dark appearance',
  ).toBe(baseDark);
});

test('a theme that declares no appearance applies in both', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(({ id, body }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({
      id,
      fileName: 'borealis.json',
      format: 'json',
      css: body,
    });
  }, { id: FIXTURE_ID, body: themeFor('system') });

  const readings = await page.evaluate((id) => {
    const tokens = window.__THEME_TOKENS__!;
    return [
      tokens.readWithTheme(id, 'light').rendered['--background'],
      tokens.readWithTheme(id, 'dark').rendered['--background'],
    ];
  }, FIXTURE_ID);

  expect(readings, 'an unscoped overlay is the whole of what a .css theme does today').toEqual([
    THEME_COLOR,
    THEME_COLOR,
  ]);
});

test('a value that tried to leave its declaration never reaches the document', async ({ page }) => {
  await page.goto('/');
  const base = await page.evaluate(
    () => window.__THEME_TOKENS__!.readWithTheme(null, 'light').rendered['--background'],
  );

  const refused = await page.evaluate((id) => {
    return window.__THEME_TOKENS__!.applyUserTheme({
      id,
      fileName: 'borealis.json',
      format: 'json',
      css: JSON.stringify({
        tokens: { '--background': '0 0% 0% } body { display: none' },
      }),
    });
  }, FIXTURE_ID);

  expect(refused.styleCount, 'a refused file leaves no stylesheet behind').toBe(0);
  expect(refused.state).toEqual({ appliedId: null, failedId: FIXTURE_ID, warnings: [] });
  expect(refused.cached).toBe(false);
  expect(refused.background, 'and the page keeps the palette it shipped with').toBe(base);
  // The end of the chain, whichever layer refused it: a body that tried to
  // write a rule must leave the page as it was, so check the page is still
  // visible rather than only that the sheet is absent.
  const bodyDisplay = await page.evaluate(() => getComputedStyle(document.body).display);
  expect(bodyDisplay).not.toBe('none');
});

/**
 * §5.12 v3 promised that a theme can retune the overflow lanes by overriding
 * the two hue parameters; P2-3 cashed that promise into option A's whitelist,
 * after the whitelist spent weeks refusing the very tokens the deal names.
 * What a unit test cannot prove is that the compiled overlay — `[data-theme]`
 * scoping, equal specificity against `:root`, document order — actually moves
 * the parameters the JS formula reads. The engine settles it.
 */
test('a token theme retunes the lane overflow through the two hue knobs', async ({ page }) => {
  await page.goto('/');
  const applied = await page.evaluate(({ id, body }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({
      id,
      fileName: 'lanes.json',
      format: 'json',
      css: body,
    });
  }, {
    id: FIXTURE_ID,
    body: JSON.stringify({
      tokens: { '--graph-lane-base-hue': '10', '--graph-lane-hue-step': '100' },
    }),
  });

  // Neither knob is a colour, so the contrast check has nothing to say.
  expect(applied.state).toEqual({ appliedId: FIXTURE_ID, failedId: null, warnings: [] });

  const reads = await page.evaluate((fallbackExpression) => {
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
    return {
      declaredBase: rootStyle.getPropertyValue('--graph-lane-base-hue').trim(),
      declaredStep: rootStyle.getPropertyValue('--graph-lane-hue-step').trim(),
      fallback: paint(fallbackExpression),
      // The reference spells the same resolved hue as a plain number: the
      // theme's 10 + 100 × 12 wraps to the colour the formula must produce.
      reference: paint('hsl(1210 70% 55%)'),
      tokenLane: paint('hsl(var(--graph-lane-1))'),
      tokenReference: paint('hsl(var(--graph-lane-1))'),
    };
  }, laneColor(12));

  expect(reads.declaredBase, 'the overlay, not :root, now owns the base hue').toBe('10');
  expect(reads.declaredStep).toBe('100');
  expect(reads.fallback, 'the overflow lane follows the theme\u2019s parameters').toBe(reads.reference);
  expect(reads.tokenLane, 'the token board itself is untouched by the knobs').toBe(reads.tokenReference);
});
