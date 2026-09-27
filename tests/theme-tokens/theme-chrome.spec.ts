import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The browser chrome — the OS status bar on iOS, the address bar elsewhere — sits
 * outside the page, so it cannot read a token. `applyThemeChrome` bridges that by
 * resolving a token through the browser and publishing it to two metas; this suite
 * drives that production function through the fixture and pins what it publishes.
 *
 * The light pin is a *deliberate* change from the hex the effect used to hardcode
 * (`#f6f4ef`, hsl(42.9 28% 95.1%)): that literal had drifted from `--background`
 * (hsl(44 22% 96%)), so deriving it moves the chrome colour to what the page
 * actually paints. The same suite pins that equality rather than the number alone,
 * which is what makes the number meaningful instead of magic.
 */

/** The light chrome colour, i.e. `--background` resolved; dark is unchanged at `#141414`. */
const LIGHT_THEME_COLOR = '#f7f6f3';
const DARK_THEME_COLOR = '#141414';

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` -> `{ channels, alpha }`, so the spec can compute independently. */
function parseColor(color: string): { channels: number[]; alpha: number } {
  const parts = color.slice(color.indexOf('(') + 1, color.lastIndexOf(')')).split(',').map(Number);
  return { channels: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function toHex(channels: number[]): string {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

test('the chrome follows the appearance, and its colour is the resolved --background', async ({ page }) => {
  await openFixture(page);

  const out = await page.evaluate(() => {
    const api = window.__THEME_TOKENS__!;
    return {
      background: {
        light: api.read('light').rendered['--background'],
        dark: api.read('dark').rendered['--background'],
      },
      chrome: {
        light: api.readThemeChrome('light'),
        dark: api.readThemeChrome('dark'),
      },
    };
  });

  // The independent path: the fixture paints `hsl(var(--background))` on its own
  // probe, so agreeing with it means the chrome is the colour the page paints,
  // not a number that happens to be nearby.
  expect(toHex(parseColor(out.background.light).channels)).toBe(LIGHT_THEME_COLOR);
  expect(toHex(parseColor(out.background.dark).channels)).toBe(DARK_THEME_COLOR);

  expect(out.chrome.light).toEqual({ themeColor: LIGHT_THEME_COLOR, statusBar: 'default' });
  expect(out.chrome.dark).toEqual({ themeColor: DARK_THEME_COLOR, statusBar: 'black-translucent' });
});

test('the chrome colour is resolved per appearance, not hardcoded', async ({ page }) => {
  await openFixture(page);

  // A theme overriding `--background` has to move the chrome with it: this is the
  // whole reason the effect no longer carries a literal. The inline property wins
  // over `:root`, and the fixture's own probe sees the same override, so the two
  // readings are compared in one state.
  const out = await page.evaluate(() => {
    const api = window.__THEME_TOKENS__!;
    document.documentElement.style.setProperty('--background', '200 50% 40%');
    try {
      return {
        background: api.read('light').rendered['--background'],
        chrome: api.readThemeChrome('light'),
      };
    } finally {
      document.documentElement.style.removeProperty('--background');
    }
  });

  const expected = toHex(parseColor(out.background).channels);
  expect(expected).not.toBe(LIGHT_THEME_COLOR);
  expect(out.chrome.themeColor).toBe(expected);
});

test('a translucent chrome token is flattened onto the page background', async ({ page }) => {
  await openFixture(page);

  // The OS paints the chrome itself, so it cannot be given transparency. `--nav-tab-glow`
  // (`var(--palette-brand-500) / 0.18`) is the real translucent token, read here through
  // both paths at once: the fixture reports what the browser renders it as, and the
  // expectation is composited from that plus the background — so a wrong alpha, a wrong
  // backdrop or a dropped channel all show up as a mismatch.
  const out = await page.evaluate(() => {
    const api = window.__THEME_TOKENS__!;
    const rendered = api.read('light').rendered;
    return {
      background: rendered['--background'],
      glow: rendered['--nav-tab-glow'],
      chrome: api.readThemeChrome('light', { themeColor: '--nav-tab-glow' }),
    };
  });

  const background = parseColor(out.background);
  const glow = parseColor(out.glow);
  expect(glow.alpha).toBeLessThan(1);

  const flattened = toHex(
    glow.channels.map((channel, index) =>
      Math.round(channel * glow.alpha + background.channels[index] * (1 - glow.alpha)),
    ),
  );
  expect(out.chrome.themeColor).toBe(flattened);
});

test('a theme may override the status bar, and an unknown token falls back', async ({ page }) => {
  await openFixture(page);

  const out = await page.evaluate(() => {
    const api = window.__THEME_TOKENS__!;
    return {
      statusBarOverride: api.readThemeChrome('dark', { statusBar: 'default' }),
      unknownToken: api.readThemeChrome('light', { themeColor: '--not-a-token' }),
    };
  });

  expect(out.statusBarOverride.statusBar).toBe('default');
  // An unresolvable token must keep the fallback the appearance ships — the base `--background`
  // (`FALLBACK_THEME_COLOR.light`, which `index.html` also ships) — rather than publish the
  // probe's inherited colour as if it were the theme's.
  expect(out.unknownToken.themeColor).toBe('#f7f6f3');
});
