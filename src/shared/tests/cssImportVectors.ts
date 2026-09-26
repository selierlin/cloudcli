/**
 * The `@import` gate's test vectors, shared by both of its consumers (§5.8 v8).
 *
 * The gate exists twice — the server's file scan and the client's paste
 * compiler — and the doc's own rule for a two-gate check is that both give the
 * same answer. Importing this list from both test files is what makes that a
 * structural fact rather than a promise: a vector added here is exercised on
 * both sides or a test goes red.
 *
 * Kept out of `cssAtRules.ts` itself so none of it reaches the client bundle.
 */

export const IMPORT_GATE_VECTORS: ReadonlyArray<{ css: string; expect: boolean; why: string }> = [
  // The forms the old literal regex caught.
  { css: '@import url(evil.css);', expect: true, why: 'plain form' },
  { css: '@IMPORT url(evil.css);', expect: true, why: 'case-insensitive' },
  { css: 'a { color: red }\n@import "x.css";', expect: true, why: 'not only at the start' },
  { css: '/* @import */', expect: true, why: 'conservative: comments are not parsed away' },
  { css: 'a::after { content: "@import" }', expect: true, why: 'conservative: strings are not parsed away' },

  // The escaped forms that walked straight through the literal regex — the
  // reason this scanner exists. All three are real CSSImportRules in a browser.
  { css: '@im\\70 ort url(evil.css);', expect: true, why: 'hex escape inside the name' },
  { css: '@\\69 mport url(evil.css);', expect: true, why: 'hex escape for the first letter, greedy digits stop at m' },
  { css: '@im\\70 ort url(evil.css) screen;', expect: true, why: 'escaped form with a media list' },
  { css: '@\\69\\6D port;', expect: true, why: 'two hex escapes' },
  { css: '@i\\6d port;', expect: true, why: 'short hex escape mid-name' },

  // At-rules and near-misses a loose match would wrongly refuse.
  { css: '@media (prefers-color-scheme: dark) {}', expect: false, why: 'another at-rule' },
  { css: '@importx url(x);', expect: false, why: 'a longer name is not import' },
  { css: '@media screen { @import url(evil.css); }', expect: true, why: 'conservative: nesting is not parsed away' },
  { css: 'a { color: red }', expect: false, why: 'no at-rule at all' },
  { css: '', expect: false, why: 'empty' },
  { css: '@;', expect: false, why: 'an at-sign with no name' },
  { css: '@2import;', expect: false, why: 'idents cannot start with a digit, and the name is not import anyway' },
];
