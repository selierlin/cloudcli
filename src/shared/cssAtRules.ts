/**
 * Escape-aware at-rule detection for the `@import` gate (§5.8 v8).
 *
 * The gate it serves used a literal `/@import/i` regex, and a CSS ident may
 * carry escapes the tokenizer decodes before any rule exists: `@im\70 ort` and
 * `@\69mport` are `CSSImportRule`s in a real engine and fetch the remote sheet,
 * while a literal regex sees neither. This scanner reads the at-rule *name*
 * the way CSS Syntax §4.3.7 defines an ident — letters, digits, `-`/`_`,
 * non-ASCII, and `\` escapes (1–6 hex digits plus one optional whitespace, or
 * `\` before any other character) — so the escaped forms resolve to `import`
 * here exactly as they do in the browser.
 *
 * Deliberately conservative on context, matching the regex it replaces: an
 * `@import` inside a comment or a string is reported too. That is the same
 * answer the gate has always given, and a theme that means well can spell
 * around a comment — refusing an over-approximation only costs a malformed
 * theme an honest error, while under-approximating costs the page a remote
 * stylesheet nobody vetted.
 */

const HEX_DIGITS = /^[0-9a-f]$/i;
const IDENT_CHARACTERS = /^[-a-zA-Z0-9_\u0080-\uffff]$/;
const ESCAPE_LINE_BREAKS = /[\n\r\f]/;

/** Decodes the ident that starts right after an `@`, or null when there is none. */
function decodeAtRuleName(css: string, at: number): string | null {
  let name = '';
  let i = at + 1;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '\\') {
      let digits = '';
      let j = i + 1;
      while (j < css.length && digits.length < 6 && HEX_DIGITS.test(css[j])) {
        digits += css[j];
        j += 1;
      }
      if (digits.length > 0) {
        // A line break after the digits makes the escape invalid, and the ident
        // with it — the name read so far is what the engine would see.
        if (ESCAPE_LINE_BREAKS.test(css[j] ?? '')) return name || null;
        name += String.fromCodePoint(parseInt(digits, 16));
        // One whitespace after the digits terminates the escape; it is not part
        // of the name (`@im\70 ort` is `@import`, not `@im p ort`).
        if (css[j] === ' ' || css[j] === '\t') j += 1;
        i = j;
        continue;
      }
      const next = css[i + 1];
      if (next === undefined || ESCAPE_LINE_BREAKS.test(next)) return name || null;
      name += next;
      i += 2;
      continue;
    }
    if (!IDENT_CHARACTERS.test(ch)) break;
    name += ch;
    i += 1;
  }
  return name.length > 0 ? name : null;
}

/**
 * Whether the stylesheet carries an at-rule whose name decodes to `import`.
 *
 * Shared by both gates — the server's file scan and the client's paste
 * compiler — so the same text gets the same answer on both sides of the trust
 * boundary (§5.8's own rule for a two-gate check).
 */
export function containsImportAtRule(css: string): boolean {
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] !== '@') continue;
    if (decodeAtRuleName(css, i)?.toLowerCase() === 'import') return true;
  }
  return false;
}
