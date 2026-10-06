import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BUILTIN_THEMES } from '@/shared/constants';

/**
 * The overlay contract.
 *
 * `cc-light` / `cc-dark` carry no overlay: they *are* the base palette the
 * stylesheet declares in `:root` / `.dark`, and the document falls back to one
 * of them whenever no overlay is picked. Every other built-in theme is an
 * overlay selected by `<html data-theme>` (see `BUILTIN_THEMES`), so the two
 * things this suite has to hold are:
 *
 * 1. **The overlay wins.** Its declarations must resolve as written in the
 *    browser, rather than being shadowed by another declaration of the same
 *    token. Note what this does *not* prove: in the processed stylesheet the
 *    base palette is not actually inside a `@layer` (Tailwind v3 flattens the
 *    source's `@layer base` into plain rules, measured at 0 `@layer` at-rules in
 *    both the fixture and the build), so today the win rests on document order.
 *    The design's rule — overlays are plain CSS, never inside a `@layer` — is
 *    therefore enforced *structurally* below, and is a robustness constraint
 *    rather than something the resolved values can evidence: a layered overlay
 *    would be ordered into that layer's bucket, and which way that falls depends
 *    on the layer order (later layers beat earlier ones; only unlayered beats
 *    all of them).
 * 2. **It wins by exactly as much as `coverage` claims.** An `accent` theme is
 *    allowed to move the accent family and the surfaces derived from it, and
 *    nothing else — no substrate, terminal, editor or graph token. That is the
 *    promise the selector's badge makes to the user, so it is asserted token by
 *    token rather than eyeballed.
 * 3. **The syntax slots are take-it-or-leave-it.** They are deliberately *not* in
 *    `SURFACES`: a theme whose reference palette has no syntax colours to copy
 *    must not be forced to invent a board, and a reference that only ships
 *    chrome must still be able to call itself `full`. That is the same argument the terminal-font round made for keeping
 *    its token out of `SURFACES`. What follows from leaving it open is the one
 *    rule below: a theme that names any syntax slot has to name all the ones the
 *    base palette declares for that appearance, or the block reads half in its
 *    palette and half in the base one.
 *
 *    Declaring a syntax slot is otherwise covered without a new assertion: the
 *    per-theme test reads every token an overlay declares, syntax included, and
 *    requires it to resolve as written.
 *
 * The overrides themselves are read out of the overlay block, so a change to a
 * theme's values flows into the expectations without a second hand-maintained
 * list.
 */

const STYLESHEET_PATH = fileURLToPath(new URL('../../src/index.css', import.meta.url));

