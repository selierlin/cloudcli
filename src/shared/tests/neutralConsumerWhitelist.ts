import type { NeutralUsage } from '@/shared/tests/themeHardcodedAtoms';

/**
 * The explicit whitelist that closes the neutral-colour rename (route B).
 *
 * The rename moved every neutral consumer onto an L2 semantic token *except*
 * the residual families that route B deliberately keeps on the compat layer
 * (`--n-*`). §4 of the rename plan requires that those residuals be a
 * declared, machine-checkable whitelist — "the slice `--n-*` consumers are
 * zero except the whitelist, and the whitelist is written into the grep
 * itself" — otherwise the completion criterion is prose, not a gate.
 *
 * This module is that gate's data. `neutralConsumerWhitelist.test.ts` asserts
 * two directions against the live source:
 *
 *   - every residual neutral consumer's *signature* is on the whitelist, and
 *   - every whitelisted signature still has at least one consumer.
 *
 * ## Division of labour with the conservation law
 *
 * `themeAtomConservation.test.ts` freezes the *count* of each residual bucket
 * (variant-inclusive, e.g. `dark text: gray-500`). This whitelist freezes the
 * *set of signatures* and carries the *reason* each is allowed — the semantic
 * layer, not the structural one. Keying on the signature (utility, family,
 * step, opacity — variants dropped) is deliberate: the conservation law
 * already catches a variant move, so duplicating that here would only make the
 * whitelist brittle. The two together are the whole DoD: this one says *what
 * is sanctioned*, the conservation law says *the census did not move*.
 *
 * ## Why signatures, not call sites
 *
 * A per-`file:token` list (like `NEUTRAL_EXEMPTIONS`) would be 448 entries
 * that churn on every unrelated edit and merely restate the census. The
 * decision that produced the residuals was made per *family* ("keep
 * `text gray-400`", "keep the ghost brand cards"), so the whitelist is keyed
 * the same way. The conservation law carries the per-call-site precision.
 */

export type ResidualCategory =
  /** D1-b / D7-b: L2 has no "faintest auxiliary text" / "body-secondary text" layer. */
  | 'l2-text-gap'
  /** B class: brand colours, decorations, and deliberate inverted/dark signatures. */
  | 'brand-decoration'
  /** ghost compat families (`zinc` / `neutral`): per-provider brand cards and dark panels. */
  | 'ghost-brand'
  /** Already covered point-wise by `NEUTRAL_EXEMPTIONS`; logged here only for total coverage. */
  | 'exempted';

export const RESIDUAL_CATEGORIES: Record<ResidualCategory, { reason: string }> = {
  'l2-text-gap': {
    reason:
      'D1-b / D7-b: the L2 palette has no layer for the weakest auxiliary text or for body-secondary text. Forcing these onto the nearest token moves them hard and in the wrong direction — `text gray-400` -> `--muted-foreground` (sand-500, 43%) is dL 22, and `text gray-700` -> `--foreground` (sand-950, 4%) is dRGB 73. Route B keeps the whole gray-* text scale (with its placeholder/disabled variants and the adjacent 100/200/600/800 steps) on the compat layer rather than folding half of it and splitting the family.',
  },
  'brand-decoration': {
    reason:
      'B class: brand colour systems and deliberate signatures. These are either a per-provider brand colour (the solid icons/buttons: a neutral token would make one button follow the theme while its coloured siblings do not), a mid-gray decoration the L2 palette has no layer for (status dots, icon beds, avatars), a classification chip whose neutral step sits next to coloured ones (CommandMenu), white text on a coloured surface (`text-n-white`), or an intentional inverted / dark / translucent signature (terminal pills, Tooltip, `bg-n-black` overlays, shadows). Folding these to a neutral token would either break the brand system or erase the deliberate contrast the component depends on.',
  },
  'ghost-brand': {
    reason:
      'ghost compat families (`zinc` / `neutral`): parallel to `gray`, within dL 2%, and likewise repainted by only four built-in themes. Their consumers are almost entirely the per-provider brand cards (`codex` = zinc, `opencode` = zinc, ...) and the dark screenshot surfaces of BrowserUsePanel, i.e. brand / dark signatures. The neutral steps of a status or provider palette fold only when they carry "no signal"; here they carry brand identity, so the family stays.',
  },
  exempted: {
    reason:
      'A point already carved out by `NEUTRAL_EXEMPTIONS` rather than by a family decision. Logged here so this whitelist accounts for the *whole* residual census; the actual disposition and its reason live next to that rule. Do not fold it into a category above.',
  },
};

