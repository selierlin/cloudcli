import type { UserThemeAppearance } from '@/shared/userThemeTokens';

/**
 * The §5.10 contrast contract, and the one place it is written down.
 *
 * §5.10 makes two promises: body-size text clears WCAG AA (4.5:1), and the focus
 * ring stays visible against the page it sits on (3:1, the clause it calls hard).
 * For the themes that ship, `tests/theme-tokens/contrast.spec.ts` measures both
 * in a real browser; for the themes users write, option A's compiler attaches a
 * **non-blocking** warning built from this module. `CONTRAST_PAIRS` is shared by
 * the two so they cannot drift into two different contracts.
 *
 * **What makes a pair judgeable, and what does not.** A user theme is usually
 * partial — the documented option A example moves `--primary` and nothing else —
 * so a check that only looked at pairs the file states *twice* would be blind to
 * the whole `coverage: accent` class of theme, and to what §5.10 is for. The side
 * the file does not state is therefore read from the **base palette**:
 * `BASE_PAIR_COLORS` is the shipped `:root` / `.dark` value of every token the
 * pairs name, signed in and guarded by `contrast.spec.ts` — which also pins the
 * maths below to what the browser paints. It is a copy, and copies drift; the
 * guard is what makes the drift fail loudly instead of warning wrongly.
 *
 * **Silence is not a pass.** Three things stop a pair from being judged, and each
 * is a real boundary rather than an oversight: a side whose value only the
 * stylesheet can resolve (a reference that leaves the file), a reference cycle,
 * and a value carrying alpha. Every pair is otherwise judged, including the ones
 * a theme leaves entirely alone — those resolve to the base on both sides, and
 * the base is guarded to clear its own floors, which is what makes every warning
 * this returns a statement about something the author wrote.
 *
 * The warning is **non-blocking**, as §5.10 requires: a theme that is hard to
 * read is still a theme the user asked for.
 */

/** One pair §5.10 puts a floor under: what is painted, what is behind it, and the floor. */
type ContrastPair = {
  /** The token painted as text, or as the visible indicator. */
  ink: string;
  /** The token painted behind it. */
  surface: string;
  /** The WCAG AA floor: 4.5 for text, 3 for a non-text indicator. */
  min: number;
};

/**
 * The pairs the contract covers: §5.10's two clauses, plus the button label on
 * its own fill. It is deliberately not an exhaustive text × surface matrix —
 * each pair here is one the stylesheet actually paints. The button pair is
 * neither clause's by name, but both overlay themes were authored against it
 * (`cc-ocean`'s comment records moving its light step off a 3.5:1 value, and
 * `cc-polar`'s records choosing one that clears 4.6:1), so it is in scope.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { ink: '--foreground', surface: '--background', min: 4.5 },
  { ink: '--foreground', surface: '--card', min: 4.5 },
  { ink: '--muted-foreground', surface: '--background', min: 4.5 },
  { ink: '--muted-foreground', surface: '--card', min: 4.5 },
  { ink: '--primary-foreground', surface: '--primary', min: 4.5 },
  { ink: '--ring', surface: '--background', min: 3 },
];

/** The appearance a pair is judged in. */
type Appearance = 'light' | 'dark';

/**
 * What every token `CONTRAST_PAIRS` names is worth with no theme picked, in each
 * appearance — the side a partial theme leaves alone.
 *
 * Kept here rather than read from the document because a warning belongs to the
 * *validator*, which is pure and runs where there is no document (the paste box
 * compiles before anything is applied, and the unit tests compile in jsdom with
 * no stylesheet at all). The values are the shipped base's resolved triplets;
 * `contrast.spec.ts` fails if they stop matching the stylesheet, and fails if the
 * maths below stops agreeing with the browser about what they mean.
 */
export const BASE_PAIR_COLORS: Record<Appearance, Record<string, string>> = {
  light: {
    '--foreground': '36 25% 4%',
    '--background': '44 22% 96%',
    '--card': '0 0% 100%',
    '--muted-foreground': '40 5% 43%',
    '--primary': '221.2 83.2% 53.3%',
    '--primary-foreground': '210 40% 98%',
    '--ring': '221.2 83.2% 53.3%',
  },
  dark: {
    '--foreground': '40 8% 93%',
    '--background': '0 0% 8%',
    '--card': '0 0% 12%',
    '--muted-foreground': '0 0% 60%',
    '--primary': '217.2 91.2% 59.8%',
    '--primary-foreground': '0 0% 8%',
    '--ring': '217.2 91.2% 59.8%',
  },
};

