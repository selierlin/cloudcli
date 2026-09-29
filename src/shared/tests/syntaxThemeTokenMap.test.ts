import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { expect, test } from 'vitest';

import { SYNTAX_TOKEN_MAP, collectSyntaxVariables, syntaxTheme } from '@/shared/syntaxTheme';
import type { SyntaxSemanticName } from '@/shared/syntaxTheme';

/**
 * `buildSyntaxTheme` numbers its variables in the order it meets a difference
 * while walking the two Prism themes, so the numbers are an implementation
 * detail that a Prism bump can renumber. These tests turn that silent risk into
 * a reviewable diff (the frozen mapping plus the count) and keep new call sites
 * from hard-coding a number, which is what would rot when the numbering moves.
 */

test('the semantic token map resolves to declared variables', () => {
  const declared = new Set(Object.values(collectSyntaxVariables(syntaxTheme.style)));

  for (const [name, variable] of Object.entries(SYNTAX_TOKEN_MAP)) {
    assert.ok(declared.has(variable), `"${name}" resolves to ${variable}, which no selector declares`);
  }
});

test('the semantic token map names distinct variables', () => {
  // Two names sharing a variable would mean one of them is describing the wrong
  // colour, since every entry is supposed to stand for its own Prism slot.
  const variables = Object.values(SYNTAX_TOKEN_MAP);
  assert.equal(new Set(variables).size, variables.length);
});

test('the variable count is stable', () => {
  assert.equal(Object.keys(collectSyntaxVariables(syntaxTheme.style)).length, 136);
});

/**
 * The colour each named slot stands for, as Prism spells it, one table per
 * appearance. The distinctness check above cannot catch two names being swapped
 * or a name being left on some other slot's value; these can, and they double as
 * the record of which slot the editor's tags were matched against.
 *
 * Both appearances are recorded because the sheet writes them from two different
 * Prism themes — and the light one is the side `buildSyntaxTheme` may omit a
 * declaration for, so a slot that lost its light value would otherwise pass.
 */
const ONE_DARK_SLOT_COLOURS: Record<SyntaxSemanticName, string> = {
  comment: 'hsl(220, 10%, 40%)',
  punctuation: 'hsl(220, 14%, 71%)',
  className: 'hsl(29, 54%, 61%)',
  constant: 'hsl(29, 54%, 61%)',
  number: 'hsl(29, 54%, 61%)',
  keyword: 'hsl(286, 60%, 67%)',
  property: 'hsl(355, 65%, 65%)',
  string: 'hsl(95, 38%, 62%)',
  function: 'hsl(207, 82%, 66%)',
  url: 'hsl(187, 47%, 55%)',
  blockForeground: 'hsl(220, 14%, 71%)',
};

const ONE_LIGHT_SLOT_COLOURS: Record<SyntaxSemanticName, string> = {
  comment: 'hsl(230, 4%, 64%)',
  punctuation: 'hsl(230, 8%, 24%)',
  className: 'hsl(35, 99%, 36%)',
  constant: 'hsl(35, 99%, 36%)',
  number: 'hsl(35, 99%, 36%)',
  keyword: 'hsl(301, 63%, 40%)',
  property: 'hsl(5, 74%, 59%)',
  string: 'hsl(119, 34%, 47%)',
  function: 'hsl(221, 87%, 60%)',
  url: 'hsl(198, 99%, 37%)',
  blockForeground: 'hsl(230, 8%, 24%)',
};

/** One `:root{}` or `.dark{}` block of the generated sheet, as name → declared value. */
function declarationsIn(blockSelector: string): Map<string, string> {
  const block = new RegExp(`${blockSelector}\\{([^}]*)\\}`).exec(syntaxTheme.css);
  assert.ok(block, `the generated sheet has no ${blockSelector} block`);

  return new Map(
    block[1]
      .split(';')
      .filter((declaration) => declaration.includes(':'))
      .map((declaration) => {
        const separator = declaration.indexOf(':');
        return [declaration.slice(0, separator).trim(), declaration.slice(separator + 1)] as const;
      }),
  );
}

test('the named slots keep the One Dark colours they stand for', () => {
  const dark = declarationsIn('\\.dark');

  for (const [name, expected] of Object.entries(ONE_DARK_SLOT_COLOURS)) {
    const variable = SYNTAX_TOKEN_MAP[name as SyntaxSemanticName];
    assert.equal(dark.get(variable), expected, `"${name}" (${variable}) moved off its One Dark colour`);
  }
});

