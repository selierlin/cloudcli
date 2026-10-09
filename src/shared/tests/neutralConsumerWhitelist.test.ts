import { expect, test } from 'vitest';

import {
  RESIDUAL_CATEGORIES,
  NEUTRAL_RESIDUAL_WHITELIST,
  neutralSignature,
} from '@/shared/tests/neutralConsumerWhitelist';
import {
  scanScaleTokenAtoms,
  scanThemeHardcodedAtoms,
  type AtomHit,
  type TokenHit,
} from '@/shared/tests/themeHardcodedAtoms';

/**
 * The second half of §5.7's neutral-colour acceptance, and the one route B
 * needs: the conservation law proves the census did not move, but it cannot
 * say whether a surviving neutral is *sanctioned*. This gate closes that —
 * every residual neutral consumer (literal or `--n-*`) must be a signature on
 * the explicit whitelist, and every whitelisted signature must still have a
 * consumer.
 *
 * Together they are the DoD: conservation freezes the *count* of each bucket,
 * this freezes the *set* of signatures and carries the reason each survives.
 * Neither subsumes the other — a bucket can be conserved at the wrong set, and
 * a signature can be sanctioned at the wrong count.
 *
 * The census here is the same one the conservation law reads (both spellings,
 * `usageKey`'s input set), so the two cannot silently disagree about which
 * lines they are governing.
 */

type ResidualHit = AtomHit | TokenHit;

function residualCensus(): ResidualHit[] {
  return [...scanThemeHardcodedAtoms(), ...scanScaleTokenAtoms()];
}

const whitelisted = new Map(NEUTRAL_RESIDUAL_WHITELIST.map((entry) => [entry.signature, entry]));

test('every whitelist entry names a category that carries a reason', () => {
  const orphans = NEUTRAL_RESIDUAL_WHITELIST.filter(
    (entry) => !RESIDUAL_CATEGORIES[entry.category]?.reason?.trim(),
  );
  expect(
    orphans,
    `whitelist entries whose category has no reason (a sanctioned neutral with no stated why):\n${orphans
      .map((entry) => `  ${entry.signature} -> ${entry.category}`)
      .join('\n')}`,
  ).toEqual([]);
});

test('every residual neutral consumer is on the whitelist', () => {
  const hits = residualCensus();
  const unwhitelisted = hits.filter((hit) => !whitelisted.has(neutralSignature(hit)));

  const detail = unwhitelisted
    .slice(0, 20)
    .map((hit) => `  ${hit.file}:${hit.line} ${hit.token} -> ${neutralSignature(hit)}`)
    .join('\n');

  expect(
    unwhitelisted.map((hit) => `${hit.file}:${hit.line} ${hit.token}`),
    `neutral consumers outside the whitelist (route B keeps only the declared families):\n${detail}\n\n` +
      'Either migrate them onto an L2 token, or — if the family is a deliberate keep — add the ' +
      'signature to `NEUTRAL_RESIDUAL_WHITELIST` with its category. A new entry is a design ' +
      'decision, not a silent allowance.',
  ).toEqual([]);
});

test('the whitelist has no dead entries', () => {
  const live = new Set(residualCensus().map(neutralSignature));
  const dead = NEUTRAL_RESIDUAL_WHITELIST.filter((entry) => !live.has(entry.signature));

  expect(
    dead.map((entry) => `${entry.signature} (${entry.category})`),
    `whitelisted signatures with no remaining consumer (the family was fully migrated or renamed — ` +
      `drop the entry):\n${dead.map((entry) => `  ${entry.signature} (${entry.category})`).join('\n')}`,
  ).toEqual([]);
});
