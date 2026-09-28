import type { ITheme } from '@xterm/xterm';

import type { TerminalFontFamilyId } from '@/shared/types';
import { CODE_FONT_FAMILY_CSS } from '@/shared/utils';

/**
 * The terminal is the one surface the stylesheet cannot style directly: xterm
 * paints into a canvas and needs concrete colour values, not `var()` references.
 * This module keeps the stylesheet authoritative anyway — it maps each xterm
 * theme key onto the L2 token that feeds it and resolves the token through the
 * browser, so a theme that overrides `--term-*` restyles the terminal too.
 */

/** Every colour key xterm accepts, derived from its own type so none is missed. */
type ThemeColourKey = {
  [K in keyof ITheme]-?: NonNullable<ITheme[K]> extends string ? K : never;
}[keyof ITheme];

/**
 * `selectionInactiveBackground` is deliberately absent. The terminal shipped
 * without it and xterm's default (a translucent white) has no token behind it,
 * so supplying one would be a new colour rather than a tokenization.
 */
type ThemedColourKey = Exclude<ThemeColourKey, 'selectionInactiveBackground'>;

export const TERMINAL_THEME_TOKENS = {
  background: '--term-background',
  foreground: '--term-foreground',
  cursor: '--term-cursor',
  cursorAccent: '--term-cursor-accent',
  selectionBackground: '--term-selection-bg',
  selectionForeground: '--term-selection-fg',
  black: '--term-ansi-black',
  red: '--term-ansi-red',
  green: '--term-ansi-green',
  yellow: '--term-ansi-yellow',
  blue: '--term-ansi-blue',
  magenta: '--term-ansi-magenta',
  cyan: '--term-ansi-cyan',
  white: '--term-ansi-white',
  brightBlack: '--term-ansi-bright-black',
  brightRed: '--term-ansi-bright-red',
  brightGreen: '--term-ansi-bright-green',
  brightYellow: '--term-ansi-bright-yellow',
  brightBlue: '--term-ansi-bright-blue',
  brightMagenta: '--term-ansi-bright-magenta',
  brightCyan: '--term-ansi-bright-cyan',
  brightWhite: '--term-ansi-bright-white',
} satisfies Record<ThemedColourKey, string>;

/**
 * Resolving a token is the browser's job: only it walks the `var()` chain the
 * way the stylesheet consumers do. The probe carries the same
 * `hsl(var(--token))` declaration shape Tailwind emits for `bg-*`, and opts out
 * of the stylesheet's 200ms colour transition ("Color transitions for theme
 * switching") — without that, a read taken right after an appearance flip
 * returns the colour the transition started from rather than the palette.
 *
 * `probe.remove()` matters: this runs again on every appearance change, and a
 * leaked node per switch would accumulate.
 */
export function readTerminalTheme(): ITheme {
  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.transition = 'none';
  document.body.appendChild(probe);

  try {
    const theme: ITheme = {};
    for (const [key, token] of Object.entries(TERMINAL_THEME_TOKENS) as Array<
      [ThemedColourKey, string]
    >) {
      probe.style.color = `hsl(var(${token}))`;
      theme[key] = getComputedStyle(probe).color;
    }

    return theme;
  } finally {
    probe.remove();
  }
}

/**
 * The stack xterm falls back to when neither a theme nor the user names one.
 *
 * This is the single TS literal for the value; the base stylesheet mirrors it as
 * `--term-font-family`, which the contract requires the base layer to declare so
 * an overlay may redeclare it. Each copy is anchored by a test, so changing one
 * alone is a red test rather than a silent divergence: the stylesheet's copy by
 * the token contract's baseline (`tests/theme-tokens/token-contract.spec.ts`),
 * this literal by `tests/theme-tokens/terminal-tokens.spec.ts`.
 */
export const FALLBACK_TERMINAL_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';

/**
 * The stack a theme declares for the terminal, or null when it declares none.
 *
 * The value check is what makes "no value" observable. `font-family` is
 * inherited, so a token carrying no value leaves the probe's declaration invalid
 * at computed-value time and the probe silently reads the *body's* stack — a
 * real font stack that nothing downstream could tell from a declared one. Asking
 * the token for its computed value first separates the two: `getPropertyValue`
 * returns `''` when a custom property has no value, which covers both a token
 * nothing declares and an empty declaration (`--term-font-family: ;`, which a
 * `.css` theme may write). A `var()` fallback argument cannot stand in for this
 * — an empty value is not guaranteed-invalid, so the fallback never fires for it.
 *
 * The read is taken off `body`, the same node the probe hangs from, so a theme
 * that declares the token on `body` rather than `:root` is seen by both; reading
 * elsewhere would reintroduce the scope split the two channels must agree on
 * (§3.6).
 *
 * Known limit: a value that is present but not a valid `font-family` (e.g.
 * `0 0% 0%`) still lands on the body's stack, because the browser drops the
 * declaration rather than reporting it. Recorded rather than guessed at — a
 * "looks like the body's stack" heuristic would misfire on themes that
 * deliberately align the terminal font with the UI font.
 */
export function readThemedTerminalFontFamily(): string | null {
  const declared = getComputedStyle(document.body).getPropertyValue('--term-font-family').trim();
  if (!declared) return null;

  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.transition = 'none';
  probe.style.fontFamily = 'var(--term-font-family)';
  document.body.appendChild(probe);

  try {
    return getComputedStyle(probe).fontFamily;
  } finally {
    probe.remove();
  }
}

/**
 * The stack xterm should use, given the user's preference.
 *
 * `'theme'` means the user has expressed no opinion, so the theme's stack (or
 * the fallback) wins; a concrete id is the user overriding the theme. The two
 * never share a variable, which is why no cascade rule is needed here (§3.2).
 */
export function resolveTerminalFontFamily(choice: TerminalFontFamilyId): string {
  if (choice === 'theme') return readThemedTerminalFontFamily() ?? FALLBACK_TERMINAL_FONT_FAMILY;
  return CODE_FONT_FAMILY_CSS[choice];
}