test('the named slots keep the One Light colours they stand for', () => {
  const light = declarationsIn(':root');

  for (const [name, expected] of Object.entries(ONE_LIGHT_SLOT_COLOURS)) {
    const variable = SYNTAX_TOKEN_MAP[name as SyntaxSemanticName];
    assert.equal(light.get(variable), expected, `"${name}" (${variable}) moved off its One Light colour`);
  }
});

test('the selector → variable mapping is frozen', () => {
  // The snapshot is the contract: a Prism bump that renumbers the sheet fails
  // here, forcing a deliberate remap instead of a silent recolour.
  expect(collectSyntaxVariables(syntaxTheme.style)).toMatchInlineSnapshot(`
    {
      ".command-line .command-line-prompt > span:before.color": "--cc-syntax-111",
      ".command-line .command-line-prompt.borderRightColor": "--cc-syntax-109",
      ".language-css .token.atrule .token.rule.color": "--cc-syntax-56",
      ".language-css .token.function.color": "--cc-syntax-52",
      ".language-css .token.important.color": "--cc-syntax-55",
      ".language-css .token.property.color": "--cc-syntax-51",
      ".language-css .token.selector.color": "--cc-syntax-50",
      ".language-css .token.url > .token.function.color": "--cc-syntax-53",
      ".language-css .token.url > .token.string.url.color": "--cc-syntax-54",
      ".language-javascript .token.operator.color": "--cc-syntax-57",
      ".language-javascript .token.template-string > .token.interpolation > .token.interpolation-punctuation.punctuation.color": "--cc-syntax-58",
      ".language-json .token.null.keyword.color": "--cc-syntax-60",
      ".language-json .token.operator.color": "--cc-syntax-59",
      ".language-markdown .token.blockquote.punctuation.color": "--cc-syntax-67",
      ".language-markdown .token.bold .token.content.color": "--cc-syntax-70",
      ".language-markdown .token.code-snippet.color": "--cc-syntax-69",
      ".language-markdown .token.hr.punctuation.color": "--cc-syntax-68",
      ".language-markdown .token.italic .token.content.color": "--cc-syntax-71",
      ".language-markdown .token.list.punctuation.color": "--cc-syntax-74",
      ".language-markdown .token.strike .token.content.color": "--cc-syntax-72",
      ".language-markdown .token.strike .token.punctuation.color": "--cc-syntax-73",
      ".language-markdown .token.title.important > .token.punctuation.color": "--cc-syntax-75",
      ".language-markdown .token.url > .token.content.color": "--cc-syntax-64",
      ".language-markdown .token.url > .token.operator.color": "--cc-syntax-62",
      ".language-markdown .token.url > .token.url.color": "--cc-syntax-65",
      ".language-markdown .token.url-reference.url > .token.string.color": "--cc-syntax-63",
      ".language-markdown .token.url-reference.url.color": "--cc-syntax-66",
      ".language-markdown .token.url.color": "--cc-syntax-61",
      ".line-highlight.line-highlight.background": "--cc-syntax-102",
      ".line-highlight.line-highlight:before.background": "--cc-syntax-103",
      ".line-highlight.line-highlight:before.color": "--cc-syntax-104",
      ".line-highlight.line-highlight[data-end]:after.background": "--cc-syntax-105",
      ".line-highlight.line-highlight[data-end]:after.color": "--cc-syntax-106",
      ".line-numbers .line-numbers-rows > span:before.color": "--cc-syntax-110",
      ".line-numbers.line-numbers .line-numbers-rows.borderRightColor": "--cc-syntax-108",
      ".prism-previewer-angle.prism-previewer-angle circle.stroke": "--cc-syntax-131",
      ".prism-previewer-angle.prism-previewer-angle:before.background": "--cc-syntax-128",
      ".prism-previewer-easing.prism-previewer-easing circle.stroke": "--cc-syntax-133",
      ".prism-previewer-easing.prism-previewer-easing line.stroke": "--cc-syntax-135",
      ".prism-previewer-easing.prism-previewer-easing path.stroke": "--cc-syntax-134",
      ".prism-previewer-easing.prism-previewer-easing.background": "--cc-syntax-130",
      ".prism-previewer-flipped.prism-previewer-flipped.after.borderBottomColor": "--cc-syntax-127",
      ".prism-previewer-gradient.prism-previewer-gradient div.borderColor": "--cc-syntax-125",
      ".prism-previewer-time.prism-previewer-time circle.stroke": "--cc-syntax-132",
      ".prism-previewer-time.prism-previewer-time:before.background": "--cc-syntax-129",
      ".prism-previewer.prism-previewer:after.borderTopColor": "--cc-syntax-126",
      ".prism-previewer.prism-previewer:before.borderColor": "--cc-syntax-124",
      ".rainbow-braces .token.token.punctuation.brace-level-1.color": "--cc-syntax-112",
      ".rainbow-braces .token.token.punctuation.brace-level-10.color": "--cc-syntax-117",
      ".rainbow-braces .token.token.punctuation.brace-level-11.color": "--cc-syntax-120",
      ".rainbow-braces .token.token.punctuation.brace-level-12.color": "--cc-syntax-123",
      ".rainbow-braces .token.token.punctuation.brace-level-2.color": "--cc-syntax-115",
      ".rainbow-braces .token.token.punctuation.brace-level-3.color": "--cc-syntax-118",
      ".rainbow-braces .token.token.punctuation.brace-level-4.color": "--cc-syntax-121",
      ".rainbow-braces .token.token.punctuation.brace-level-5.color": "--cc-syntax-113",
      ".rainbow-braces .token.token.punctuation.brace-level-6.color": "--cc-syntax-116",
      ".rainbow-braces .token.token.punctuation.brace-level-7.color": "--cc-syntax-119",
      ".rainbow-braces .token.token.punctuation.brace-level-8.color": "--cc-syntax-122",
      ".rainbow-braces .token.token.punctuation.brace-level-9.color": "--cc-syntax-114",
      "atrule.color": "--cc-syntax-29",
      "attr-name.color": "--cc-syntax-24",
      "attr-value > .token.punctuation.attr-equals.color": "--cc-syntax-48",
      "attr-value > .token.punctuation.color": "--cc-syntax-43",
      "attr-value.color": "--cc-syntax-42",
      "boolean.color": "--cc-syntax-26",
      "builtin.color": "--cc-syntax-39",
      "cdata.color": "--cc-syntax-20",
      "char.color": "--cc-syntax-38",
      "class-name.color": "--cc-syntax-class-name-color",
      "code[class*="language-"] *::-moz-selection.background": "--cc-syntax-8",
      "code[class*="language-"] *::-moz-selection.textShadow": "--cc-syntax-9",
      "code[class*="language-"] *::selection.background": "--cc-syntax-14",
      "code[class*="language-"] *::selection.textShadow": "--cc-syntax-15",
      "code[class*="language-"].background": "--cc-syntax-0",
      "code[class*="language-"].color": "--cc-syntax-1",
      "code[class*="language-"].textShadow": "--cc-syntax-2",
      "code[class*="language-"]::-moz-selection.background": "--cc-syntax-6",
      "code[class*="language-"]::-moz-selection.textShadow": "--cc-syntax-7",
      "code[class*="language-"]::selection.background": "--cc-syntax-12",
      "code[class*="language-"]::selection.textShadow": "--cc-syntax-13",
      "comment.color": "--cc-syntax-comment-color",
      "constant.color": "--cc-syntax-constant-color",
      "deleted.color": "--cc-syntax-34",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > a.background": "--cc-syntax-86",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > a.color": "--cc-syntax-87",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:focus.background": "--cc-syntax-96",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:focus.color": "--cc-syntax-97",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:hover.background": "--cc-syntax-94",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:hover.color": "--cc-syntax-95",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > button.background": "--cc-syntax-84",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > button.color": "--cc-syntax-85",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:focus.background": "--cc-syntax-92",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:focus.color": "--cc-syntax-93",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:hover.background": "--cc-syntax-90",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:hover.color": "--cc-syntax-91",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > span.background": "--cc-syntax-88",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > span.color": "--cc-syntax-89",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:focus.background": "--cc-syntax-100",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:focus.color": "--cc-syntax-101",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:hover.background": "--cc-syntax-98",
      "div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:hover.color": "--cc-syntax-99",
      "doctype.color": "--cc-syntax-21",
      "entity.color": "--cc-syntax-23",
      "function.color": "--cc-syntax-function-color",
      "important.color": "--cc-syntax-35",
      "inserted.color": "--cc-syntax-40",
      "keyword.color": "--cc-syntax-keyword-color",
      "number.color": "--cc-syntax-number-color",
      "operator.color": "--cc-syntax-45",
      "pre[class*="language-"] *::-moz-selection.background": "--cc-syntax-10",
      "pre[class*="language-"] *::-moz-selection.textShadow": "--cc-syntax-11",
      "pre[class*="language-"] *::selection.background": "--cc-syntax-16",
      "pre[class*="language-"] *::selection.textShadow": "--cc-syntax-17",
      "pre[class*="language-"].background": "--cc-syntax-3",
      "pre[class*="language-"].color": "--cc-syntax-block-foreground",
      "pre[class*="language-"].textShadow": "--cc-syntax-5",
      "pre[id].linkable-line-numbers.linkable-line-numbers span.line-numbers-rows > span:hover:before.backgroundColor": "--cc-syntax-107",
      "prolog.color": "--cc-syntax-19",
      "property.color": "--cc-syntax-property-color",
      "punctuation.color": "--cc-syntax-punctuation-color",
      "regex.color": "--cc-syntax-41",
      "selector.color": "--cc-syntax-36",
      "special-attr > .token.attr-value > .token.value.css.color": "--cc-syntax-49",
      "string.color": "--cc-syntax-string-color",
      "symbol.color": "--cc-syntax-33",
      "tag.color": "--cc-syntax-32",
      "token.cr:before.color": "--cc-syntax-78",
      "token.cr:before.textShadow": "--cc-syntax-79",
      "token.lf:before.color": "--cc-syntax-80",
      "token.lf:before.textShadow": "--cc-syntax-81",
      "token.space:before.color": "--cc-syntax-82",
      "token.space:before.textShadow": "--cc-syntax-83",
      "token.tab:not(:empty):before.color": "--cc-syntax-76",
      "token.tab:not(:empty):before.textShadow": "--cc-syntax-77",
      "url.color": "--cc-syntax-url-color",
      "variable.color": "--cc-syntax-44",
    }
  `);
});

