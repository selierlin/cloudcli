import { expect, test } from '@playwright/test';

/**
 * A pasted theme, in a real engine.
 *
 * The pasted source shares its compiler, its selector shapes and its injection
 * step with a theme file — which is the point of it being one path with one step
 * swapped. What is left that a unit test cannot settle is that the swap really
 * is only that: the stylesheet has to reach the page, and no request may be made
 * for a theme file, because a pasted theme has no file and never will. A stray
 * fetch here would not fail anything on this machine; it would turn a theme the
 * user carries to every device into one that only works where a file happens to
 * exist.
 */

const PASTE_ID = 'paste-1';

const THEME_TRIPLET = '120 60% 40%';
const THEME_COLOR = 'rgb(41, 163, 41)';

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
  expect(applied.state).toEqual({ appliedId: PASTE_ID, failedId: null });
  expect(
    applied.background,
    'the content has to be compiled and injected, not left as JSON',
  ).toBe(THEME_COLOR);
  expect(
    applied.cached,
    'the content is already in the preference mirror, so a second copy would only be one more thing to keep in step',
  ).toBe(false);
});
