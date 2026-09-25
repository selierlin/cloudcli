import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { BUILTIN_THEMES } from '@/shared/constants';

/**
 * The a11y contrast contract (§5.10).
 *
 * §5.10 makes two promises about the themes that ship: body-size text clears
 * WCAG AA (4.5:1), and the focus ring stays visible against the page it sits on
 * (3:1, the one clause §5.10 calls hard). This suite measures both, in the real
 * browser, for **the base palette and every overlay the selector can apply** —
 * the base included because it is what ships whenever the user has not picked a
 * theme, so a suite that only walked the overlays would leave the default
 * surface unguarded.
 *
 * Colours are read from the fixture's `rendered` layer rather than from `tokens`:
 * a token is a triplet (`40 5% 43%`) that only becomes a colour when something
 * consumes it, and the contrast maths needs the colour the browser actually
 * paints. `rendered` is exactly that — the same `hsl(var(--x))` path Tailwind
 * emits, parsed by the browser.
 *
 * The pair list is the contract's own pairs (`--foreground` / `--muted-foreground`
 * on the two neutral surfaces, plus `--ring` on the background) and the button
 * label on its fill. It is deliberately not an exhaustive text x surface matrix:
 * each pair here is one the stylesheet actually paints, and a pair whose token is
 * not probed fails loudly rather than reading `NaN`.
 */

type Appearance = 'light' | 'dark';

const APPEARANCES: Appearance[] = ['light', 'dark'];

const OVERLAY_THEMES = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

/** The base palette, then every overlay the theme selector can apply. */
const SUBJECTS: { id: string | null; label: string }[] = [
  { id: null, label: 'the base palette' },
  ...OVERLAY_THEMES.map((theme) => ({ id: theme.id, label: theme.id })),
];

type Pair = {
  /** The token painted as text, or as the visible indicator. */
  ink: string;
  /** The token painted behind it. */
  surface: string;
  /** The WCAG AA floor: 4.5 for text, 3 for a non-text indicator. */
  min: number;
};

const PAIRS: Pair[] = [
  { ink: '--foreground', surface: '--background', min: 4.5 },
  { ink: '--foreground', surface: '--card', min: 4.5 },
  { ink: '--muted-foreground', surface: '--background', min: 4.5 },
  { ink: '--muted-foreground', surface: '--card', min: 4.5 },
  // The button label is normal-size text on its own fill. Neither §5.10 nor
  // §5.11 names the pair, but both overlay themes were authored against it —
  // `cc-ocean`'s comment records moving its light step off a 3.5:1 value, and
  // `cc-polar`'s records choosing one that clears 4.6:1 — so it is in scope.
  { ink: '--primary-foreground', surface: '--primary', min: 4.5 },
  { ink: '--ring', surface: '--background', min: 3 },
];

/** The three sRGB channels of a browser-serialised colour. */
function channels(color: string): [number, number, number] {
  const parts = color.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(
    parts.length,
    `the browser serialised a colour this suite cannot read: ${JSON.stringify(color)}`,
  ).toBeGreaterThanOrEqual(3);

  return [parts[0], parts[1], parts[2]];
}

/** WCAG 2.x relative luminance of an `rgb(r, g, b)` colour. */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, order-independent. */
function contrast(ink: string, surface: string): number {
  const a = luminance(ink);
  const b = luminance(surface);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function readRendered(
  page: Page,
  themeId: string | null,
  appearance: Appearance,
): Promise<Record<string, string>> {
  return page.evaluate(
    ({ id, ap }) => window.__THEME_TOKENS__!.readWithTheme(id, ap).rendered,
    { id: themeId, ap: appearance },
  );
}

for (const subject of SUBJECTS) {
  test(`${subject.label} clears the WCAG AA contrast floor in both appearances`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));

    const unprobed: string[] = [];
    const failures: string[] = [];

    for (const appearance of APPEARANCES) {
      const rendered = await readRendered(page, subject.id, appearance);

      for (const { ink, surface, min } of PAIRS) {
        // A pair the fixture does not probe would read `undefined` and its ratio
        // would be `NaN` — any comparison would quietly pass. Name it instead.
        for (const token of [ink, surface]) {
          if (!rendered[token]) {
            unprobed.push(`${appearance} ${token} (needed by ${ink} on ${surface})`);
          }
        }
        if (!rendered[ink] || !rendered[surface]) continue;

        const ratio = contrast(rendered[ink], rendered[surface]);
        if (ratio < min) {
          failures.push(
            `${appearance} ${ink} on ${surface}: ${ratio.toFixed(2)}:1 < ${min}:1 ` +
              `(${rendered[ink]} on ${rendered[surface]})`,
          );
        }
      }
    }

    expect(
      unprobed,
      `these tokens are not in the fixture's PROBES, so their colour cannot be read:\n` +
        `${unprobed.join('\n')}\nAdd them to PROBES in tests/theme-tokens/main.ts`,
    ).toEqual([]);
    expect(failures, `${subject.label} contrast failures:\n${failures.join('\n')}`).toEqual([]);
  });
}
