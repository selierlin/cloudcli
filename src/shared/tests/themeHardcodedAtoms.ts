import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Machine-readable half of §5.7's "hardcoded colour" acceptance: finds every
 * Tailwind *named neutral* utility in `src/`.
 *
 * The design doc splits named colours three ways — neutrals carry the UI
 * skeleton and must move onto tokens, status colours stay literal as a dark
 * fallback, brand/icon colours are exempt. Only the first class is work, so the
 * audit scans for neutrals and the exemption list has to spell out the few
 * deliberate exceptions rather than the 1700 coloured utilities.
 *
 * Unlike the grep in §5.7 this is variant-aware: `hover:bg-gray-100`,
 * `dark:bg-gray-800`, `prose-pre:bg-gray-900` and `bg-gray-900/50` all resolve
 * to the same atom.
 */
const NEUTRAL_FAMILIES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'black',
  'white',
] as const;

const COLOUR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'stroke',
  'fill',
  'from',
  'to',
  'via',
  'decoration',
  'placeholder',
  'shadow',
  'outline',
  'divide',
  'accent',
  'caret',
] as const;

/**
 * The utility half of a neutral class, as one alternation.
 *
 * Three of these colour something other than the element itself, and Tailwind
 * writes the qualifier *inside* the name: one side of a border, one axis of a
 * divider, the offset of a focus ring. A prefix-only pattern reads the
 * qualified spelling as the bare utility followed by a non-colour token and
 * drops it, which left 15 call sites — a tooltip's four arrows, two modal
 * overlays' focus rings — outside every gate until 0-E2e closed the hole.
 *
 * `ring-offset` is listed ahead of `ring` so the longer spelling is tried
 * first. The groups are non-capturing on purpose: `ATOM`'s numbering is part
 * of the conservation law's key, so the qualifier must not shift `family`.
 *
 * (No example is spelled out: Tailwind scans `src/` — comments included — as
 * content, so a live utility name written here would ship in the bundle.)
 */
const UTILITY = [
  'ring-offset',
  'border(?:-[trblxy])?',
  'divide(?:-[xy])?',
  ...COLOUR_UTILITIES.filter((utility) => utility !== 'border' && utility !== 'divide'),
].join('|');

/** Everything a neutral utility says, except where it is written. */
export type NeutralUsage = {
  /** Variant prefixes in source order, e.g. `['dark', 'hover']`. */
  variants: string[];
  utility: string;
  family: string;
  step: string | null;
  opacity: string | null;
};

/** A literal `gray`-and-friends utility: the pre-migration spelling. */
export type AtomHit = NeutralUsage & {
  /** Repo-relative path with POSIX separators, e.g. `src/modules/chat/X.tsx`. */
  file: string;
  /** 1-based. */
  line: number;
  /** The whole class token, e.g. `dark:hover:bg-gray-100`. */
  token: string;
};

/** A `n-*` utility: the tokenised side of the conservation law. */
export type TokenHit = NeutralUsage & {
  /** Repo-relative path with POSIX separators. */
  file: string;
  /** 1-based. */
  line: number;
  /** The whole class token as written, variants and modifier included. */
  token: string;
};

/**
 * `dark:hover bg: gray-100/50` — one bucket of the conservation law.
 *
 * Both sides key on this: the literal spelling of a colour and its
 * `n-`-prefixed spelling land in the same bucket, so a migration that changes
 * the utility, the family, the step, the transparency **or the variant
 * context** moves a count instead of passing silently. That is precisely what
 * the convergence snapshot cannot see — it only counts what is still *left to
 * migrate*, and says nothing about what was migrated *into*.
 *
 * The variant chain is the one part of the token a plain family→token
 * substitution cannot disturb, so keying on it is stricter than the rename
 * strictly requires. It is included because nothing else in the repo reads
 * `variants` at all: a hand edit that turns a dark-only rule into a light-only
 * one is a visible regression that would otherwise pass every gate.
 *
 * (Examples above are written as keys, not as classes: Tailwind scans comments
 * in `src/` as content, so a live utility name written here ships to `dist`.)
 */