/** Everything a signature keeps, variant chain excluded — see the module note. */
export function neutralSignature(usage: NeutralUsage): string {
  const step = usage.step ? `-${usage.step}` : '';
  const alpha = usage.opacity ? `/${usage.opacity}` : '';
  return `${usage.utility}: ${usage.family}${step}${alpha}`;
}

type ResidualEntry = {
  /** `utility: family-step[/opacity]`, e.g. `text: gray-400`, `bg: black/20`. */
  signature: string;
  category: ResidualCategory;
  /** Only where the category reason does not obviously cover this member. */
  note?: string;
};

/**
 * Every residual neutral consumer, by signature. Grown only by a deliberate
 * design decision — a *new* entry means a new family is being kept on the
 * compat layer, which is exactly what §4 wants surfaced.
 *
 * Tailwind scans `src/` (comments included) as content, so signatures are
 * written in the `usageKey` "key" shape — `text: gray-400`, not a class name —
 * which is not a live utility and ships nothing to `dist`.
 */
export const NEUTRAL_RESIDUAL_WHITELIST: ResidualEntry[] = [
  // --- l2-text-gap (D1-b / D7-b) ---
  { signature: 'text: gray-100', category: 'l2-text-gap' },
  { signature: 'text: gray-200', category: 'l2-text-gap' },
  { signature: 'text: gray-300', category: 'l2-text-gap' },
  { signature: 'text: gray-400', category: 'l2-text-gap' },
  { signature: 'text: gray-500', category: 'l2-text-gap' },
  { signature: 'text: gray-600', category: 'l2-text-gap' },
  { signature: 'text: gray-700', category: 'l2-text-gap' },
  { signature: 'text: gray-800', category: 'l2-text-gap' },
  { signature: 'placeholder: gray-400', category: 'l2-text-gap' },
  { signature: 'placeholder: gray-500', category: 'l2-text-gap' },

  // --- brand-decoration (B class) ---
  { signature: 'text: white', category: 'brand-decoration' },
  { signature: 'text: white/80', category: 'brand-decoration' },
  { signature: 'bg: white', category: 'brand-decoration', note: 'frozen-white symbols (toggle knobs, crosshair, iframe body), same set as D12.' },
  { signature: 'bg: white/10', category: 'brand-decoration' },
  { signature: 'bg: white/20', category: 'brand-decoration' },
  { signature: 'border: white', category: 'brand-decoration' },
  { signature: 'border: white/10', category: 'brand-decoration' },
  { signature: 'border: white/30', category: 'brand-decoration' },
  { signature: 'border: white/90', category: 'brand-decoration' },
  { signature: 'border-t: white', category: 'brand-decoration' },
  { signature: 'bg: black', category: 'brand-decoration', note: 'opaque terminal / screenshot panel beds (D16 keep-set).' },
  { signature: 'bg: black/20', category: 'brand-decoration', note: 'TaskBoardContent number-chip dark tint — not an overlay.' },
  { signature: 'shadow: black/[0.025]', category: 'brand-decoration' },
  { signature: 'shadow: black/10', category: 'brand-decoration' },
  { signature: 'bg: gray-50', category: 'brand-decoration', note: 'CommandMenu "other" chip: neutral step beside indigo/rose siblings.' },
  { signature: 'bg: gray-100', category: 'brand-decoration', note: 'Tooltip inverted light bed (`dark:bg-n-gray-100`).' },
  { signature: 'bg: gray-300', category: 'brand-decoration', note: 'status dot / small decoration.' },
  { signature: 'bg: gray-400', category: 'brand-decoration', note: 'status dot / icon bed.' },
  { signature: 'bg: gray-500', category: 'brand-decoration', note: 'avatar base / status dot.' },
  { signature: 'bg: gray-500/10', category: 'brand-decoration', note: 'star-tint pair (SidebarProjectItem) beside the yellow star tint.' },
  { signature: 'bg: gray-600', category: 'brand-decoration', note: 'avatar base / brand solid-button hover.' },
  { signature: 'bg: gray-700', category: 'brand-decoration', note: 'avatar / brand solid-button.' },
  { signature: 'bg: gray-800', category: 'brand-decoration', note: 'brand solid buttons (D11 keep-set).' },
  { signature: 'bg: gray-900', category: 'brand-decoration', note: 'terminal pill / Tooltip bed.' },
  { signature: 'bg: gray-900/30', category: 'brand-decoration', note: 'star-tint pair dark side.' },
  { signature: 'bg: gray-950', category: 'brand-decoration', note: 'terminal / brand-button active.' },
  { signature: 'border: gray-100', category: 'brand-decoration', note: 'divider beside a coloured sibling.' },
  { signature: 'border: gray-400', category: 'brand-decoration', note: 'tool-spinner ring.' },
  { signature: 'border: gray-500', category: 'brand-decoration' },
  { signature: 'border: gray-500/20', category: 'brand-decoration' },
  { signature: 'border: gray-700', category: 'brand-decoration' },
  { signature: 'border: gray-700/40', category: 'brand-decoration' },
  { signature: 'border: gray-700/50', category: 'brand-decoration' },
  { signature: 'border-t: gray-900', category: 'brand-decoration', note: 'Tooltip arrow, inverted.' },
  { signature: 'border-b: gray-900', category: 'brand-decoration', note: 'Tooltip arrow, inverted.' },
  { signature: 'border-l: gray-900', category: 'brand-decoration', note: 'Tooltip arrow, inverted.' },
  { signature: 'border-r: gray-900', category: 'brand-decoration', note: 'Tooltip arrow, inverted.' },
  { signature: 'border-t: gray-100', category: 'brand-decoration', note: 'Tooltip arrow, inverted light side.' },
  { signature: 'border-b: gray-100', category: 'brand-decoration', note: 'Tooltip arrow, inverted light side.' },
  { signature: 'border-l: gray-100', category: 'brand-decoration', note: 'Tooltip arrow, inverted light side.' },
  { signature: 'border-r: gray-100', category: 'brand-decoration', note: 'Tooltip arrow, inverted light side.' },
  { signature: 'text: gray-900', category: 'brand-decoration', note: 'Tooltip inverted dark text.' },

  // --- ghost-brand (zinc / neutral) ---
  { signature: 'bg: zinc-50', category: 'ghost-brand' },
  { signature: 'bg: zinc-100', category: 'ghost-brand' },
  { signature: 'bg: zinc-500', category: 'ghost-brand', note: 'per-agent brand dot.' },
  { signature: 'bg: zinc-600', category: 'ghost-brand' },
  { signature: 'bg: zinc-700', category: 'ghost-brand' },
  { signature: 'bg: zinc-800', category: 'ghost-brand' },
  { signature: 'bg: zinc-800/50', category: 'ghost-brand' },
  { signature: 'bg: zinc-900', category: 'ghost-brand' },
  { signature: 'bg: zinc-900/20', category: 'ghost-brand' },
  { signature: 'bg: zinc-950', category: 'ghost-brand' },
  { signature: 'border: zinc-200', category: 'ghost-brand' },
  { signature: 'border: zinc-300', category: 'ghost-brand' },
  { signature: 'border: zinc-600', category: 'ghost-brand' },
  { signature: 'border: zinc-700', category: 'ghost-brand' },
  { signature: 'text: zinc-100', category: 'ghost-brand' },
  { signature: 'text: zinc-300', category: 'ghost-brand' },
  { signature: 'text: zinc-700', category: 'ghost-brand' },
  { signature: 'text: zinc-900', category: 'ghost-brand' },
  { signature: 'bg: neutral-50', category: 'ghost-brand' },
  { signature: 'bg: neutral-100', category: 'ghost-brand' },
  { signature: 'bg: neutral-600', category: 'ghost-brand' },
  { signature: 'bg: neutral-700', category: 'ghost-brand' },
  { signature: 'bg: neutral-800', category: 'ghost-brand' },
  { signature: 'bg: neutral-800/50', category: 'ghost-brand' },
  { signature: 'bg: neutral-900', category: 'ghost-brand' },
  { signature: 'bg: neutral-900/20', category: 'ghost-brand' },
  { signature: 'bg: neutral-950', category: 'ghost-brand', note: 'BrowserUsePanel dark screenshot bed.' },
  { signature: 'border: neutral-300', category: 'ghost-brand' },
  { signature: 'border: neutral-600', category: 'ghost-brand' },
  { signature: 'border: neutral-700', category: 'ghost-brand' },
  { signature: 'text: neutral-100', category: 'ghost-brand' },
  { signature: 'text: neutral-300', category: 'ghost-brand' },
  { signature: 'text: neutral-400', category: 'ghost-brand', note: 'BrowserUsePanel dark-surface caption.' },
  { signature: 'text: neutral-500', category: 'ghost-brand', note: 'BrowserUsePanel dark-surface caption.' },
  { signature: 'text: neutral-700', category: 'ghost-brand' },
  { signature: 'text: neutral-900', category: 'ghost-brand' },

  // --- exempted (see NEUTRAL_EXEMPTIONS) ---
  { signature: 'border: gray-150', category: 'exempted' },
];
