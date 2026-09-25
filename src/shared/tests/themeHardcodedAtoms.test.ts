import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { NEUTRAL_EXEMPTIONS } from '@/shared/tests/themeHardcodedAllowlist';
import {
  findOpacityCoupledAtoms,
  scanThemeHardcodedAtoms,
  type AtomHit,
} from '@/shared/tests/themeHardcodedAtoms';

/**
 * Convergence gate for §5.7's neutral utilities.
 *
 * Stage 0 is finished when the repo holds no hardcoded neutral utility outside
 * the exemption list — not when the planned slices are done. This test makes
 * that measurable: the checked-in snapshot is the *remaining* work, so every
 * cluster migration must lower it explicitly (the update is deliberate, like
 * `token-baseline.json`) and any new hardcoded colour fails immediately instead
 * of joining a slowly growing pile.
 *
 * Counts rather than line numbers: line numbers churn with unrelated edits,
 * while a per-file count only moves when a hit is actually added or removed.
 * Counting per atom as well catches a swap that keeps a file's total.
 *
 *   UPDATE_THEME_HARDCODED_BASELINE=1 npm run test:client -- themeHardcodedAtoms
 */

const BASELINE_PATH = join(process.cwd(), 'src/shared/tests/theme-hardcoded-baseline.json');
const UPDATE = process.env.UPDATE_THEME_HARDCODED_BASELINE === '1';

type Snapshot = {
  /** Hits still to migrate, repo-wide. */
  total: number;
  byFile: Record<string, number>;
  byAtom: Record<string, number>;
};

const isExempted = (hit: AtomHit) =>
  NEUTRAL_EXEMPTIONS.some((rule) => rule.file === hit.file && rule.token === hit.token);

function toRecord(entries: Array<[string, number]>): Record<string, number> {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

function measure(): { snapshot: Snapshot; remaining: AtomHit[] } {
  const all = scanThemeHardcodedAtoms();
  const remaining = all.filter((hit) => !isExempted(hit));

  const byFile = new Map<string, number>();
  const byAtom = new Map<string, number>();
  for (const hit of remaining) {
    byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1);
    const atom = `${hit.utility}: ${hit.family}${hit.step ? `-${hit.step}` : ''}`;
    byAtom.set(atom, (byAtom.get(atom) ?? 0) + 1);
  }

  return {
    snapshot: {
      total: remaining.length,
      byFile: toRecord([...byFile.entries()]),
      byAtom: toRecord([...byAtom.entries()]),
    },
    remaining,
  };
}

function diffCounts(
  label: string,
  expected: Record<string, number>,
  actual: Record<string, number>,
): string[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.flatMap((key) => {
    const want = expected[key] ?? 0;
    const got = actual[key] ?? 0;
    return want === got ? [] : [`${label} ${key}: baseline ${want}, now ${got}`];
  });
}

/**
 * The one trap the convergence snapshot cannot see.
 *
 * A named colour paired with a legacy `*-opacity-*` utility paints the same
 * colour as the `/modifier` spelling, but only the second survives
 * tokenisation: the legacy pair renders through `--tw-bg-opacity`, which the
 * token form never reads. Renaming such an atom would leave the snapshot one
 * hit smaller *and* silently drop the transparency, so the shape gets its own
 * gate. No exemption list: the fix is always to collapse the pair first.
 */
test('no named colour is paired with a legacy opacity utility', () => {
  const coupled = findOpacityCoupledAtoms();

  const suggestions = coupled.map(({ file, line, atom, opacityUtility }) => {
    const value = opacityUtility.slice(opacityUtility.indexOf('-opacity-') + '-opacity-'.length);
    return `  ${file}:${line} ${atom} + ${opacityUtility} -> collapse to ${atom}/${value}`;
  });

  expect(
    coupled.map(({ file, line, atom, opacityUtility }) => `${file}:${line} ${atom} ${opacityUtility}`),
    `named colours a token rename would silently blank out:\n${suggestions.join('\n')}`,
  ).toEqual([]);
});

test('the exemption list has no dead rules', () => {
  const all = scanThemeHardcodedAtoms();
  const unused = NEUTRAL_EXEMPTIONS.filter(
    (rule) => !all.some((hit) => hit.file === rule.file && hit.token === rule.token),
  );
  expect(
    unused,
    `exemptions that match nothing (the hit was migrated or renamed — drop the rule):\n${unused
      .map((rule) => `${rule.file} ${rule.token}`)
      .join('\n')}`,
  ).toEqual([]);
});

test('hardcoded neutral utilities match the checked-in snapshot', () => {
  const { snapshot, remaining } = measure();

  if (UPDATE) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Snapshot;

  const drifts = [
    ...(baseline.total === snapshot.total
      ? []
      : [`total: baseline ${baseline.total}, now ${snapshot.total}`]),
    ...diffCounts('file', baseline.byFile, snapshot.byFile),
    ...diffCounts('atom', baseline.byAtom, snapshot.byAtom),
  ];

  const sample = remaining
    .slice(0, 10)
    .map((hit) => `  ${hit.file}:${hit.line} ${hit.token}`)
    .join('\n');

  expect(
    drifts,
    `hardcoded neutral utilities drifted from the snapshot:\n${drifts.join('\n')}\n\n` +
      `first remaining hits:\n${sample}\n\n` +
      'Migrate them, or exempt them with a reason, then regenerate: ' +
      'UPDATE_THEME_HARDCODED_BASELINE=1 npm run test:client -- themeHardcodedAtoms',
  ).toEqual([]);
});