/** Comments would otherwise contribute braces and `--x:` names to the scans below. */
const CSS = readFileSync(STYLESHEET_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const OVERLAY_THEMES = BUILTIN_THEMES.filter((theme) => theme.appearance === 'system');

type TokenRead = { tokens: Record<string, string>; rendered: Record<string, string> };
type Appearance = 'light' | 'dark';

const APPEARANCES: Appearance[] = ['light', 'dark'];

/**
 * The surfaces each coverage class is about. An `accent` theme may move *only*
 * the accent family; a `full` one is expected to reach the substrate, terminal
 * board and graph lanes as well.
 */
const SURFACES: Record<string, string[]> = {
  substrate: [
    '--background',
    '--foreground',
    '--border',
    '--input',
    '--muted',
    '--muted-foreground',
    '--secondary',
    '--accent',
    '--nav-glass-bg',
    '--nav-divider-color',
    '--nav-input-bg',
  ],
  terminal: [
    '--term-background',
    '--term-foreground',
    '--term-cursor',
    '--term-selection-bg',
    '--term-ansi-red',
    '--term-ansi-bright-cyan',
    '--term-error',
  ],
  editor: [
    '--editor-bg',
    '--editor-fg',
    '--editor-gutter-bg',
    '--editor-panel-bg',
    '--editor-toolbar-fg',
    '--editor-loading-bg',
  ],
  graph: ['--graph-lane-1', '--graph-lane-5', '--graph-lane-10'],
  /**
   * The card surface is the one that comes from a different L1 family per
   * appearance: `--palette-sand-25` in light, `--palette-ink-900` in dark. Both
   * halves are inside a full theme's reach — the theme redeclares
   * `--palette-sand-25` to give the light card a tint of its own paper, the way
   * the base's card sits on warm sand. An `accent` theme reaches neither half.
   *
   * `--palette-sand-25`'s base value is pure white, so the base card resolves
   * exactly as it did when it read `--palette-white`; the move that this opens
   * is per-theme, not a change of the base appearance.
   *
   * `--palette-white` itself stays frozen (and is asserted to, via `fixed`): the
   * light card no longer reads it, so retinting it would move `--n-white` and
   * the `--editor-*` surfaces without touching any card.
   */
  cardSurface: ['--card', '--popover'],
  /**
   * The Tailwind compatibility skeleton — all four neutral families
   * (`gray` / `zinc` / `slate` / `neutral`). Counted by scanning `src` for
   * `n-<family>-<step>`, with the test tree and this module's own probe file
   * excluded by name. The probe file is left out because it *names* these
   * tokens as pairs; counting those would move the figure every time a pair is
   * added. Phase 2 is renaming this skeleton onto semantic tokens, so the total
   * drifts and is deliberately not written down; recompute it with
   *   `rg -o 'n-gray-[0-9]+' src | grep -v '/tests/' | wc -l`
   * (the same for `zinc` / `slate` / `neutral`). Last counted 2026-10-06:
   * `gray` 1287, `zinc` 66, `slate` 51, `neutral` 40.
   *
   * Out of reach for `accent` — retinting any of it would change far more than
   * that badge advertises — but *inside* the reach of a theme that already
   * claims the surfaces, because these sites are the app's own chrome and
   * leaving them cold is the seam the ramp's step values are not meant to
   * force. The four themes this slice promotes are exactly that case: their L1
   * re-lays the `gray` ramp at the base's own lightnesses, so their chrome
   * belongs to them.
   *
   * All four families are listed, not the two `gray` steps that happened to be
   * probed, and not `gray` alone: the old guard left `zinc` / `slate` /
   * `neutral` on *no* list at all, so an `accent` theme could retint 157 sites
   * and still call itself `accent`. A family a `full` theme retints must be
   * retinted **all eleven steps** — a partial retint leaves the same seam, one
   * step over, and the ramp test below asserts this.
   */
  compat: [
    '--n-gray-50', '--n-gray-100', '--n-gray-200', '--n-gray-300', '--n-gray-400',
    '--n-gray-500', '--n-gray-600', '--n-gray-700', '--n-gray-800', '--n-gray-900',
    '--n-gray-950',
    '--n-zinc-50', '--n-zinc-100', '--n-zinc-200', '--n-zinc-300', '--n-zinc-400',
    '--n-zinc-500', '--n-zinc-600', '--n-zinc-700', '--n-zinc-800', '--n-zinc-900',
    '--n-zinc-950',
    '--n-slate-50', '--n-slate-100', '--n-slate-200', '--n-slate-300', '--n-slate-400',
    '--n-slate-500', '--n-slate-600', '--n-slate-700', '--n-slate-800', '--n-slate-900',
    '--n-slate-950',
    '--n-neutral-50', '--n-neutral-100', '--n-neutral-200', '--n-neutral-300', '--n-neutral-400',
    '--n-neutral-500', '--n-neutral-600', '--n-neutral-700', '--n-neutral-800', '--n-neutral-900',
    '--n-neutral-950',
  ],
  /**
   * Tokens no overlay is allowed to move, whatever its coverage.
   *
   * `--n-white` / `--n-black` are mostly plain white / black fills and labels,
   * with only a handful of `hsl(var(--n-black) / 0.1)` shape uses behind them.
   * Retinting pure white or black is the highest-risk move there is for
   * contrast, and they carry more sites than any one theme advertises — so they
   * stay frozen. (An earlier note called them "appearance-agnostic terminal
   * chrome"; that reading covered only four of the sites and is why the reason
   * above is written out now.)
   *
   * `--palette-white` joins them now that the light card reads
   * `--palette-sand-25` instead. Its base value is pure white, the same literal
   * as the new card step's, so `derivedMoves`' substring match lists it as
   * *allowed* whenever a theme redeclares `--palette-sand-25` — `beyondReach`
   * therefore cannot see it move. Measured, it would still red *indirectly*
   * today: `--n-white` resolves through this token, so a retint moves a frozen
   * name too and `mustNotMove` catches that. But that red is an implicit
   * dependency on `--n-white`'s current implementation, not a stated guarantee
   * — re-point `--n-white` at another step and the retint goes silent. Pinning
   * `--palette-white` here makes the freeze direct and named, so "the light card
   * is the only layer this opens" stays a checked contract rather than a fact
   * about today's stylesheet. (It also carries `--n-white`, `--code-block-bg`
   * and the `--editor-*` surfaces, none of which a theme may retint.)
   *
   * The `zinc` / `slate` / `neutral` ramps are **no longer** frozen — they moved
   * into `compat` above. They were never in this list before either, which is
   * exactly how an `accent` theme could retint them; `compat` closes that.
   */
  fixed: ['--palette-white', '--n-white', '--n-black'],
};

const ACCENT_SURFACES = ['--primary', '--ring', '--nav-tab-glow', '--nav-input-focus-ring'];

/**
 * Substrate tokens whose dark half cannot move under any overlay *by
 * construction*. `--nav-input-bg`'s dark value is a pure-black-alpha well
 * (`--palette-black / 0.25`, the same nature as `--nav-float-shadow`): it
 * darkens whatever substrate a theme lays by compositing, so its declared
 * value stays fixed while the rendered well still belongs to the theme. Only
 * its light half references a retintable ramp token, so the must-move
 * guarantee is light-only.
 */
const LIGHT_ONLY_SUBSTRATE = ['--nav-input-bg'];

/** Which surface families each coverage class promises to move. */
const MUST_MOVE: Record<string, string[]> = {
  accent: ACCENT_SURFACES,
  full: [...SURFACES.substrate, ...SURFACES.terminal, ...SURFACES.graph, ...SURFACES.editor],
};

/** Which surface families it promises *not* to move. */
const MUST_NOT_MOVE: Record<string, string[]> = {
  accent: [
    ...SURFACES.substrate,
    ...SURFACES.terminal,
    ...SURFACES.editor,
    ...SURFACES.graph,
    ...SURFACES.compat,
    ...SURFACES.fixed,
  ],
  full: [...SURFACES.fixed],
};/** The index of the `{` opening the rule whose selector starts at `from`. */
function openBraceAfter(from: number): number {
  return CSS.indexOf('{', from);
}

/** How many `@layer` blocks enclose `index`, by brace matching. */
function layerDepthAt(index: number): number {
  const enclosing: boolean[] = [];
  let opensLayer = false;

  for (let i = 0; i < index; i += 1) {
    const character = CSS[i];
    if (character === '{') {
      enclosing.push(opensLayer);
      opensLayer = false;
    } else if (character === '}') {
      enclosing.pop();
    } else if (character === '@') {
      const atRule = /^@(layer|media|supports|container|scope)\b/.exec(CSS.slice(i, i + 20));
      if (atRule) opensLayer = atRule[1] === 'layer';
    }
  }

  return enclosing.filter(Boolean).length;
}

type OverlayBlock = {
  /** The full selector text, e.g. `[data-theme="cc-catppuccin"].dark`. */
  selector: string;
  declared: Record<string, string>;
};

/** Every `[data-theme="<id>"]…` rule the stylesheet declares, in file order. */
function findBlocks(themeId: string): OverlayBlock[] {
  const needle = `[data-theme="${themeId}"]`;
  const blocks: OverlayBlock[] = [];

  let from = 0;
  for (;;) {
    const start = CSS.indexOf(needle, from);
    if (start === -1) break;

    const open = openBraceAfter(start);
    const body = CSS.slice(open + 1, CSS.indexOf('}', start));
    const declared: Record<string, string> = {};
    for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      declared[match[1]] = match[2].trim();
    }

    blocks.push({ selector: CSS.slice(start, open).trim(), declared });
    from = start + needle.length;
  }

  return blocks;
}

