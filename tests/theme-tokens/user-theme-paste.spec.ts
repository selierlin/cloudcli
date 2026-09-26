import { expect, test } from '@playwright/test';

/**
 * A pasted theme, in a real engine.
 *
 * The pasted source shares its loader, its injection step and its selector shapes
 * with a theme file — which is the point of it being one path with one step
 * swapped. What is left that a unit test cannot settle is that the swap really is
 * only that: the stylesheet has to reach the page, and no request may be made for
 * a theme file, because a pasted theme has no file and never will. A stray fetch
 * here would not fail anything on this machine; it would turn a theme the user
 * carries to every device into one that only works where a file happens to exist.
 *
 * Both formats the paste box writes are covered, because they are not the same
 * kind of body: option A compiles to a `[data-theme]` block, while option B is a
 * stylesheet whose *own* selectors have to be the ones that take effect.
 */

const PASTE_ID = 'paste-1';

const THEME_TRIPLET = '120 60% 40%';
const THEME_COLOR = 'rgb(41, 163, 41)';

/**
 * A stylesheet in the form the settings page tells authors to write: `:root`,
 * with no `[data-theme]` anywhere. That form is the part a unit test cannot
 * settle — the sheet is injected only while the theme is picked, so its selector
 * does not have to name the theme, and it is `:root` outranking the base `:root`
 * on document order that has to hold.
 */
const CSS_THEME_TRIPLET = '280 60% 40%';
const CSS_THEME_COLOR = 'rgb(122, 41, 163)';
const CSS_THEME = `:root { --background: ${CSS_THEME_TRIPLET}; }`;

test('a pasted theme reaches the page, and no theme file is ever requested', async ({ page }) => {
  await page.goto('/');
  const content = JSON.stringify({ name: 'Deep sea', tokens: { '--background': THEME_TRIPLET } });

  const applied = await page.evaluate(
    ({ id, body }) => window.__THEME_TOKENS__!.applyUserTheme({ id, paste: body }),
    { id: PASTE_ID, body: content },
  );

  expect(
    applied.requests,
    'a paste has no file behind it, so asking the server for one would be asking for something that is not there',
  ).toEqual([]);
  expect(applied.styleId).toBe(PASTE_ID);
  // The pasted token map moves `--background` alone and declares no appearance,
  // so the overlay is compiled for both and the pairs whose other side falls
  // back to each base's ink fail against a mid-green — §5.10 says so without
  // holding the paste back.
  expect(applied.state).toEqual({
    appliedId: PASTE_ID,
    failedId: null,
    warnings: [
      { appearance: 'light', ink: '--muted-foreground', surface: '--background', ratio: expect.any(Number), min: 4.5 },
      { appearance: 'light', ink: '--ring', surface: '--background', ratio: expect.any(Number), min: 3 },
      { appearance: 'dark', ink: '--foreground', surface: '--background', ratio: expect.any(Number), min: 4.5 },
      { appearance: 'dark', ink: '--muted-foreground', surface: '--background', ratio: expect.any(Number), min: 4.5 },
      { appearance: 'dark', ink: '--ring', surface: '--background', ratio: expect.any(Number), min: 3 },
    ],
  });
  expect(
    applied.background,
    'the content has to be compiled and injected, not left as JSON',
  ).toBe(THEME_COLOR);
  expect(
    applied.cached,
    'the content is already in the preference mirror, so a second copy would only be one more thing to keep in step',
  ).toBe(false);
});

test('a pasted stylesheet is in force as it stands, and no theme file is requested either', async ({ page }) => {
  await page.goto('/');

  const applied = await page.evaluate(
    ({ id, body }) => window.__THEME_TOKENS__!.applyUserTheme({ id, paste: body, pasteFormat: 'css' }),
    { id: PASTE_ID, body: CSS_THEME },
  );

  expect(
    applied.requests,
    'a paste has no file behind it, whichever of the two formats it is written in',
  ).toEqual([]);
  expect(applied.styleId).toBe(PASTE_ID);
  expect(applied.state).toEqual({ appliedId: PASTE_ID, failedId: null, warnings: [] });
  expect(
    applied.background,
    'the author\'s own selector has to win over the base palette, not merely exist in the document',
  ).toBe(CSS_THEME_COLOR);
  expect(
    applied.cached,
    'a paste carries its own content, so mirroring it again would be a second copy to keep in step',
  ).toBe(false);
});