/**
 * The three 8-bit sRGB channels a browser paints for an `H S% L%` triplet.
 *
 * Rounded to whole channels because that is what the browser serialises and
 * paints, and this verdict has to be the same number `contrast.spec.ts` measures.
 * The two agree exactly when rounded and differ in the second decimal otherwise
 * (the base's `--muted-foreground` on `--background` reads 4.62 as painted and
 * 4.59 unrounded), and a warning that disagreed with the guard about a borderline
 * theme would be worse than no warning.
 */
function paintedChannels(triplet: string): [number, number, number] | null {
  const parts = triplet.match(/\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 3) return null;
  const values = parts.slice(0, 3).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;

  const [hue, saturation, lightness] = values;
  const sector = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((sector / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    sector < 60 ? [c, x, 0]
    : sector < 120 ? [x, c, 0]
    : sector < 180 ? [0, c, x]
    : sector < 240 ? [0, x, c]
    : sector < 300 ? [x, 0, c]
    : [c, 0, x];

  return [r, g, b].map((channel) => Math.round(255 * (channel + m))) as [number, number, number];
}

/** WCAG 2.x relative luminance of a colour, from its painted channels. */
function luminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** The WCAG contrast ratio between two triplets, or null when either is not one. */
export function contrastRatioOfTriplets(ink: string, surface: string): number | null {
  const inkChannels = paintedChannels(ink);
  const surfaceChannels = paintedChannels(surface);
  if (!inkChannels || !surfaceChannels) return null;

  const a = luminance(inkChannels);
  const b = luminance(surfaceChannels);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** One side of a pair as the compiler read it: a colour, or a pointer to another token. */
export type ThemeColorValue =
  | { kind: 'literal'; triplet: string }
  | { kind: 'reference'; target: string };

/** A pair that misses its floor, and the appearance it misses it in. */
export type ThemeContrastWarning = {
  ink: string;
  surface: string;
  appearance: Appearance;
  ratio: number;
  min: number;
};

/**
 * The triplet one side of a pair resolves to, or null when this module cannot
 * know it.
 *
 * The theme wins over the base. A reference is followed through the theme's own
 * declarations first, so a colour the file defines once and points at twice is
 * still judged (`--foreground: var(--card)` is a real way to write an unreadable
 * theme). A reference the file does not define belongs to the stylesheet's own
 * cascade, which is not something this module can resolve with no browser; a
 * cycle resolves to nothing at all.
 */
function resolveTriplet(
  token: string,
  declared: ReadonlyMap<string, ThemeColorValue>,
  appearance: Appearance,
  seen: ReadonlySet<string>,
): string | null {
  const value = declared.get(token);
  if (!value) return BASE_PAIR_COLORS[appearance][token] ?? null;
  if (value.kind === 'literal') return value.triplet;
  if (seen.has(token)) return null;
  return resolveTriplet(value.target, declared, appearance, new Set([...seen, token]));
}

/**
 * The contrast §5.10 would warn the author about, for the tokens a theme declares.
 *
 * `scope` is the appearance the overlay is written for (§5.6 v13), which is also
 * the base it will sit on: a theme scoped to one appearance meets one base, while
 * a `system` theme — the default, and what §5.5's example uses — meets both, so it
 * is judged twice and a pair that fails in only one of them says which.
 */
export function findContrastWarnings(
  declared: ReadonlyMap<string, ThemeColorValue>,
  scope: UserThemeAppearance,
): ThemeContrastWarning[] {
  const appearances: readonly Appearance[] = scope === 'system' ? ['light', 'dark'] : [scope];
  const warnings: ThemeContrastWarning[] = [];

  for (const appearance of appearances) {
    for (const { ink, surface, min } of CONTRAST_PAIRS) {
      const inkTriplet = resolveTriplet(ink, declared, appearance, new Set());
      const surfaceTriplet = resolveTriplet(surface, declared, appearance, new Set());
      if (!inkTriplet || !surfaceTriplet) continue;

      const ratio = contrastRatioOfTriplets(inkTriplet, surfaceTriplet);
      if (ratio !== null && ratio < min) {
        warnings.push({ ink, surface, appearance, ratio, min });
      }
    }
  }

  return warnings;
}