/** Whether a block's selector matches in `appearance`. */
function appliesIn(selector: string, appearance: Appearance): boolean {
  if (selector.endsWith('.dark')) return appearance === 'dark';
  if (selector.includes(':not(.dark)')) return appearance === 'light';
  return true;
}

type Overlay = {
  /** `--token: value` pairs in force in this appearance, later blocks winning. */
  declared: Record<string, string>;
  /** The overrides that replace an existing base value, as `[name, baseValue]`. */
  replaced: [string, string][];
};

/**
 * The overlay as it applies in one appearance: the blocks whose selector matches,
 * merged in file order.
 *
 * Merging by source order is a model, not the cascade itself (which weighs
 * specificity first) — but it does not have to be right by construction: the
 * per-theme test asserts every declared value resolves as written in the browser,
 * so a merge that disagreed with the real cascade would fail there.
 */
function readOverlay(
  themeId: string,
  appearance: Appearance,
  baseTokens: Record<string, string>,
): Overlay {
  const blocks = findBlocks(themeId);
  expect(
    blocks.length,
    `[data-theme="${themeId}"] is not declared in src/index.css`,
  ).toBeGreaterThan(0);

  const declared: Record<string, string> = {};
  for (const block of blocks) {
    if (appliesIn(block.selector, appearance)) Object.assign(declared, block.declared);
  }

  const replaced = Object.entries(declared)
    .filter(([name]) => name in baseTokens)
    .map(([name]) => [name, baseTokens[name]] as [string, string]);

  return { declared, replaced };
}

/**
 * The tokens an overlay is *allowed* to move: the ones it redeclares, plus
 * every token whose base value mentions a value it replaced (the L2 tokens that
 * resolve through an overridden L1 family — `--primary` through
 * `--palette-brand-500`, `--nav-tab-glow` through the same family with alpha,
 * and so on).
 */
function derivedMoves(
  baseTokens: Record<string, string>,
  replaced: [string, string][],
): Set<string> {
  const allowed = new Set<string>();
  for (const [name, baseValue] of replaced) {
    allowed.add(name);
    for (const [token, value] of Object.entries(baseTokens)) {
      if (value.includes(baseValue)) allowed.add(token);
    }
  }
  return allowed;
}

