import { expect, test } from '@playwright/test';

/**
 * A `.tmTheme`, in a real engine.
 *
 * The compiler is pinned in jsdom, but the thing a `.tmTheme` exists for cannot
 * be: its whole point is that it compiles to declarations naming tokens the base
 * stylesheet and the runtime-injected syntax sheet *already* declare, and whether
 * the injected overlay actually wins is document order — a fact only a browser
 * settles. So this spec drives the production path against a stubbed file server
 * and reads what the page paints.
 *
 * The second case is the one that would otherwise be a silent regression forever:
 * the syntax palette's sheet is injected by a module that today sits in the entry
 * chunk, so it always runs before an overlay exists. If it ever stops being
 * eagerly imported, appending would put the base palette last and every `.tmTheme`
 * syntax colour would be dropped without a word. `reinjectSyntaxStyleSheet`
 * exercises exactly that ordering.
 */

const FIXTURE_ID = 'user-fixture';

/** `#ff79c6` — Dracula's keyword pink; nothing in the base palettes is this. */
const KEYWORD_COLOR = 'rgb(255, 121, 198)';
/** `#282a36` — the theme's editor background. */
const EDITOR_BG_COLOR = 'rgb(40, 42, 54)';
/** The global background as the compiler writes it for the terminal. */
const TERM_BACKGROUND_TRIPLET = '231 15% 18%';

const FIXTURE_TM_THEME = [
  '<plist version="1.0"><dict>',
  '<key>name</key><string>Fixture</string>',
  '<key>settings</key><array>',
  '<dict><key>settings</key><dict>',
  '<key>background</key><string>#282a36</string>',
  '<key>foreground</key><string>#f8f8f2</string>',
  '<key>caret</key><string>#f8f8f0</string>',
  '</dict></dict>',
  '<dict><key>scope</key><string>keyword</string>',
  '<key>settings</key><dict><key>foreground</key><string>#ff79c6</string></dict></dict>',
  '</array></dict></plist>',
].join('');

test('a .tmTheme moves the editor and terminal tokens it names', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async ({ id, body, triplet }) => {
    const api = window.__THEME_TOKENS__!;
    const before = api.read('light').rendered;
    const applied = await api.applyUserTheme({
      id,
      fileName: 'dracula.tmTheme',
      format: 'tmTheme',
      css: body,
    });
    const after = api.read('light').rendered;

    // The colour the stylesheet would paint for the triplet the compiler wrote —
    // measured in this scene rather than computed here, so the assertion is about
    // agreement with the browser and not with this test's arithmetic.
    const probe = document.createElement('div');
    probe.style.transition = 'none';
    probe.style.color = `hsl(${triplet})`;
    document.body.appendChild(probe);
    const tripletReference = getComputedStyle(probe).color;
    probe.remove();

    return {
      requests: applied.requests,
      cached: applied.cached,
      state: applied.state,
      beforeEditor: before['--editor-bg'],
      afterEditor: after['--editor-bg'],
      beforeTerm: before['--term-background'],
      afterTerm: after['--term-background'],
      tripletReference,
    };
  }, { id: FIXTURE_ID, body: FIXTURE_TM_THEME, triplet: TERM_BACKGROUND_TRIPLET });

  expect(result.requests, 'a .tmTheme is a theme file like any other').toEqual([
    '/api/themes/dracula.tmTheme?v=42',
  ]);
  expect(result.state).toEqual({ appliedId: FIXTURE_ID, failedId: null });
  expect(result.cached, 'its compiled sheet is what the next first paint needs').toBe(true);

  expect(result.afterEditor).toBe(EDITOR_BG_COLOR);
  expect(result.beforeEditor, 'the overlay has to move it, not merely agree with the base').not.toBe(
    EDITOR_BG_COLOR,
  );

  expect(
    result.afterTerm,
    'a hex here would compile to hsl(#282a36), which the browser drops — the terminal would silently keep the base colour',
  ).toBe(result.tripletReference);
  expect(result.afterTerm).not.toBe(result.beforeTerm);
});

test('a .tmTheme syntax override outranks the base syntax sheet, whenever that sheet lands', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async ({ id, body }) => {
    const api = window.__THEME_TOKENS__!;
    const base = api.readSyntaxToken('keyword');

    await api.applyUserTheme({
      id,
      fileName: 'dracula.tmTheme',
      format: 'tmTheme',
      css: body,
    });
    const overridden = api.readSyntaxToken('keyword');

    // Put the base sheet back the way a later-loaded chunk would, and ask again.
    api.reinjectSyntaxStyleSheet();
    return { base, overridden, afterLateBase: api.readSyntaxToken('keyword') };
  }, { id: FIXTURE_ID, body: FIXTURE_TM_THEME });

  expect(
    result.overridden,
    'the syntax slot is addressed through SYNTAX_TOKEN_MAP, so the theme’s colour has to arrive',
  ).toBe(KEYWORD_COLOR);
  expect(result.base, 'the base palette has its own keyword colour').not.toBe(KEYWORD_COLOR);
  expect(
    result.afterLateBase,
    'the base syntax sheet is inserted ahead of any overlay, so a late injection cannot take the override away',
  ).toBe(KEYWORD_COLOR);
});
