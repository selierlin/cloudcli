import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ITheme } from '@xterm/xterm';

/**
 * The terminal's colours live in the stylesheet (`--term-*`), but xterm paints
 * into a canvas and needs concrete values, so `useShellTerminal` resolves them
 * at runtime through `readTerminalTheme`. This suite pins that whole chain —
 * declaration, browser resolution and the JS mapping — back to the hex board the
 * terminal shipped with, because phase 0 promises it renders exactly as before.
 */

/**
 * The board as it was hardcoded in `useShellTerminal.ts` before tokenization.
 * Kept in hex on purpose: a failure should read as "the terminal changed
 * colour", not as "two HSL triplets differ in the third decimal".
 */
const ORIGINAL_BOARD = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
} satisfies Partial<ITheme>;

/** Each semantic alias and the ANSI colour it must mirror. */
const SEMANTIC_ALIASES: Record<string, string> = {
  '--term-error': '--term-ansi-red',
  '--term-success': '--term-ansi-green',
  '--term-warning': '--term-ansi-yellow',
  '--term-info': '--term-ansi-blue',
};

function hexToRgb(hex: string): string {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgb(${channels.join(', ')})`;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

async function readTerminalTheme(page: Page, appearance: 'light' | 'dark'): Promise<ITheme> {
  return page.evaluate((next) => {
    window.__THEME_TOKENS__!.read(next);
    return window.__THEME_TOKENS__!.readTerminalTheme();
  }, appearance);
}

test('the resolved terminal theme still renders the pre-tokenization board', async ({ page }) => {
  await openFixture(page);

  const theme = await readTerminalTheme(page, 'dark');
  const resolved = new Map<string, unknown>(Object.entries(theme));

  expect(Object.keys(theme).sort()).toEqual(Object.keys(ORIGINAL_BOARD).sort());

  const drifts: string[] = [];
  for (const [key, hex] of Object.entries(ORIGINAL_BOARD)) {
    const expected = hexToRgb(hex);
    if (resolved.get(key) !== expected) {
      drifts.push(`${key}: expected ${expected}, got ${String(resolved.get(key))}`);
    }
  }

  expect(drifts, `terminal colours drifted:\n${drifts.join('\n')}`).toEqual([]);
});

test('the semantic aliases resolve to their ANSI counterpart', async ({ page }) => {
  await openFixture(page);

  const { rendered } = await page.evaluate(() => window.__THEME_TOKENS__!.read('dark'));

  const mismatches = Object.entries(SEMANTIC_ALIASES)
    .filter(([alias, source]) => rendered[alias] !== rendered[source])
    .map(([alias, source]) => `${alias} = ${rendered[alias]}, ${source} = ${rendered[source]}`);

  expect(mismatches, `semantic aliases drifted:\n${mismatches.join('\n')}`).toEqual([]);
});

test('the terminal board is the same in light and dark', async ({ page }) => {
  await openFixture(page);

  // The board stays dark in both appearances during this phase: a light
  // terminal is a theme's decision, so the two maps must be identical.
  expect(await readTerminalTheme(page, 'light')).toEqual(await readTerminalTheme(page, 'dark'));
});

/**
 * `extendedAnsi` used to overwrite 256-colour slots 16-31 with a VGA palette.
 * Those slots are the first 16 entries of the 6x6x6 cube, so overriding them
 * corrupts the cube rather than defining a second ANSI ramp; dropping the field
 * hands the slots back to xterm. This is the one intentional rendering
 * difference of the terminal tokenization, recorded in the design document.
 */
test('extendedAnsi is no longer overridden', async ({ page }) => {
  await openFixture(page);

  expect((await readTerminalTheme(page, 'dark')).extendedAnsi).toBeUndefined();
});

/**
 * The refresh in `useShellTerminal` is only worth anything if the board actually
 * moves, so this pins the precondition. It is the token-to-consumer half of the
 * theme-refresh slice: that the hook re-reads on a theme change is asserted in
 * `src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx`, and that the
 * editor needs no such refresh (its rules are `var()`) is asserted by
 * `editorThemeTokens.test.ts`, which rejects any literal chrome value.
 */
test('an overlay theme moves the board readTerminalTheme resolves', async ({ page }) => {
  await openFixture(page);

  const boardWith = (themeId: string | null) => page.evaluate((id) => {
    window.__THEME_TOKENS__!.readWithTheme(id, 'dark');
    return window.__THEME_TOKENS__!.readTerminalTheme();
  }, themeId);

  const base = await boardWith(null);
  const themed = await boardWith('cc-polar');

  // Re-reading without switching must be stable, so the difference below is the
  // overlay's doing rather than per-call noise.
  const repeated = await page.evaluate(() => window.__THEME_TOKENS__!.readTerminalTheme());
  expect(repeated).toEqual(themed);

  const asRecord = (theme: ITheme) => theme as unknown as Record<string, unknown>;
  const moved = Object.keys(base).filter((key) => asRecord(base)[key] !== asRecord(themed)[key]);

  expect(moved).toContain('background');
  expect(moved).toContain('red');
});

/**
 * The terminal's font, resolved through the same stylesheet-first channel as its
 * colours (§6.1, §6.2). Like the board above, the value is a token, but unlike
 * the board the consumer is `fontFamily` rather than a colour, so the "no value"
 * states need their own handling — a `font-family` that resolves to nothing is
 * not an error the way a colour is; it silently inherits.
 */

/**
 * The stack the terminal shipped with, as the production constant states it.
 *
 * Keep this in step with the readback shape rather than the source literal: if
 * the base stylesheet's stack is ever changed, update this constant and the
 * assertions together, or a legitimate edit reads as a regression. What is
 * pinned is the family list after quoting is normalised (§6.1) — see
 * `normalizeFontStack`.
 */
const ORIGINAL_FONT_STACK = 'Menlo, Monaco, "Courier New", monospace';

/**
 * The family list with quoting removed.
 *
 * `fontFamily` serialisation differs between engines only in quoting: Chromium
 * keeps the quotes around a multi-word family (`"Courier New"`), WebKit drops
 * them. The list itself — what xterm parses and measures — is identical, so the
 * comparisons normalise the quotes away rather than pinning one engine's
 * spelling. The production literal is asserted exactly, since that is a TS
 * constant and not a serialisation.
 */
const normalizeFontStack = (stack: string): string => stack.replace(/"/g, '');

test('with no theme and no user choice the terminal font is still the shipped stack', async ({ page }) => {
  await openFixture(page);

  const { read, fallback } = await page.evaluate(() => ({
    read: window.__THEME_TOKENS__!.readThemedTerminalFontFamily(),
    fallback: window.__THEME_TOKENS__!.fallbackTerminalFontFamily,
  }));

  expect(fallback).toBe(ORIGINAL_FONT_STACK);
  // The shipped list in its own order, not "the same families in some order":
  // the read is the token's value resolved by the browser. Quotes are normalised
  // because serialisation differs by engine (§6.1, `normalizeFontStack`).
  expect(normalizeFontStack(read!)).toBe(normalizeFontStack(ORIGINAL_FONT_STACK));
});

test('a theme that declares the token moves the terminal font', async ({ page }) => {
  await openFixture(page);

  // The real overlay shape: `themeOverlaySelector` writes `[data-theme="…"]:not(.dark)`
  // for a light-scoped block, and `.css` themes are scoped the same way (§6.2).
  const read = await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    const style = document.createElement('style');
    style.textContent =
      '[data-theme="fixture-font"]:not(.dark) { --term-font-family: "Fira Code", monospace; }';
    document.head.appendChild(style);
    document.documentElement.dataset.theme = 'fixture-font';
    return window.__THEME_TOKENS__!.readThemedTerminalFontFamily();
  });

  expect(normalizeFontStack(read!)).toBe('Fira Code, monospace');
});

test('a theme may declare the token on body, not only on :root', async ({ page }) => {
  await openFixture(page);

  // `.css` themes are injected verbatim and are not held to `:root`, so the read
  // has to look where the probe looks — on `body` — or the two channels disagree
  // about a body-scoped declaration (the scope split C1 named, §3.6).
  const read = await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = 'body { --term-font-family: "Body Scoped", monospace; }';
    document.head.appendChild(style);
    return window.__THEME_TOKENS__!.readThemedTerminalFontFamily();
  });

  expect(normalizeFontStack(read!)).toBe('Body Scoped, monospace');
});

test('a token with no value falls back instead of silently inheriting the page font', async ({ page }) => {
  await openFixture(page);

  const result = await page.evaluate(() => {
    // `initial` gives the token the guaranteed-invalid value — the state an
    // undeclared token is in — while the base sheet still declares it.
    const style = document.createElement('style');
    style.textContent =
      ':root { --term-font-family: initial; }\nbody { font-family: "Body Font", monospace; }';
    document.head.appendChild(style);
    return {
      production: window.__THEME_TOKENS__!.readThemedTerminalFontFamily(),
      bareProbe: window.__THEME_TOKENS__!.probeFontFamilyWithoutFallback('--term-font-family'),
    };
  });

  expect(result.production, 'a valueless token falls back rather than inheriting').toBeNull();
  // Why the value check exists: a fallback-less probe hands back the inherited
  // page stack — a real font stack, indistinguishable from a declared one.
  expect(normalizeFontStack(result.bareProbe)).toBe('Body Font, monospace');
});

test('an empty declaration falls back too', async ({ page }) => {
  await openFixture(page);

  const result = await page.evaluate(() => {
    // A `.css` theme may write exactly this. An empty custom property is not
    // guaranteed-invalid — it substitutes to an empty token stream — so a
    // `var()` fallback never fires for it and only the value check catches it
    // (§6.4).
    const style = document.createElement('style');
    style.textContent =
      ':root { --term-font-family: ; }\nbody { font-family: "Body Font", monospace; }';
    document.head.appendChild(style);
    return {
      production: window.__THEME_TOKENS__!.readThemedTerminalFontFamily(),
      bareProbe: window.__THEME_TOKENS__!.probeFontFamilyWithoutFallback('--term-font-family'),
    };
  });

  expect(result.production).toBeNull();
  expect(normalizeFontStack(result.bareProbe)).toBe('Body Font, monospace');
});

test('a concrete user choice overrides the theme, and "theme" defers to it', async ({ page }) => {
  await openFixture(page);

  const stacks = await page.evaluate(() => {
    // The precedence only means something with an overlay in force, so one is
    // installed for the reads (§6.2 #3/#4).
    document.documentElement.classList.remove('dark');
    const style = document.createElement('style');
    style.textContent =
      '[data-theme="fixture-font"]:not(.dark) { --term-font-family: "Fira Code", monospace; }';
    document.head.appendChild(style);
    document.documentElement.dataset.theme = 'fixture-font';
    return {
      picked: window.__THEME_TOKENS__!.resolveTerminalFontFamily('jetbrains-mono'),
      noOpinion: window.__THEME_TOKENS__!.resolveTerminalFontFamily('theme'),
    };
  });

  // A concrete id is the user overruling the overlay, not the other way round.
  expect(stacks.picked).toContain('JetBrains Mono');
  expect(normalizeFontStack(stacks.picked)).not.toContain('Fira Code');
  // "No opinion" hands the decision back — to the overlay, which is what makes
  // "follow the theme" a choice a user can return to.
  expect(normalizeFontStack(stacks.noOpinion)).toBe('Fira Code, monospace');
});

/**
 * The face the metrics rest on really does arrive late.
 *
 * This is what stands in for a grid-size assertion. The terminal sizes its grid
 * from measured glyphs, so the hazard is "fit before the face lands" — but every
 * face on offer is monospace with a ~0.6em advance, so the measured cell width
 * barely moves (14px JetBrains Mono measures 8.400 against 8.401 for the
 * generic fallback, and both give the same `cols` at any realistic width). A
 * `cols` comparison therefore cannot fail, and a test that cannot fail is worse
 * than none. What *is* observable is the fact the code waits for: the face is
 * absent until it is asked for. The waiting itself is pinned one layer up, where
 * `fit` is checked to follow `document.fonts.load` (see
 * `src/modules/shell/tests/shellTerminalThemeRefresh.test.tsx`).
 */
test('the self-hosted terminal face is genuinely not loaded until it is requested', async ({ page }) => {
  await openFixture(page);

  const availability = await page.evaluate(async () => {
    const request = '14px "JetBrains Mono"';
    const before = document.fonts.check(request);
    await document.fonts.load(request);
    return { before, after: document.fonts.check(request) };
  });

  expect(
    availability.before,
    'if the face were already in, there would be nothing to wait for',
  ).toBe(false);
  expect(availability.after).toBe(true);
});