async function read(
  page: Page,
  themeId: string | null,
  appearance: Appearance,
): Promise<TokenRead> {
  return page.evaluate(
    ({ id, ap }) => window.__THEME_TOKENS__!.readWithTheme(id, ap),
    { id: themeId, ap: appearance },
  );
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THEME_TOKENS__));
}

function differing(base: Record<string, string>, other: Record<string, string>): string[] {
  return Object.keys(base).filter((name) => base[name] !== other[name]);
}

/**
 * Resolves the `var()` references in a declared value against the themed
 * palette, so it can be compared with a computed value.
 *
 * A declaration is not always the literal a computed style returns: the palette
 * block writes triplets, but the editor block writes `hsl(var(--palette-…))`,
 * and `getComputedStyle` substitutes the reference before reporting. Resolving
 * against the palette *as the overlay leaves it* is the same substitution the
 * browser performs, in one pass — a computed custom property is already fully
 * substituted, so no nesting has to be walked. It still proves the claim that
 * matters: if the token being checked were shadowed by another declaration, its
 * computed value would not equal its own expression's resolution.
 */
function resolve(expression: string, themed: Record<string, string>): string {
  return expression.replace(
    /var\((--[a-z0-9-]+)\)/g,
    (_match, name: string) => themed[name] ?? `var(${name})`,
  );
}

test('every overlay theme is declared outside any @layer', () => {
  expect(OVERLAY_THEMES.length, 'no overlay theme is registered').toBeGreaterThan(0);

  const layered: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    const selector = `[data-theme="${theme.id}"]`;
    let from = 0;
    let found = 0;

    for (;;) {
      const start = CSS.indexOf(selector, from);
      if (start === -1) break;
      found += 1;
      // `:not(.dark)` and `.dark` variants share this prefix, so every block a
      // theme declares is visited by walking the occurrences.
      if (layerDepthAt(start) > 0) layered.push(CSS.slice(start, openBraceAfter(start)).trim());
      from = start + selector.length;
    }

    expect(found, `${selector} is not declared in src/index.css`).toBeGreaterThan(0);
  }

  expect(
    layered,
    `overlays must be declared outside any @layer (an overlay inside one is ordered into that ` +
      `layer's bucket, so whether it wins depends on the layer order):\n${layered.join('\n')}`,
  ).toEqual([]);
});

/**
 * The traversal, closed in the other direction.
 *
 * Every test above walks `OVERLAY_THEMES` out to the stylesheet, so a registered
 * theme missing a block is caught — but a `[data-theme]` block whose id is *not*
 * registered would be invisible to all of them: CSS no check reads. That is the
 * one shape a "traverse every overlay" suite skips by construction, so it is
 * pinned here instead.
 *
 * The appearance defaults (`cc-light` / `cc-dark`) carry no overlay, so they are
 * deliberately absent from `OVERLAY_THEMES` and must not appear as blocks.
 */
test('every [data-theme] block belongs to a registered overlay, and vice versa', () => {
  const declared = new Set(
    [...CSS.matchAll(/\[data-theme="([a-z0-9-]+)"\]/g)].map((match) => match[1]),
  );
  const registered = new Set(OVERLAY_THEMES.map((theme) => theme.id));

  const orphans = [...declared].filter((id) => !registered.has(id));
  const missing = [...registered].filter((id) => !declared.has(id));

  expect(
    orphans,
    `[data-theme] blocks in src/index.css with no registered overlay theme:\n${orphans.join('\n')}`,
  ).toEqual([]);
  expect(
    missing,
    `registered overlay themes with no [data-theme] block in src/index.css:\n${missing.join('\n')}`,
  ).toEqual([]);
});

test('an overlay may only redeclare tokens the base stylesheet declares', async ({ page }) => {
  await openFixture(page);
  const base = await read(page, null, 'light');

  const unknown: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    const blocks = findBlocks(theme.id);
    const declared = new Set(blocks.flatMap((block) => Object.keys(block.declared)));
    expect(declared.size, `${theme.id} declares no tokens`).toBeGreaterThan(0);

    for (const name of declared) {
      // A name the base does not declare would enter the token baseline from the
      // overlay alone and read as empty on `<html>` — the baseline suite would
      // report it as uncovered, so it is rejected here with a clearer message.
      if (!(name in base.tokens)) unknown.push(`${theme.id} declares ${name}`);
    }
  }

  expect(unknown, `overlay tokens with no base declaration:\n${unknown.join('\n')}`).toEqual([]);
});