export function usageKey(usage: NeutralUsage): string {
  const variant = usage.variants.length ? `${usage.variants.join(':')} ` : '';
  const step = usage.step ? `-${usage.step}` : '';
  const alpha = usage.opacity ? `/${usage.opacity}` : '';
  return `${variant}${usage.utility}: ${usage.family}${step}${alpha}`;
}

// The opacity suffix is captured because the conservation law keys on it: a
// migration that drops `/50` would otherwise look identical to one that keeps
// it (`bg: zinc-800` either way). It is either a percentage or an arbitrary
// value (`shadow-black/[0.025]`, which the §5.7 grep also catches).
const ATOM = new RegExp(
  `^(${UTILITY})-(${NEUTRAL_FAMILIES.join('|')})(?:-(\\d{2,3}))?(?:\\/(\\d{1,3}|\\[[^\\]]*\\]))?$`,
);

/**
 * The families `--n-*` backs. Deliberately narrower than `NEUTRAL_FAMILIES`:
 * `stone` has no token because nothing used it (see the L1/L2 notes in
 * `src/index.css`), and the two extremes are step-less.
 */
const TOKEN_FAMILIES = ['gray', 'zinc', 'slate', 'neutral'] as const;
const TOKEN_EXTREMES = ['white', 'black'] as const;

// The tokenised spelling a migration produces. Same shape as `ATOM` so the two
// sides of the conservation law normalise to one key.
const TOKEN_SCALED = new RegExp(
  `^(${UTILITY})-n-(${TOKEN_FAMILIES.join('|')})-(\\d{2,3})(?:\\/(\\d{1,3}|\\[[^\\]]*\\]))?$`,
);
const TOKEN_EXTREME = new RegExp(
  `^(${UTILITY})-n-(${TOKEN_EXTREMES.join('|')})(?:\\/(\\d{1,3}|\\[[^\\]]*\\]))?$`,
);

// Tailwind's pre-`/modifier` way of setting transparency, e.g. `bg-opacity-*`.
// Paired with a named colour it makes the colour render through
// `rgb(… / var(--tw-bg-opacity, 1))`, a shape the token form does not have.
// (Spelled with a wildcard, not a real value: Tailwind scans comments in `src/`
// as content, so naming a live class here would ship it in the production CSS.)
const LEGACY_OPACITY = new RegExp(
  `^(${COLOUR_UTILITIES.join('|')})-opacity-(?:\\d{1,3}|\\[[^\\]]*\\])$`,
);

// Characters that cannot appear inside a utility name, so they separate class
// tokens. `/` is deliberately absent (it carries the opacity suffix), as are
// `[` and `]` — arbitrary values make them part of the token.
const TOKEN = /[^\s"'`{}()<>,;=+*&|!?]+/g;

/** The workspace root; the audit always runs with it as cwd. */
const REPO_ROOT = process.cwd();
const SRC_ROOT = join(REPO_ROOT, 'src');

/**
 * Test directories are out of scope: a spec that quotes `bg-gray-100` is
 * describing behaviour, never painting product UI — and this audit's own assets
 * have to be able to name the classes they look for. Only `src/` code that
 * renders is measured.
 */
const TEST_DIR = 'tests';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== TEST_DIR) walk(path, out);
    } else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const toRepoPath = (absolute: string) =>
  relative(REPO_ROOT, absolute).split(sep).join('/');

/** One source line, reduced to the tokens either scan cares about. */
type ScannedLine = {
  file: string;
  line: number;
  atoms: AtomHit[];
  /** Already-tokenised `n-*` utilities; the other half of the conservation law. */
  tokens: TokenHit[];
  /** Legacy `*-opacity-*` utilities on the line; see `findOpacityCoupledAtoms`. */
  opacityUtilities: string[];
};

/** A token's name half, once it is known to name a neutral colour. */
type MatchedUsage = {
  /** Everything but the variant chain, which lives outside the name half. */
  usage: Omit<NeutralUsage, 'variants'>;
  /** Whether the source spelled it the token way (`n-*`) or the literal way. */
  tokenised: boolean;
};

