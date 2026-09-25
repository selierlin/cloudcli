import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  matchUsage,
  scanScaleTokenAtoms,
  scanThemeHardcodedAtoms,
  usageKey,
  type AtomHit,
  type TokenHit,
} from '@/shared/tests/themeHardcodedAtoms';

/**
 * The *pairing* half of §5.7's neutral-colour DoD, and the one the
 * convergence snapshot cannot express.
 *
 * `theme-hardcoded-baseline.json` proves literals are *disappearing*; it is
 * blind to what replaced them. `neutralScale.test.ts` proves the `n-*` classes
 * *can* carry the right value; it is blind to which colour each call site
 * actually chose. Together they leave a gap wide enough for a migration that
 * silently paints the wrong step or drops a `/50`. (Both were live misses in
 * the 0-E2 reverse verification.)
 *
 * The conservation law closes it: a faithful migration is a *rename*, so the
 * repo-wide census of neutral colours — keyed by utility, family, step and
 * transparency — must not move. Literal spellings and `n-*` spellings share a
 * bucket, so moving a call site from one to the other leaves its bucket alone,
 * while changing what it paints moves a count into a neighbouring bucket and
 * fails here.
 *
 * The census, not the file list, is what is frozen: it needs no per-slice
 * registration, and it is derived from the same scanner as the baseline, so
 * the two can only disagree on purpose.
 *
 *   UPDATE_THEME_ATOM_CONSERVATION=1 npm run test:client -- themeAtomConservation
 */

const FROZEN_PATH = join(process.cwd(), 'src/shared/tests/theme-atom-conservation.json');
const UPDATE = process.env.UPDATE_THEME_ATOM_CONSERVATION === '1';

type Frozen = {
  /** Neutral colours in `src/` at freeze time, summed over both spellings. */
  total: number;
  /** `usageKey` -> occurrences. */
  byUsage: Record<string, number>;
};

type Census = {
  frozen: Frozen;
  /** Every hit, so a drifted bucket can name its own source locations. */
  hits: Array<AtomHit | TokenHit>;
};

function census(): Census {
  const hits: Array<AtomHit | TokenHit> = [
    ...scanThemeHardcodedAtoms(),
    ...scanScaleTokenAtoms(),
  ];
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const key = usageKey(hit);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const byUsage = Object.fromEntries(
    [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  return { frozen: { total: hits.length, byUsage }, hits };
}

/**
 * Guards the conservation law against its own failure mode: if the `n-*`
 * pattern stops matching, every tokenised call site joins the literal half of
 * the census on both sides of the comparison and the test goes green while
 * proving nothing. A frozen file cannot notice that — a blind refresh records
 * the collapsed census as if it were the truth — so the shape of the scan is
 * asserted directly.
 *
 * One assertion per thing the census keys on that is easy to lose silently.
 * `variants` and `opacity` both used to be recorded but unread, and the
 * literal-side `opacity` capture was dead outright (no capturing group in the
 * pattern) until this slice needed it.
 *
 * The literal half of the `opacity` assertion reads synthetic names: stage 0
 * ended with the last literal neutral gone from `src/`, so a repo count can no
 * longer distinguish a working capture from a dead one — it would read 0 either
 * way. Parsing an assembled pair directly keeps that half load-bearing for the
 * case it was written for, a literal coming back.
 */
test('the census scan does not collapse into a vacuous pass', () => {
  const expectPopulated = (count: number, what: string, consequence: string) =>
    expect(count, `${what} — ${consequence}`).toBeGreaterThan(0);

  const literals = scanThemeHardcodedAtoms();
  const tokens = scanScaleTokenAtoms();

  expectPopulated(
    tokens.length,
    'the token pattern matched nothing in `src/`',
    'the conservation law below would compare a literal-only census with itself',
  );
  expectPopulated(
    tokens.filter((hit) => hit.variants.length > 0).length,
    'no variant-prefixed `n-*` utility was scanned',
    'losing the `dark:` half of a pair would stop being visible',
  );
  expectPopulated(
    tokens.filter((hit) => hit.opacity !== null).length,
    'no `n-*` utility with a transparency modifier was scanned',
    'a migration that drops `/50` would stop being visible',
  );
  // Assembled rather than spelled out: Tailwind scans this file as content, so
  // a live utility name written here would ship in the bundle.
  const alpha = ['bg', 'gray', '100/50'].join('-');
  const solid = ['bg', 'gray', '100'].join('-');
  const literalOpacity = (name: string) => matchUsage(name)?.usage.opacity ?? null;

  expect(
    literalOpacity(alpha),
    'the literal `/50` spelling must parse with its transparency captured — a `/50` literal and a solid one would otherwise share a bucket, so the frozen side of the census would be wrong',
  ).toBe('50');
  expect(
    literalOpacity(solid),
    'and the solid spelling must take no transparency, or the two collapse into one bucket',
  ).toBe(null);
  expectPopulated(
    [...literals, ...tokens].filter((hit) => hit.utility.includes('-')).length,
    'no axis-qualified neutral utility was scanned',
    'side-qualified borders and offset rings would fall back outside every gate, which is the hole 0-E2e closed',
  );
});

test('every neutral colour is conserved across the migration', () => {
  const { frozen: now, hits } = census();

  if (UPDATE) {
    writeFileSync(FROZEN_PATH, `${JSON.stringify(now, null, 2)}\n`);
    return;
  }

  const before = JSON.parse(readFileSync(FROZEN_PATH, 'utf8')) as Frozen;
  const keys = [...new Set([...Object.keys(before.byUsage), ...Object.keys(now.byUsage)])].sort();

  const drifts = keys.flatMap((key) => {
    const want = before.byUsage[key] ?? 0;
    const got = now.byUsage[key] ?? 0;
    if (want === got) return [];
    const where = hits
      .filter((hit) => usageKey(hit) === key)
      .slice(0, 5)
      .map((hit) => `      ${hit.file}:${hit.line} ${hit.token}`)
      .join('\n');
    return [
      `${key}: frozen ${want}, now ${got}` +
        (want === 0
          ? '\n    appears only after the freeze — nothing painted this before:'
          : got === 0
            ? '\n    nothing paints this any more; was it mis-migrated?'
            : '\n    a migration moved call sites into or out of this colour:') +
        (where ? `\n${where}` : ''),
    ];
  });

  expect(
    drifts,
    `the census of neutral colours moved, so a migration was not a rename:\n${drifts.join('\n')}\n\n` +
      'shrinkage means a call site changed colour or lost its transparency; growth means a ' +
      'new neutral was painted (or a literal came back). Migrate faithfully, then regenerate ' +
      'the freeze in the same commit and check the JSON diff bucket by bucket: ' +
      'UPDATE_THEME_ATOM_CONSERVATION=1 npm run test:client -- themeAtomConservation',
  ).toEqual([]);
});