for (const theme of OVERLAY_THEMES) {
  test(`${theme.id} (${theme.coverage}) wins in both appearances, and by exactly its declared reach`, async ({ page }) => {
    await openFixture(page);

    for (const appearance of APPEARANCES) {
      const base = await read(page, null, appearance);
      const themed = await read(page, theme.id, appearance);
      const overlay = readOverlay(theme.id, appearance, base.tokens);

      // 1. The declarations resolve as written — the overlay is not shadowed by
      //    another declaration of the same token in the processed stylesheet.
      const unresolved = Object.entries(overlay.declared)
        .filter(([name, value]) => themed.tokens[name] !== resolve(value, themed.tokens))
        .map(([name, value]) => `${name}: declared ${value}, resolved ${themed.tokens[name]}`);

      // 2. Nothing beyond the reach `coverage` advertises moved.
      const moved = new Set(differing(base.tokens, themed.tokens));
      const allowed = derivedMoves(base.tokens, overlay.replaced);
      const beyondReach = [...moved].filter((name) => !allowed.has(name));

      expect(
        unresolved,
        `${theme.id} overlay is shadowed in ${appearance}:\n${unresolved.join('\n')}`,
      ).toEqual([]);

      // A full theme reaches both halves of the card surface: its light half
      // reads `--palette-sand-25`, which a full theme redeclares per theme, and
      // its dark half reads `--palette-ink-900`. An accent theme reaches neither.
      const cardMoves = theme.coverage === 'full';
      const mustMove = [
        ...MUST_MOVE[theme.coverage ?? 'full'],
        ...(cardMoves ? SURFACES.cardSurface : []),
      ]
        .filter((name) => !(appearance === 'dark' && LIGHT_ONLY_SUBSTRATE.includes(name)))
        .filter((name) => !moved.has(name));
      const mustNotMove = [
        ...MUST_NOT_MOVE[theme.coverage ?? 'full'],
        ...(cardMoves ? [] : SURFACES.cardSurface),
      ].filter((name) => moved.has(name));

      expect(
        mustMove,
        `${theme.id} claims coverage "${theme.coverage}" but left these unchanged in ${appearance}:\n${mustMove.join('\n')}`,
      ).toEqual([]);
      expect(
        mustNotMove,
        `${theme.id} (coverage "${theme.coverage}") moved surfaces it does not advertise:\n${mustNotMove.join('\n')}`,
      ).toEqual([]);
      expect(
        beyondReach,
        `${theme.id} moved tokens outside its reach in ${appearance}:\n${beyondReach.join('\n')}`,
      ).toEqual([]);
    }
  });
}

/**
 * A theme that retints a compatibility family retints all eleven steps.
 *
 * `SURFACES.compat` states the rule, but nothing measured it: `beyondReach`
 * only asks whether a moved token is *allowed*, and `derivedMoves` allows every
 * `--n-*` step the moment the theme retints the L1 step behind it — so a theme
 * that retints three steps leaves the other eight on the base values with no
 * red anywhere. That partial ramp *is* the seam the family rule is about (half
 * the ramp the theme's, half the base's), so it is pinned here.
 *
 * Both ends of the range are legitimate, so the assertion is "none or all",
 * not "all": an `accent` theme moves none (and must not), and the ramps are
 * optional for a `full` one. Only the middle is the defect.
 *
 * The count is of *moved* steps rather than declared ones, because the seam is
 * a rendered difference: a theme that declares all eleven but lands one step on
 * the base value still shows a base-coloured step among ten theme-coloured
 * ones — the same seam, one step over.
 */
test('a theme that retints a compatibility family retints all eleven steps', async ({ page }) => {
  await openFixture(page);

  // Grouped out of `compat`, so a step added to a ramp there is covered here
  // without a second list to keep in step.
  const ramps = new Map<string, string[]>();
  for (const token of SURFACES.compat) {
    const family = token.slice(0, token.lastIndexOf('-'));
    ramps.set(family, [...(ramps.get(family) ?? []), token]);
  }
  expect(ramps.size, 'SURFACES.compat declares no family to check').toBeGreaterThan(0);

  const problems: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    for (const appearance of APPEARANCES) {
      const base = await read(page, null, appearance);
      const themed = await read(page, theme.id, appearance);
      const moved = new Set(differing(base.tokens, themed.tokens));

      for (const [family, steps] of ramps) {
        const count = steps.filter((step) => moved.has(step)).length;
        if (count !== 0 && count !== steps.length) {
          problems.push(
            `${theme.id} in ${appearance}: retinted ${count} of ${steps.length} ${family} steps`,
          );
        }
      }
    }
  }

  expect(problems, `partial compatibility ramps:\n${problems.join('\n')}`).toEqual([]);
});

