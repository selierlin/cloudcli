import type { ITheme } from '@xterm/xterm';

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
