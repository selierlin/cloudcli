import { buildCodeMask } from '@/modules/chat/utils/latexDelimiters';

/**
 * Terminates GFM autolink literals where Chinese prose expects them to end.
 *
 * `micromark-extension-gfm-autolink-literal` ends a URL only at whitespace, a
 * line ending or `<`; trailing punctuation is trimmed only when nothing else
 * follows it on the line. CJK characters and CJK punctuation are neither
 * whitespace nor ASCII punctuation, so the scanner walks straight through
 * them:
 *
 * - `本地还开着（http://localhost:5199/），需要关掉吗？` links the question,
 *   not just the URL, and the href ends up percent-encoded CJK.
 * - `**https://example.com/**（详情）` never closes its emphasis: the scanner
 *   eats the closing `**`, the leading pair leaks as literal text, and the
 *   tail becomes one long, broken link.
 *
 * Wrapping the URL in angle brackets gives the scanner an explicit end, so the
 * link stops at the URL and any emphasis closes normally. The rendered text is
 * unchanged — it is still the bare URL — which is why this is a source rewrite
 * rather than a renderer option.
 *
 * Two deliberate limits, both to avoid guessing at author intent:
 *
 * - A bare URL is only cut at CJK punctuation. A CJK ideograph right after the
 *   URL could just as well be part of an IRI (`/wiki/中文`), so it is left
 *   alone; a bold URL may be cut there because its closing `**` already marks
 *   where the author meant the URL to end (that is the case
 *   remark-cjk-friendly relaxes emphasis for).
 * - Explicit link destinations are skipped: `[文案](http://a/，后续)` is the
 *   author's own destination, not an autolink literal.
 *
 * Code is never rewritten: fenced blocks, indented blocks and inline code spans
 * are masked out first, so an example quoted as code stays literal.
 */

/**
 * The CJK scripts and fullwidth forms remark-cjk-friendly relaxes emphasis
 * for: Hangul, CJK radicals through kana and ideographs, CJK compatibility
 * ideographs/forms, and the fullwidth block.
 */
const CJK_CHARACTER =
  '[\\u1100-\\u11FF\\u2E80-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFFEF]';

/** CJK and fullwidth punctuation: what can end a URL at a sentence boundary. */
const CJK_PUNCTUATION =
  '[\\u3000-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65\\u2014\\u2026]';

/**
 * A bare URL: the scheme anchors the match so the run cannot start earlier at
 * a bracket. The ASCII characters are the URL-safe set; `*` is never content
 * here, or a bold marker would join the run.
 */
const BARE_URL = "https?://[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()+,;=%]+";

/**
 * A bold-wrapped URL against a CJK character, or a bare URL against CJK
 * punctuation. The latter also skips an `<` (already an autolink) and `](`
 * (an explicit link destination).
 *
 * The bold group is anchored on the scheme, not just "anything between `**`":
 * this pass only runs when the message contains a URL somewhere, so an
 * unanchored group would wrap every bold run that happens to be followed by a
 * CJK character — `**加粗**后` would become `**<加粗>**后`, which micromark
 * renders with literal angle brackets and without the emphasis. The rest of the
 * group may contain CJK, because a bold IRI (`…/wiki/中文`) still needs its
 * explicit end.
 */
const AUTOLINK_PATTERN = new RegExp(
  `\\*\\*(https?:\\/\\/[^\\s<>*\`]+)\\*\\*(?=${CJK_CHARACTER})` +
    `|(?<!<)(?<!\\]\\()(${BARE_URL})(?=${CJK_PUNCTUATION})`,
  'g',
);

/** Cheap bail-out: no URL, nothing to do. Runs on every rendered message. */
const AUTOLINK_CANDIDATE = /https?:\/\//;

/** Used by chat's <Markdown> on every message body, after the LaTeX pass. */
export function normalizeAutolinkBoundaries(text: string): string {
  if (!text || typeof text !== 'string' || !AUTOLINK_CANDIDATE.test(text)) {
    return text;
  }
  try {
    const codeMask = buildCodeMask(text);
    return text.replace(AUTOLINK_PATTERN, (match, boldUrl: string, bareUrl: string, offset: number) => {
      // A masked start means this run is example text inside a fence or span.
      if (codeMask[offset]) {
        return match;
      }
      return boldUrl ? `**<${boldUrl}>**` : `<${bareUrl}>`;
    });
  } catch {
    return text;
  }
}