/**
 * The editor is the one surface whose base values are appearance-specific
 * literals, so its overlay has to be split into a light-scoped block and a
 * `.dark` one. A bare `[data-theme]` selector for the light half would also
 * match in the dark appearance; it would lose to the `.dark` block by
 * specificity, so every token that appears in *both* halves would still resolve
 * correctly and no other check here would notice — but a token added to the
 * light half and forgotten in the dark one would silently keep its light value.
 *
 * That is what this pins, and it has to pin it *per theme*: the skip below is
 * what a theme is measured against, so a theme that scopes no light half must be
 * reported rather than skipped. Skipping it is exactly the shape the guard used
 * to have — the check then covered nothing for it, and the suite stayed green
 * while five `--editor-*` tokens leaked (measured on `cc-islands`: an unscoped
 * light half turns `--editor-panel-border` from the dark `2px solid black` into
 * a light `1px solid`, and four more the same way). A theme whose values do not
 * vary by appearance declares one unscoped block and has no light half to leak;
 * everything past that gate is required to scope one.
 *
 * The consequence check that follows — a token the light branch declares on its
 * own must fall back to the base value in the dark appearance — is entailed by
 * the selector not matching there, so on its own it cannot fire. It is kept as
 * the second line of defence for the one shape that can still break it from
 * outside: the same token declared by a rule `findBlocks` does not see (a plain
 * class selector), which would shadow the fallback in the dark appearance.
 */
test('a light-scoped overlay block does not leak into the dark appearance', async ({ page }) => {
  await openFixture(page);

  const guarded: string[] = [];
  const leaks: string[] = [];
  const unscoped: string[] = [];

  for (const theme of OVERLAY_THEMES) {
    const blocks = findBlocks(theme.id);

    // The blocks that apply in one appearance only. A theme with none keeps one
    // set of values for both appearances: nothing to scope, nothing to leak.
    const scoped = blocks.filter(
      (block) => appliesIn(block.selector, 'light') !== appliesIn(block.selector, 'dark'),
    );
    if (scoped.length === 0) continue;

    if (!scoped.some((block) => appliesIn(block.selector, 'light'))) {
      unscoped.push(theme.id);
      continue;
    }

    const lightOnly = new Set<string>();
    const darkApplicable = new Set<string>();
    for (const block of blocks) {
      if (block.selector.includes(':not(.dark)')) {
        for (const name of Object.keys(block.declared)) lightOnly.add(name);
      } else {
        for (const name of Object.keys(block.declared)) darkApplicable.add(name);
      }
    }

    const owned = [...lightOnly].filter((name) => !darkApplicable.has(name));
    expect(
      owned.length,
      `${theme.id} scopes a block to light whose tokens the dark half all repeats, ` +
        `so the leak check covers nothing for it`,
    ).toBeGreaterThan(0);
    guarded.push(theme.id);

    const base = await read(page, null, 'dark');
    const themed = await read(page, theme.id, 'dark');
    leaks.push(
      ...owned
        .filter((name) => themed.tokens[name] !== base.tokens[name])
        .map((name) => `${theme.id} ${name}: kept ${themed.tokens[name]} instead of ${base.tokens[name]}`),
    );
  }

  expect(
    unscoped,
    'these overlay themes vary by appearance but declare no `:not(.dark)` half, so an unscoped ' +
      'block stands in for one: it applies in the dark appearance too, where it loses to `.dark` ' +
      'on specificity only for the tokens both halves declare — every token the light half ' +
      'declares alone keeps its light value there',
  ).toEqual([]);
  expect(
    guarded,
    'no registered overlay theme varies by its appearance any more: this check has nothing left ' +
      'to cover and should be deleted with the last theme that scoped a light half',
  ).not.toEqual([]);
  expect(leaks, `light-scoped overrides leaked into the dark appearance:\n${leaks.join('\n')}`).toEqual([]);
});

/**
 * All or nothing, per appearance.
 *
 * A theme's two syntax halves are compiled from two different Prism themes, so
 * they are not equally complete: `buildSyntaxTheme` omits a declaration on the
 * light side when the light theme has no value for it. A slot the base palette
 * itself does not declare in an appearance is therefore allowed to be missing
 * there — the rule must not push a theme into inventing a colour no reference
 * has. Everything else the base declares has to be present.
 *
 * Which names count as syntax slots comes from the page's `SYNTAX_TOKEN_MAP`
 * rather than from a pattern here: the generator is the only thing that decides,
 * and a second spelling of the same set would drift from it silently.
 *
 * No overlay names one yet — that is allowed, because this is an optional
 * surface. The assertion starts carrying weight with the first theme that does.
 */
test('a theme that names any syntax slot names all of them for that appearance', async ({ page }) => {
  await openFixture(page);
  const slots = await page.evaluate(() => window.__THEME_TOKENS__!.syntaxTokenNames);

  const incomplete: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    for (const appearance of APPEARANCES) {
      const declared = Object.keys(readOverlay(theme.id, appearance, {}).declared);
      const named = declared.filter((name) => slots.includes(name));
      if (named.length === 0) continue;

      const base = await read(page, null, appearance);
      const declaredByBase = slots.filter((slot) => (base.tokens[slot] ?? '') !== '');
      const missing = declaredByBase.filter((slot) => !named.includes(slot));
      if (missing.length > 0) {
        incomplete.push(
          `${theme.id} in ${appearance}: names ${named.length} syntax slots but omits ${missing.join(', ')}`,
        );
      }
    }
  }

  expect(
    incomplete,
    'a theme moves syntax colours all at once or not at all; a partial board leaves the block reading half in its palette',
  ).toEqual([]);
});

