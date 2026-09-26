import { expect, test } from '@playwright/test';

/**
 * The user theme stylesheet path, in a real engine.
 *
 * Everything else about a user theme is decided in JavaScript — whether the id
 * resolves, whether the file was fetched with its revision, whether a refused
 * file leaves the document — and the jsdom suite covers that. What it cannot
 * cover is the end of the chain: a stylesheet that did not exist when the page
 * loaded has to be *in force* once it is appended, over a base palette whose
 * rules are already in the document and have the same specificity.
 *
 * That is a document-order question, and it is the same one the built-in
 * overlays rest on (`theme-overlays.spec.ts`): the processed stylesheet has no
 * `@layer` at-rules, so `[data-theme="<id>"]` beats `:root` only because it
 * comes later. An injected sheet is therefore only correct if it lands at the
 * end of `<head>`, which is what the colour read below measures.
 */

const FIXTURE_ID = 'user-fixture';

/** `hsl(120 60% 40%)` — a colour nothing in the palette is, so a match has to come from the file. */
const FIXTURE_CSS = `[data-theme="${FIXTURE_ID}"] { --background: 120 60% 40%; }`;
const FIXTURE_COLOR = 'rgb(41, 163, 41)';

const EDITED_CSS = `[data-theme="${FIXTURE_ID}"] { --background: 240 60% 40%; }`;
const EDITED_COLOR = 'rgb(41, 41, 163)';

test('a fetched theme is in force, and the request names the revision', async ({ page }) => {
  await page.goto('/');

  const applied = await page.evaluate(({ id, css }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({ id, css });
  }, { id: FIXTURE_ID, css: FIXTURE_CSS });

  expect(applied.requests, 'the mtime rides along so a proxy cannot serve an older revision').toEqual([
    '/api/themes/fixture.css?v=42',
  ]);
  expect(applied.styleCount).toBe(1);
  expect(applied.styleId).toBe(FIXTURE_ID);
  expect(applied.state).toEqual({ appliedId: FIXTURE_ID, failedId: null });
  expect(applied.cached).toBe(true);
  expect(
    applied.background,
    'the injected sheet has to win over the base palette it is layered on, not merely exist',
  ).toBe(FIXTURE_COLOR);
});

test('an edited file replaces the stylesheet instead of being added to it', async ({ page }) => {
  await page.goto('/');

  const first = await page.evaluate(({ id, css }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({ id, css });
  }, { id: FIXTURE_ID, css: FIXTURE_CSS });
  expect(first.background).toBe(FIXTURE_COLOR);

  const edited = await page.evaluate(({ id, css }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({ id, css, modifiedAt: 99 });
  }, { id: FIXTURE_ID, css: EDITED_CSS });

  expect(edited.requests).toEqual(['/api/themes/fixture.css?v=99']);
  expect(edited.styleCount, 'the superseded sheet must not be left in the document').toBe(1);
  expect(edited.background).toBe(EDITED_COLOR);
});

test('a refused file leaves no stylesheet behind and drops the cached copy', async ({ page }) => {
  await page.goto('/');
  const base = await page.evaluate(() => {
    return window.__THEME_TOKENS__!.readWithTheme(null, 'light').rendered['--background'];
  });

  await page.evaluate(({ id, css }) => {
    return window.__THEME_TOKENS__!.applyUserTheme({ id, css });
  }, { id: FIXTURE_ID, css: FIXTURE_CSS });

  const refused = await page.evaluate((id) => {
    return window.__THEME_TOKENS__!.applyUserTheme({ id, status: 400, modifiedAt: 99 });
  }, FIXTURE_ID);

  expect(refused.styleCount).toBe(0);
  expect(refused.state).toEqual({ appliedId: null, failedId: FIXTURE_ID });
  expect(refused.cached, 'the copy that painted a theme the server now refuses has to go').toBe(false);
  expect(refused.background, 'the page falls back to the palette it shipped with').toBe(base);
});
