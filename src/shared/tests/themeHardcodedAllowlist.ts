/**
 * The exemption list for §5.7's "hardcoded colour" acceptance — the *never*
 * migrate half of a three-way split (the scanner only looks at neutral
 * utilities, so status / brand / icon colours are already out of scope by
 * construction; see `themeHardcodedAtoms.ts`).
 *
 * Exemptions are deliberately narrow: a file plus the exact class token. A
 * second occurrence anywhere, or the same token in another file, fails the
 * build, which is the point — "exempt" must not quietly become "forgotten".
 *
 * Work that is merely *not done yet* does not belong here. That lives in
 * `theme-hardcoded-baseline.json`, the derived snapshot the guard compares
 * against, and shrinks slice by slice until it is empty.
 */
export type NeutralExemption = {
  /** Repo-relative path with POSIX separators. */
  file: string;
  /** The whole class token as written, e.g. `border-gray-150`. */
  token: string;
  /** Why this is allowed to stay, and what would retire it. */
  reason: string;
};

export const NEUTRAL_EXEMPTIONS: NeutralExemption[] = [
  {
    file: 'src/modules/chat/tools/ContentRenderers/QuestionAnswerContent.tsx',
    token: 'border-gray-150',
    reason:
      'Tailwind has no gray-150 step, so this class generates no CSS at all — there is no colour to tokenise, the border simply does not render. Migrating it would mean changing the design (to gray-200), which is out of scope for a zero-shift pass. Pre-existing bug, reported to the owner rather than silently fixed.',
  },
];
