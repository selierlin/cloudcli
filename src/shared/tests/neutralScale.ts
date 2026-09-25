import colors from 'tailwindcss/colors';

/**
 * The compatibility scale behind `--n-*` (see the L1/L2 notes in
 * `src/index.css`).
 *
 * 0-E moves Tailwind's named neutrals — ~1.5k utility classes forming the UI
 * skeleton — onto tokens. The promise for that slice is "not a pixel moves", so
 * the scale is deliberately not re-picked: every step keeps Tailwind's own
 * value, only converted to the HSL triplet form the stylesheet uses.
 *
 * `gray` carries the bulk of the migration; `zinc` / `slate` / `neutral` are
 * the stragglers, which keep their own hue rather than being folded into `gray`
 * because the fold would be a pixel move. `stone` is absent because nothing
 * uses it.
 *
 * This module is the single source of truth for that claim, and stays pure data
 * on purpose: `tests/theme-tokens/main.ts` bundles it into a browser fixture, so
 * the Node-only half of the proof — compiling the classes through Tailwind —
 * lives in `neutralScaleCompiler.ts`. The test derives the expected triplet from
 * `tailwindcss/colors` at run time instead of restating literals, so a
 * hand-edited palette entry fails (the value drifted from Tailwind) and a
 * Tailwind bump fails (the ramp moved, review needed) rather than both passing
 * silently.
 */

export const NEUTRAL_FAMILIES = ['gray', 'zinc', 'slate', 'neutral'] as const;

export type NeutralFamily = (typeof NEUTRAL_FAMILIES)[number];

export const NEUTRAL_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export type NeutralStep = (typeof NEUTRAL_STEPS)[number];

/** Tailwind's hex for one step of one family — the literal each token must reproduce. */
export function familyHex(family: NeutralFamily, step: NeutralStep): string {
  const scale = colors[family] as unknown as Record<string, string>;
  const hex = scale[String(step)];
  if (!hex) throw new Error(`tailwindcss/colors.${family} has no step ${step}`);
  return hex;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((v) => Math.round(v * 255)
      .toString(16)
      .padStart(2, '0'))
    .join('')}`;
}

/**
 * A hex colour as the stylesheet's `H S% L%` triplet, at one decimal — the
 * precision the existing palette uses (`0 84.2% 60.2%`). Every step of every
 * Tailwind neutral family round-trips to the original hex at this precision,
 * which is what makes the migration provably neutral instead of eyeballed.
 */
export function hexToHslTriplet(hex: string): string {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }

  const round = (value: number, factor: number) => Math.round(value * factor) / factor;
  const h1 = round((h + 360) % 360, 10);
  const s1 = round(s * 100, 10);
  const l1 = round(l * 100, 10);
  const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return `${fmt(h1)} ${fmt(s1)}% ${fmt(l1)}%`;
}

/**
 * The inverse, used to prove the triplet is lossless — that one-decimal HSL is
 * not merely "close to" Tailwind's hex but exactly it. Without that half the
 * equivalence could hold all the way down the chain and still paint a
 * marginally different colour.
 */
export function hslTripletToHex(triplet: string): string {
  const match = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(triplet.trim());
  if (!match) throw new Error(`not a bare HSL triplet: ${triplet}`);
  const [, h, s, l] = match;
  return rgbToHex(hslToRgb(Number(h), Number(s) / 100, Number(l) / 100));
}

/** `('gray', 50)` -> `--palette-gray-50`. */
export const paletteName = (family: NeutralFamily, step: NeutralStep) =>
  `--palette-${family}-${step}`;

/** `('gray', 50)` -> `--n-gray-50`. */
export const tokenName = (family: NeutralFamily, step: NeutralStep) => `--n-${family}-${step}`;

/** Every `--n-*` the scale declares, across all four families. */
export const SCALE_TOKEN_NAMES = NEUTRAL_FAMILIES.flatMap((family) =>
  NEUTRAL_STEPS.map((step) => tokenName(family, step)),
);

/**
 * The scale's whole vocabulary: the four ramps plus the two extremes, which
 * reuse the palette tokens that already existed rather than duplicating them.
 */
export const EXTREME_TOKENS = ['--n-white', '--n-black'] as const;

/** Declared as `--token: value`, one per line, anywhere in the stylesheet. */
export function readDeclarations(css: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of css.matchAll(/^[ \t]*(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gm)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}
