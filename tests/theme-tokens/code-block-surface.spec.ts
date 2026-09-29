import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { BUILTIN_THEMES } from '@/shared/constants';

/**
 * The code-block panel's board.
 *
 * A fenced block is a panel, and the panel has its own token now rather than
 * `--muted` in light mode and a compatibility atom in dark — two boards for one
 * element, one of them outside every theme's reach. The rule the token encodes
 * is "the block sits on the appearance's editor page", which is what makes a
 * theme's code block look like the editor beside it.
 *
 * It is read against the editor page itself rather than against a palette value
 * this file would have to restate: `reference` is painted with `var(--editor-bg)`
 * on the same page, so both sides of every comparison are colours the browser
 * resolved. That also means a theme that forgets to declare the token fails here
 * rather than silently inheriting the base board.
 *
 * Both appearances are covered because the panel is deliberately asymmetric —
 * the light half stays half-transparent while the dark half does not, the shape
 * the chat transcript has always had — and because the editor's preview used to
 * differ between them (its dark half fell through to Prism's own `pre`
 * background). What a consumer *asks for* is asserted in the modules' own tests;
 * this file is the engine-side half.
 */

type Appearance = 'light' | 'dark';

const APPEARANCES: Appearance[] = ['light', 'dark'];

const THEMES: (string | null)[] = [
  null,
  ...BUILTIN_THEMES.filter((theme) => theme.appearance === 'system').map((theme) => theme.id),
];

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

async function readBoards(
  page: Page,
  themeId: string | null,
  appearance: Appearance,
): Promise<{ reference: string; chat: string; editor: string; half: string }> {
  return page.evaluate(
    ({ id, ap }) => {
      window.__THEME_TOKENS__!.readWithTheme(id, ap);
      return window.__THEME_TOKENS__!.readCodeBlockBoards();
    },
    { id: themeId, ap: appearance },
  );
}

for (const themeId of THEMES) {
  const label = themeId ?? 'the base palette';

  test(`${label} paints the code-block panel on its editor page`, async ({ page }) => {
    await openFixture(page);

    for (const appearance of APPEARANCES) {
      const boards = await readBoards(page, themeId, appearance);
      const where = `${label} in ${appearance}`;

      // The editor's preview, in both appearances: one token, so the "dark falls
      // through to Prism" asymmetry cannot come back unnoticed.
      expect(
        boards.editor,
        `${where}: the editor preview draws ${boards.editor}, not the editor page ${boards.reference}`,
      ).toBe(boards.reference);

      if (appearance === 'dark') {
        expect(
          boards.chat,
          `${where}: the chat panel draws ${boards.chat}, not the editor page ${boards.reference}`,
        ).toBe(boards.reference);
      } else {
        // The light half is that same board at 50%, and the alpha is the point:
        // without it the panel would be the shape the dark half has.
        expect(
          boards.chat,
          `${where}: the chat panel draws ${boards.chat}, not half of ${boards.half}`,
        ).toBe(boards.half);
        expect(boards.chat, `${where}: the light half lost its transparency`).not.toBe(boards.reference);
      }
    }
  });
}

test('the board the panel follows is not a constant, so the comparisons above measure something', async ({
  page,
}) => {
  await openFixture(page);

  const editorPages = new Set<string>();
  for (const themeId of THEMES) {
    editorPages.add((await readBoards(page, themeId, 'dark')).reference);
  }

  expect(
    editorPages.size,
    `every theme resolved --editor-bg to ${[...editorPages].join(' / ')}, so "the panel follows the editor page" holds trivially`,
  ).toBeGreaterThan(1);
});