/**
 * Which built-in overlays own a syntax board, and the two things that makes true.
 *
 * The per-theme test above proves a declared value resolves as written, and the
 * all-or-nothing test proves a board is never partial — but neither notices a
 * board deleted outright, nor one that declares all eleven slots and moves none
 * of them. This pins the backfill's outcome: these themes own a board, they own
 * all of it, and owning it changes the rendered block.
 *
 * In both appearances. The first pass left the light half of the three reference
 * themes empty, on the reading that their references ship a dark board and
 * nothing else; all three do have a light answer, so the light half is declared
 * too and its absence would now be the regression. The four references promoted
 * later (`cc-dracula` … `cc-tokyo-night`) each ship a light and a dark board and
 * are listed straight away. `cc-ocean` is the one overlay that owns no board —
 * it is `accent`-coverage, so its block is not expected to reach syntax at all.
 */
const SYNTAX_BOARD_THEMES = [
  'cc-catppuccin', 'cc-islands', 'cc-onedark', 'cc-onedark-vivid',
  'cc-dracula', 'cc-gruvbox', 'cc-kanagawa', 'cc-tokyo-night',
];

test('the overlays that own a syntax board own all of it, and move it', async ({ page }) => {
  await openFixture(page);
  const slots = await page.evaluate(() => window.__THEME_TOKENS__!.syntaxTokenNames);

  const problems: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    const owns = SYNTAX_BOARD_THEMES.includes(theme.id);

    for (const appearance of APPEARANCES) {
      const base = await read(page, null, appearance);
      const themed = await read(page, theme.id, appearance);
      const overlay = readOverlay(theme.id, appearance, base.tokens);
      const declaredByBase = slots.filter((slot) => (base.tokens[slot] ?? '') !== '');
      const named = declaredByBase.filter((slot) => slot in overlay.declared);

      if (!owns) {
        if (named.length > 0) {
          problems.push(`${theme.id} in ${appearance}: names ${named.length} syntax slots but owns no board`);
        }
        continue;
      }

      if (named.length !== declaredByBase.length) {
        problems.push(`${theme.id} in ${appearance}: names ${named.length} of ${declaredByBase.length} syntax slots`);
      }
      if (!slots.some((slot) => themed.tokens[slot] !== base.tokens[slot])) {
        problems.push(`${theme.id} in ${appearance}: declares a syntax board but moves no slot`);
      }
    }
  }

  expect(problems, `syntax boards:\n${problems.join('\n')}`).toEqual([]);
});

/**
 * The terminal board's light half, when a theme declares one.
 *
 * No list of which themes split their board is needed, the way the syntax guard
 * needs one: the base splits its own board, so a theme that says nothing still
 * gets a board (the base's, one value per appearance), and a theme that splits
 * it does so by naming the slots in its `:not(.dark)` block. That
 * declaration is the shape the per-theme test above is blind to. A slot the
 * light block omits does not go missing: it falls back to the theme's own
 * unscoped value, which still resolves as written and still counts as moved off
 * the base. So a half-declared light half reads as a deliberately dark terminal
 * on a light page and nothing reports it — that is what this measures.
 *
 * The second half — that the split moves something — closes the mirror case, a
 * light block repeating the dark values verbatim. It is measured between the two
 * appearances rather than against the base, because a theme may honestly land
 * one slot on its dark value while moving the rest; what must not happen is that
 * none of them move.
 *
 * What this still does not cover, named so it is not mistaken for covered: a
 * theme may declare its board once, unscoped, and let that one value stand for
 * both appearances. Such a theme declares no light half, so this assert skips
 * it and deleting a light half outright is silent here — the assert is
 * conditional on the theme having declared one.
 */
test('a theme that splits its terminal board declares the light half in full', async ({ page }) => {
  await openFixture(page);
  const base = await read(page, null, 'light');
  const slots = Object.keys(base.tokens).filter((name) => name.startsWith('--palette-term-'));

  const problems: string[] = [];
  for (const theme of OVERLAY_THEMES) {
    // Only what the light-scoped blocks declare, not the merged overlay: a slot
    // the light half omits is still declared by the theme's unscoped block, so
    // the merged set cannot tell "the light half named it" from "the dark half
    // did" — and reading it that way is how the leak this pins goes unnoticed.
    const lightOnly: Record<string, string> = {};
    for (const block of findBlocks(theme.id)) {
      if (block.selector.includes(':not(.dark)')) Object.assign(lightOnly, block.declared);
    }

    const named = slots.filter((slot) => slot in lightOnly);
    if (named.length === 0) continue;

    if (named.length !== slots.length) {
      const missing = slots.filter((slot) => !(slot in lightOnly));
      problems.push(
        `${theme.id}: the light half names ${named.length} of ${slots.length} terminal slots, ` +
          `so the rest read the dark board (missing ${missing.join(', ')})`,
      );
    }

    const dark = readOverlay(theme.id, 'dark', {}).declared;
    if (!slots.some((slot) => slot in dark && dark[slot] !== lightOnly[slot])) {
      problems.push(`${theme.id}: the light half repeats the dark board, so the split moves nothing`);
    }
  }

  expect(problems, `split terminal boards:\n${problems.join('\n')}`).toEqual([]);
});

