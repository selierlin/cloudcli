import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { FontFamilyId } from '@/shared/types';

/**
 * The composer wears the chat font.
 *
 * Settings → Fonts is labelled "Chat / Interface Font Size" and describes itself
 * as covering interface text, but the composer used to ignore it: it kept
 * `text-sm` and the body's Encode Sans while the transcript beside it wore the
 * chosen face at the chosen size. That gap is the whole of "the messages look
 * right and the input looks washed out" — a 14px light sans beside a 17px
 * system face is the smallest, thinnest text on the page.
 *
 * Two things have to hold, and only a real engine can settle either: the shell's
 * rule has to outrank the `text-sm` sitting on those elements at equal
 * specificity, and it has to reach *both* of the composer's layers — the
 * textarea and the highlight overlay painted underneath it, which share
 * `.chat-input-placeholder` and would drift apart if only one were styled.
 *
 * The composer is compared against the transcript's own resolved text rather
 * than against a restated stack, because a font stack reads back in the engine's
 * own serialisation (WebKit drops the quotes Chromium keeps). What a consumer
 * *asks for* is asserted in the modules' tests; this file is the engine half.
 */

const CHOSEN: Array<{ option: FontFamilyId; size: string }> = [
  { option: 'system', size: '17' },
  { option: 'serif', size: '13' },
  { option: 'jetbrains-mono', size: '20' },
];

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

for (const { option, size } of CHOSEN) {
  test(`the composer wears ${option} at ${size}px, like the transcript beside it`, async ({ page }) => {
    await openFixture(page);

    const read = await page.evaluate(
      ({ chosenOption, chosenSize }) =>
        window.__THEME_TOKENS__!.readComposerFont(chosenOption, chosenSize),
      { chosenOption: option, chosenSize: size },
    );

    // `text-sm` would answer 14px here, so this is also what shows the shell's
    // rule beat the utility rather than tying with it.
    expect(
      read.textarea.size,
      `the setting asked for ${size}px and the composer drew ${read.textarea.size}`,
    ).toBe(`${size}px`);
    expect(
      read.textarea.family,
      `the composer drew ${read.textarea.family} while the transcript drew ${read.transcript.family}`,
    ).toBe(read.transcript.family);
    expect(
      read.textarea.size,
      `the composer drew ${read.textarea.size} while the transcript drew ${read.transcript.size}`,
    ).toBe(read.transcript.size);

    // The overlay sits on the textarea, so any metric that differs is a mention
    // pill drawn at the wrong place rather than a cosmetic difference.
    expect(
      read.overlay,
      'the mention overlay and the textarea it sits under no longer share their metrics',
    ).toEqual(read.textarea);
  });
}

test('the composer follows the setting rather than a constant, so the matches above measure something', async ({
  page,
}) => {
  await openFixture(page);

  const small = await page.evaluate(() => window.__THEME_TOKENS__!.readComposerFont('serif', '13'));
  const large = await page.evaluate(() => window.__THEME_TOKENS__!.readComposerFont('system', '20'));

  expect(
    new Set([small.textarea.size, large.textarea.size]).size,
    `both choices resolved the composer to ${small.textarea.size}, so the probe is not reading the setting`,
  ).toBe(2);
  expect(
    new Set([small.textarea.family, large.textarea.family]).size,
    `both choices resolved the composer to ${small.textarea.family}, so the probe is not reading the setting`,
  ).toBe(2);
});
