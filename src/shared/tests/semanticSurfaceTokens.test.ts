import { expect, test } from 'vitest';

import { scanScaleTokenAtoms } from '@/shared/tests/themeHardcodedAtoms';

/**
 * A surface must paint a *semantic* token (`bg-card`, `bg-popover`), because
 * those are what a theme recolours. `bg-n-white` is the frozen extreme: it maps
 * to `--palette-white`, which a theme may not move, so a face that reads it
 * stops following the theme in the light appearance — a white panel on a tinted
 * page. The dark half of those same elements already reads `dark:bg-n-gray-800`
 * (remappable), so the defect only shows up in light mode and reads as "the
 * card didn't get the hint" rather than as a broken pair.
 *
 * The conversion was a per-file sweep, and the way it fails is by being *repeated*:
 * a new panel picks `bg-n-white` because it looks like the neighbours, and no
 * other gate can see it — the conservation census records `bg: white` as a
 * bucket and cannot say whether the site is a symbol or a face, and the
 * token-contract checks never inspect class names at all. This freezes the
 * *shape* of what is left, so any new or moved `n-white` background has to be
 * justified here rather than slip in.
 *
 * Counted per file, not anchored to a line: the repo's other census
 * (`theme-atom-conservation.json`) keys on shapes for the same reason — a line
 * anchor turns every unrelated edit above it into a red test, which is how
 * "change the test to make it pass" starts.
 *
 * The predicate is `utility: bg`, `family: white`, `step: null` — deliberately
 * not "any `bg-n-*`": `bg-n-gray-*` is the sanctioned spelling for ~1.5k sites
 * and white is the only family a face may not use. It reads class *tokens*, so
 * a name quoted in a comment does not count (and neither does `text-n-white`,
 * which colours an icon on top of an image, not a surface).
 */
const EXPECTED_LIGHT_SURFACE_WHITES: Record<string, number> = {
  // Symbols: white here *is* the meaning — a knob gliding on a coloured track,
  // a crosshair dot, a kbd badge on a dark fill, a control on top of an image.
  // A theme must not tint these, so the frozen extreme is exactly right.
  'src/modules/settings/SettingsToggle.tsx': 1,
  'src/shared/ui/DarkModeToggle.tsx': 1,
  'src/modules/plugins/PluginSettingsTab.tsx': 1, // the `after:` pseudo-element knob
  'src/modules/browser-use/BrowserUsePanel.tsx': 1,
  'src/modules/chat/composer/PromptInput.tsx': 1, // the `/kbd` badge
  'src/modules/chat/transcript/ChatMessageImages.tsx': 2, // the button and its hover
  'src/modules/code-editor/CodeEditorMediaPreview.tsx': 1, // the iframe page itself is white
};

test('only the frozen-white symbols still paint a light surface', () => {
  const hits = scanScaleTokenAtoms().filter(
    (hit) => hit.utility === 'bg' && hit.family === 'white' && hit.step === null,
  );

  const counts: Record<string, number> = {};
  for (const hit of hits) counts[hit.file] = (counts[hit.file] ?? 0) + 1;

  const files = Object.keys(EXPECTED_LIGHT_SURFACE_WHITES);
  // Anti-vacuity: an emptied table would make the comparison below trivially
  // true for an empty scan, and a scanner that stopped matching would read as
  // "everything is clean".
  expect(files.length, 'the expectation table is empty — nothing is being checked').toBeGreaterThan(
    0,
  );
  expect(hits.length, 'the scan matched no `n-white` background anywhere').toBeGreaterThan(0);

  expect(
    counts,
    'a light surface reads the frozen `n-white`. Paint it with `bg-card` (or `bg-popover` ' +
      'for a popover) and keep the `dark:` half as it is — or, if the white really is the ' +
      'point, add it here with the reason.',
  ).toEqual(EXPECTED_LIGHT_SURFACE_WHITES);
});