/**
 * The variant relation.
 *
 * `cc-onedark-vivid` repeats `cc-onedark`'s three blocks, because the plugin's
 * four files share their core palette and the sibling's substrate, editor board
 * and graph lanes are supposed to come across unchanged. Nothing above can see
 * that: the overlay contract compares a theme against the *base*, so a value
 * that drifted off the sibling would still resolve as written and still stay
 * inside the theme's `full` reach. This pins the copy — the two themes differ in
 * exactly the tokens the variant is about, and in nothing else — which is what
 * makes repeating the blocks safe rather than merely tidy.
 *
 * The expected set is spelled out rather than derived, because it *is* the
 * claim. Three axes move, and the terminal is one of them (the plan's first
 * pass wrongly read it as syntax-only; see its §3.7 correction). The light half
 * carries the sibling's board verbatim — the variant's substitution is the
 * identity on a light board — so there it is the grey alone, and the empty
 * syntax expected-set below is what holds that copy verbatim: any slot that
 * drifted between the two light boards would be reported as moved.
 */
const VIVID_SUBSTRATE_MOVES = [
  // `foregroundColor` #abb2bf -> #bbbbbb, the one L1 step that moves; the
  // editor and terminal foregrounds read through it.
  '--palette-ink-100',
  // The terminal: the source's five moved ANSI slots plus the derived bright
  // partners that follow them.
  '--palette-term-fg',
  '--palette-term-red',
  '--palette-term-green',
  '--palette-term-magenta',
  '--palette-term-cyan',
  '--palette-term-white',
  '--palette-term-bright-red',
  '--palette-term-bright-green',
  '--palette-term-bright-magenta',
  '--palette-term-bright-cyan',
];

/**
 * The six of eleven syntax slots the variant's 175 changed attributes land on —
 * the dark appearance's, since the light one repeats the sibling's board.
 */
const VIVID_DARK_SYNTAX_MOVES = [
  '--cc-syntax-punctuation-color',
  '--cc-syntax-keyword-color',
  '--cc-syntax-property-color',
  '--cc-syntax-string-color',
  '--cc-syntax-url-color',
  '--cc-syntax-block-foreground',
];

test('the vivid variant differs from its sibling in the boards only', () => {
  const problems: string[] = [];

  for (const appearance of APPEARANCES) {
    const sibling = readOverlay('cc-onedark', appearance, {}).declared;
    const variant = readOverlay('cc-onedark-vivid', appearance, {}).declared;
    const expected = new Set([
      ...VIVID_SUBSTRATE_MOVES,
      ...(appearance === 'dark' ? VIVID_DARK_SYNTAX_MOVES : []),
    ]);

    for (const name of new Set([...Object.keys(sibling), ...Object.keys(variant)])) {
      const inSibling = name in sibling;
      const inVariant = name in variant;
      if (inSibling !== inVariant) {
        problems.push(
          `${appearance}: ${name} is declared by the ${inVariant ? 'variant' : 'sibling'} only`,
        );
        continue;
      }

      const differs = sibling[name] !== variant[name];
      if (differs && !expected.has(name)) {
        problems.push(`${appearance}: ${name} moved off its sibling, which the variant is not about`);
      }
      if (!differs && expected.has(name)) {
        problems.push(`${appearance}: ${name} is supposed to move but reads as its sibling does`);
      }
    }
  }

  expect(problems, `the variant relation:\n${problems.join('\n')}`).toEqual([]);
});

test('the accent theme is the identity when no overlay is picked', async ({ page }) => {
  await openFixture(page);

  // The regression this guards: `data-theme` is written by ThemeContext on every
  // appearance change, and the two appearance defaults are the ids it writes
  // when nothing is picked. They carry no overlay, so the document must resolve
  // to the untouched base palette.
  for (const appearance of APPEARANCES) {
    const base = await read(page, null, appearance);
    for (const defaultTheme of BUILTIN_THEMES.filter((t) => t.appearance !== 'system')) {
      const themed = await read(page, defaultTheme.id, appearance);
      expect(
        differing(base.tokens, themed.tokens),
        `the default theme ${defaultTheme.id} is expected to carry no overlay of its own`,
      ).toEqual([]);
    }
  }
});