/** `null` unless the name is a neutral colour in one of its two spellings. */
function matchUsage(name: string): MatchedUsage | null {
  const atom = ATOM.exec(name);
  if (atom) {
    return {
      usage: { utility: atom[1], family: atom[2], step: atom[3] ?? null, opacity: atom[4] ?? null },
      tokenised: false,
    };
  }
  const scaled = TOKEN_SCALED.exec(name);
  if (scaled) {
    return {
      usage: {
        utility: scaled[1],
        family: scaled[2],
        step: scaled[3],
        opacity: scaled[4] ?? null,
      },
      tokenised: true,
    };
  }
  const extreme = TOKEN_EXTREME.exec(name);
  if (extreme) {
    return {
      usage: {
        utility: extreme[1],
        family: extreme[2],
        step: null,
        opacity: extreme[3] ?? null,
      },
      tokenised: true,
    };
  }
  return null;
}

function scanSourceLines(): ScannedLine[] {
  const lines: ScannedLine[] = [];
  for (const absolute of walk(SRC_ROOT).sort()) {
    const file = toRepoPath(absolute);
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        const atoms: AtomHit[] = [];
        const tokens: TokenHit[] = [];
        const opacityUtilities: string[] = [];
        for (const match of text.matchAll(TOKEN)) {
          const token = match[0];
          const colon = token.lastIndexOf(':');
          const name = token.slice(colon + 1);
          if (LEGACY_OPACITY.test(name)) opacityUtilities.push(token);

          const matched = matchUsage(name);
          if (!matched) continue;
          const { usage, tokenised } = matched;
          const hit = {
            file,
            line: index + 1,
            token,
            variants: colon === -1 ? [] : token.slice(0, colon).split(':'),
            ...usage,
          };
          (tokenised ? tokens : atoms).push(hit);
        }
        if (atoms.length || tokens.length || opacityUtilities.length) {
          lines.push({ file, line: index + 1, atoms, tokens, opacityUtilities });
        }
      });
  }
  return lines;
}

/** One pass over `src/`, shared by both scans below. */
let scanned: ScannedLine[] | null = null;
const sourceLines = () => (scanned ??= scanSourceLines());

export function scanThemeHardcodedAtoms(): AtomHit[] {
  return sourceLines().flatMap((line) => line.atoms);
}

/**
 * The other half of `scanThemeHardcodedAtoms`: the `n-*` utilities already
 * migrated. A literal hit and a token hit of the same colour are
 * interchangeable under `usageKey`, which is what lets one frozen histogram
 * cover both.
 */
export function scanScaleTokenAtoms(): TokenHit[] {
  return sourceLines().flatMap((line) => line.tokens);
}

/** A named colour that must not be tokenised until its pair is collapsed. */
export type OpacityCoupling = {
  file: string;
  /** 1-based. */
  line: number;
  /** The class token to collapse, e.g. `bg-black`. */
  atom: string;
  /** The legacy utility that goes with it, e.g. `bg-opacity-*`. */
  opacityUtility: string;
};

/**
 * Named colours sharing a line with a legacy `*-opacity-*` utility.
 *
 * A named colour paired with one of those halves itself through
 * `--tw-bg-opacity`; the tokenised spelling `bg-n-black` emits
 * `hsl(var(--n-black))` with no opacity variable involved, so renaming the atom
 * would drop the transparency. Every value-level check would still pass — the
 * token does hold black — which is why this is scanned separately: it is a
 * *declaration-shape* trap, not a value one.
 *
 * There is no legitimate reason for the pair to exist, so this returns
 * offenders rather than carrying an exemption list (contrast
 * `NEUTRAL_EXEMPTIONS`). The fix is always the same: collapse to the
 * `/modifier` spelling, whose alpha the token form does interpolate.
 *
 * Line-level rather than element-level on purpose: a false positive costs one
 * look, a false negative costs a silently invisible modal backdrop.
 */
export function findOpacityCoupledAtoms(): OpacityCoupling[] {
  return sourceLines().flatMap(({ file, line, atoms, opacityUtilities }) =>
    atoms.flatMap((atom) =>
      opacityUtilities.map((opacityUtility) => ({
        file,
        line,
        atom: atom.token,
        opacityUtility,
      })),
    ),
  );
}
