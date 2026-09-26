import { expect, test } from '@playwright/test';

/**
 * The token preview (§6's optional 随附功能), in a real engine.
 *
 * The jsdom suite covers grouping and swatch classification against a fake
 * computed style. What only a real engine can answer is the read itself:
 * whether enumerating `getComputedStyle(documentElement)` actually reaches
 * every custom property the document resolves — the static token list, tokens
 * an injected user-theme sheet adds at runtime — and whether the `.dark` flip
 * the dual read performs is invisible outside its task. Those are browser
 * behaviours, not code paths, so no jsdom fixture can prove them.
 */

const KNOWN_NAMES = [
  '--background',
  '--foreground',
  '--palette-brand-500',
  '--editor-bg',
  '--graph-lane-1',
  '--term-background',
];

const allNames = (snapshot: { groups: { entries: { name: string }[] }[] }) =>
  new Set(snapshot.groups.flatMap((group) => group.entries.map((entry) => entry.name)));

test('enumeration reaches every family the stylesheet declares, and the groups arrive in order', async ({ page }) => {
  await page.goto('/');

  const snapshot = await page.evaluate(() => window.__THEME_TOKENS__!.readTokenPreviewSnapshot());

  expect(snapshot.tokenCount, 'the sheet declares hundreds of tokens').toBeGreaterThan(100);
  const names = allNames(snapshot);
  for (const name of KNOWN_NAMES) {
    expect(names.has(name), `${name} is in the snapshot`).toBe(true);
  }

  expect(snapshot.groups[0].id, 'the semantic surface is what readers reason about, so it is first').toBe('semantic');
  expect(snapshot.groups.map((group) => group.id)).toContain('palette');
});

test('a token injected at runtime is enumerated too', async ({ page }) => {
  await page.goto('/');

  const PROBE = '--preview-runtime-probe';
  await page.evaluate(({ id, css }) => window.__THEME_TOKENS__!.applyUserTheme({ id, css }), {
    id: 'user-preview-probe',
    css: `[data-theme="user-preview-probe"] { ${PROBE}: 120 60% 40%; }`,
  });

  const snapshot = await page.evaluate(() => window.__THEME_TOKENS__!.readTokenPreviewSnapshot());
  const names = allNames(snapshot);
  expect(names.has(PROBE), 'an injected sheet is the document as far as the preview is concerned').toBe(true);
});

test('both appearances resolve differently, and match the fixture read of the same scope', async ({ page }) => {
  await page.goto('/');

  const { entry, staticRead } = await page.evaluate(() => {
    const snapshot = window.__THEME_TOKENS__!.readTokenPreviewSnapshot();
    const semantic = snapshot.groups.find((group) => group.id === 'semantic');
    const entry = semantic?.entries.find((item) => item.name === '--background');
    const staticRead = window.__THEME_TOKENS__!.read('dark').tokens['--background'];
    return { entry, staticRead };
  });

  expect(entry).toBeDefined();
  expect(entry!.light, 'the two appearances resolve differently').not.toBe(entry!.dark);
  expect(entry!.lightSwatch, 'a bare-triplet token is wrapped for the swatch').toMatch(/^hsl\(/);
  expect(
    entry!.dark,
    'the dark column is the same string the fixture read resolves for the dark scope',
  ).toBe(staticRead);
});

test('the appearance in force survives the read, from either side', async ({ page }) => {
  await page.goto('/');

  const lightResult = await page.evaluate(() => {
    window.__THEME_TOKENS__!.readTokenPreviewSnapshot();
    return document.documentElement.classList.contains('dark');
  });
  expect(lightResult, 'a light page stays light after the read').toBe(false);

  const darkResult = await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    window.__THEME_TOKENS__!.readTokenPreviewSnapshot();
    return document.documentElement.classList.contains('dark');
  });
  expect(darkResult, 'a dark page stays dark after the read').toBe(true);
});