// Vitest runs with the repository root as its working directory, and
// `import.meta.url` is not a file URL under its module runner.
//
// The scan covers every tree a hand-written `--cc-syntax-N` could hide in —
// the client sources, the server, and the browser suites (§5.8 v8). The
// generator and this file's snapshot remain the only places a number may
// appear, and both live under `src`.
const SCAN_ROOTS: ReadonlyArray<{ root: string; extensions: string[] }> = [
  { root: join(process.cwd(), 'src'), extensions: ['.ts', '.tsx'] },
  { root: join(process.cwd(), 'server'), extensions: ['.ts', '.js'] },
  { root: join(process.cwd(), 'tests'), extensions: ['.ts'] },
];

const sourceFiles = (directory: string, extensions: string[]): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path, extensions);
    }
    return extensions.includes(extname(entry.name)) ? [path] : [];
  });

test('no call site hard-codes a syntax variable number', () => {
  // The generator and this file's snapshot are the two places a number may
  // appear — the snapshot *is* the mapping. Everyone else goes through
  // SYNTAX_TOKEN_MAP, which survives the renumbering described above.
  //
  // The eleven slots on the contract surface are published under names now, and
  // this pattern deliberately no longer matches them: what it still guards is
  // the *numbered* slots, the ones whose numbers a Prism bump can still move.
  const allowed = new Set([
    join('shared', 'syntaxTheme.ts'),
    join('shared', 'tests', 'syntaxThemeTokenMap.test.ts'),
  ]);
  const pattern = /--cc-syntax-[0-9]/;
  const offenders: string[] = [];

  for (const { root, extensions } of SCAN_ROOTS) {
    for (const path of sourceFiles(root, extensions)) {
      const relative = path.slice(root.length + 1);
      if (root === process.cwd() + '/src' && allowed.has(relative)) {
        continue;
      }
      if (pattern.test(readFileSync(path, 'utf8'))) {
        offenders.push(path.slice(process.cwd().length + 1));
      }
    }
  }

  assert.deepEqual(offenders, [], 'these files hand-write a --cc-syntax-N literal');
});
