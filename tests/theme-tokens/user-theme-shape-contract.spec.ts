import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The shape contract of `--code-block-bg`, on the `.css` route.
 *
 * A `.css` user theme is injected verbatim — no compiler reads it — so nothing
 * validates the declarations it carries. For most tokens that is harmless: a
 * malformed colour simply does not paint, and the token below it is unused.
 * `--code-block-bg` is the exception, because it is not consumed as a colour but
 * as the *arguments* of one. The panel asks for `hsl(var(--code-block-bg) / .5)`
 * in light and `hsl(var(--code-block-bg))` in dark, so a value that is already a
 * colour nests a call inside a call, which resolves to nothing: the declaration
 * is dropped at computed-value time and the code-block panel loses its board in
 * the chat transcript *and* in the editor preview, with no error on any layer.
 *
 * The token's shape is therefore the contract — a bare triplet, or a `var()`
 * reference to one — and this file pins it from both sides: the two spellings
 * that carry, and the one that silently does not. The `.json` route holds the
 * same rule at compile time (`src/shared/userThemeTokens.ts`); this is the half
 * that has no compiler behind it.
 *
 * Two blocks with equal specificity also mean a `.css` theme answers for both
 * appearances on its own, so the second thing worth pinning is that
 * `:root:not(.dark)` and `.dark` are about *scope* rather than order.
 *
 * Nothing here says which theme wrote which value — those files live outside
 * this repository, and a spec that read them would be a path dependency.
 */

type Appearance = 'light' | 'dark';

type Boards = { reference: string; chat: string; editor: string; half: string };

const APPEARANCES: Appearance[] = ['light', 'dark'];

/** Colours nothing in the palette is, so a match has to come from the sheet. */
const LIGHT_TRIPLET = '120 60% 40%';
const DARK_TRIPLET = '240 60% 40%';

const LIGHT_COLOR = 'rgb(41, 163, 41)';
const LIGHT_HALF = 'rgba(41, 163, 41, 0.5)';
const DARK_COLOR = 'rgb(41, 41, 163)';
const DARK_HALF = 'rgba(41, 41, 163, 0.5)';

/**
 * What an invalid declaration leaves behind. Not "no colour": the property is
 * still inherited, so the panel paints with an alpha of zero rather than
 * falling back to the board it had. That is why this cannot be told apart from
 * a theme that deliberately paints an invisible panel.
 */
const VANISHED = 'rgba(0, 0, 0, 0)';

const LIGHT_BLOCK = `:root:not(.dark) { --code-block-bg: ${LIGHT_TRIPLET}; }`;
const DARK_BLOCK = `.dark { --code-block-bg: ${DARK_TRIPLET}; }`;

/** The contract's two spellings: the triplet itself, and a reference to one. */
const TRIPLET_FORM = [LIGHT_BLOCK, DARK_BLOCK].join('\n');
const TRIPLET_FORM_REVERSED = [DARK_BLOCK, LIGHT_BLOCK].join('\n');

/** The same reference the four shipped user themes write, with the palette it names planted here. */
const REFERENCE_FORM = [
  `:root:not(.dark) { --palette-sand-50: ${LIGHT_TRIPLET}; --code-block-bg: var(--palette-sand-50); }`,
  `.dark { --palette-ink-950: ${DARK_TRIPLET}; --code-block-bg: var(--palette-ink-950); }`,
].join('\n');

const HSL_FORM = [
  ':root:not(.dark) { --code-block-bg: hsl(120, 60%, 40%); }',
  '.dark { --code-block-bg: hsl(240, 60%, 40%); }',
].join('\n');

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

async function paint(page: Page, id: string, css: string) {
  const applied = await page.evaluate(
    ({ id, css }) => window.__THEME_TOKENS__!.applyUserTheme({ id, css }),
    { id, css },
  );
  expect(
    applied.styleCount,
    'the sheet has to be in the document, or every reading below measures the base palette instead',
  ).toBe(1);
  return applied;
}

async function boardsIn(page: Page, appearance: Appearance): Promise<Boards> {
  return page.evaluate((ap) => {
    window.__THEME_TOKENS__!.readWithTheme(null, ap);
    return window.__THEME_TOKENS__!.readCodeBlockBoards();
  }, appearance);
}

async function boardsUnder(page: Page, id: string, css: string): Promise<Record<Appearance, Boards>> {
  await openFixture(page);
  await paint(page, id, css);
  return {
    light: await boardsIn(page, 'light'),
    dark: await boardsIn(page, 'dark'),
  };
}

test('a .css theme carries the board whether it names a reference or writes the triplet', async ({
  page,
}) => {
  const reference = await boardsUnder(page, 'user-shape-reference', REFERENCE_FORM);
  const triplet = await boardsUnder(page, 'user-shape-triplet', TRIPLET_FORM);

  expect(
    triplet,
    'both spellings are the same contract, so they have to resolve to the same board',
  ).toEqual(reference);

  expect(reference.light.editor, 'the editor preview is painted hsl(var(--code-block-bg))').toBe(
    LIGHT_COLOR,
  );
  expect(reference.light.half, 'the light half is that board at 50%').toBe(LIGHT_HALF);
  expect(
    reference.light.chat,
    'the chat panel spells its light half as a utility class, and it is the same board at 50%',
  ).toBe(LIGHT_HALF);
  expect(reference.dark.editor).toBe(DARK_COLOR);
  expect(reference.dark.half).toBe(DARK_HALF);
  expect(
    reference.dark.chat,
    'the dark half is opaque, which is the asymmetry the light half above contrasts with',
  ).toBe(DARK_COLOR);
});

test('a .css theme that wraps the board in hsl() loses it, without an error', async ({ page }) => {
  await openFixture(page);

  const before = { light: await boardsIn(page, 'light'), dark: await boardsIn(page, 'dark') };
  expect(
    before.dark.editor,
    'the control: an unthemed page does paint a board, so the transparency below comes from the sheet',
  ).not.toBe(VANISHED);

  const applied = await paint(page, 'user-shape-hsl', HSL_FORM);

  expect(
    applied.state,
    'the sheet is accepted and no channel reports the declaration — which is why the shape is pinned here rather than left to review',
  ).toEqual({ appliedId: 'user-shape-hsl', failedId: null, warnings: [] });

  for (const appearance of APPEARANCES) {
    const boards = await boardsIn(page, appearance);
    expect(
      boards.editor,
      `in ${appearance}: hsl(hsl(...)) is invalid at computed-value time, so the board is gone`,
    ).toBe(VANISHED);
    expect(boards.chat, `in ${appearance}: the chat panel loses the same board`).toBe(VANISHED);
    expect(boards.half, `in ${appearance}: the 50% spelling loses it the same way`).toBe(VANISHED);
  }
});

test('which appearance a block answers for is scope, not order', async ({ page }) => {
  const ordered = await boardsUnder(page, 'user-shape-light-first', TRIPLET_FORM);
  const reversed = await boardsUnder(page, 'user-shape-dark-first', TRIPLET_FORM_REVERSED);

  expect(
    ordered.light.editor,
    'the two appearances have to differ, or the equality below would hold for a sheet that scoped nothing',
  ).not.toBe(ordered.dark.editor);

  expect(
    reversed,
    'the two blocks have the same specificity, so only the scoping decides who wins',
  ).toEqual(ordered);
  expect(ordered.light.editor).toBe(LIGHT_COLOR);
  expect(ordered.dark.editor).toBe(DARK_COLOR);
});
