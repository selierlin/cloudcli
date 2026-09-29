import assert from 'node:assert/strict';

import { test } from 'vitest';

import { SYNTAX_TOKEN_MAP } from '@/shared/syntaxTheme';
import { compileTmTheme } from '@/shared/tmTheme';

/**
 * The `.tmTheme` compiler.
 *
 * A `.tmTheme` is the one theme format this app did not author, so what is pinned
 * here is the two-way translation: TextMate's plist into an overlay this app can
 * inject, and its scope vocabulary into the ten syntax slots the renderers
 * actually consume. The two places where copying a value would be wrong have
 * their own tests — a hex written into a terminal token compiles to nothing the
 * browser can parse (§5.5 v3), and a syntax variable written by hand would bind
 * a theme to a numbering a Prism bump reorders (§5.9).
 */

const ID = 'user-dracula';

/** One `<dict>` of the `settings` array, as a `.tmTheme` writes it. */
const rule = (entries: Array<[string, string]>, scope?: string): string => {
  const pairs = entries.map(([key, value]) => `<key>${key}</key><string>${value}</string>`).join('');
  const scopeXml = scope === undefined ? '' : `<key>scope</key><string>${scope}</string>`;
  return `<dict>${scopeXml}<key>settings</key><dict>${pairs}</dict></dict>`;
};

/** A whole `.tmTheme`, given its `settings` array entries. */
const tmTheme = (...rules: string[]): string =>
  [
    '<plist version="1.0"><dict>',
    '<key>name</key><string>Test</string>',
    `<key>settings</key><array>${rules.join('')}</array>`,
    '</dict></plist>',
  ].join('');

/** A `.tmTheme` that also carries a top-level `cloudcli` key with the given inner plist. */
const withCloudCli = (inner: string, ...rules: string[]): string =>
  [
    '<plist version="1.0"><dict>',
    '<key>name</key><string>Test</string>',
    `<key>cloudcli</key><dict>${inner}</dict>`,
    `<key>settings</key><array>${rules.join('')}</array>`,
    '</dict></plist>',
  ].join('');

/** The `tokens` dict of a `cloudcli` key, from token → value pairs. */
const tokenDict = (entries: Array<[string, string]>): string =>
  `<key>tokens</key><dict>${entries
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
    .join('')}</dict>`;

/** Splits a compiled stylesheet into its per-selector blocks, at each block's closing brace. */
const blockBodies = (css: string): string[] =>
  css
    .split('}\n')
    .map((part) => part.trim())
    .filter(Boolean);

/** The compiled overlay's declarations, so an assertion can name one token. */
const declarationsOf = (css: string): Map<string, string> => {
  const body = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
  return new Map(
    body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/;$/, '')];
      }),
  );
};

const compileOk = (body: string, id: string = ID): Map<string, string> => {
  const compiled = compileTmTheme(id, body);
  assert.ok(compiled.ok, `expected a compile, got ${compiled.ok ? '' : compiled.reason}`);
  return declarationsOf(compiled.css);
};

test('a theme compiles into an overlay naming the syntax slots through the derived map', () => {
  const declarations = compileOk(tmTheme(
    rule([
      ['background', '#282a36'],
      ['foreground', '#f8f8f2'],
      ['caret', '#f8f8f0'],
      ['selection', '#44475a'],
      ['lineHighlight', '#3f4152'],
    ]),
    rule([['foreground', '#ff79c6']], 'keyword'),
    rule([['foreground', '#50fa7b']], 'string'),
    rule([['foreground', '#6272a4']], 'comment'),
  ));

  // The terminal resolves these as `hsl(var(--term-…))`, so a triplet is the only
  // shape that survives — a hex here is dropped by the browser, silently.
  assert.equal(declarations.get('--term-background'), '231 15% 18%');
  assert.equal(declarations.get('--term-foreground'), '60 30% 96%');
  assert.equal(declarations.get('--term-selection-bg'), '232 14% 31%');
  // The editor takes complete values, so the theme's own spelling is kept.
  assert.equal(declarations.get('--editor-bg'), '#282a36');
  assert.equal(declarations.get('--editor-fg'), '#f8f8f2');
  assert.equal(declarations.get('--editor-caret'), '#f8f8f0');
  assert.equal(declarations.get('--editor-selection'), '#44475a');
  assert.equal(declarations.get('--editor-active-line-bg'), '#3f4152');
  // Addressed by the mapping, never by a literal: the numbers are the build's.
  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.keyword), '#ff79c6');
  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.string), '#50fa7b');
  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.comment), '#6272a4');
});

test('the selector is the same overlay shape the other compilers write', () => {
  const compiled = compileTmTheme(ID, tmTheme(rule([['foreground', '#f8f8f2']])));
  assert.ok(compiled.ok);
  assert.match(compiled.css, /^\[data-theme="user-dracula"\] \{\n/);
  assert.ok(!compiled.css.includes(':not(.dark)'), 'a code theme states one palette, not one per appearance');
});

test('a scope nothing claims is not reported, because the table is a projection', () => {
  const compiled = compileTmTheme(ID, tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff0000']], 'markup.bold'),
  ));

  assert.ok(compiled.ok);
  assert.deepEqual(compiled.ignored, [], 'TextMate has far more scopes than ten; falling through is normal');
});

test('a slot no rule mentions takes the global foreground rather than the base palette colour', () => {
  const declarations = compileOk(tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff79c6']], 'keyword'),
  ));

  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.keyword), '#ff79c6');
  assert.equal(
    declarations.get(SYNTAX_TOKEN_MAP.punctuation),
    '#f8f8f2',
    'in TextMate an unmentioned scope is simply the foreground; leaving the base colour would mix two palettes',
  );
});

test('the block foreground slot also takes the global foreground', () => {
  // No scope stands for the body colour of the block, so this slot is never in
  // the projection: it is carried by the emission loop's fallback, and that is
  // what keeps a compiled theme's code blocks out of the base Prism palette.
  const declarations = compileOk(tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff79c6']], 'keyword'),
  ));

  assert.equal(
    declarations.get(SYNTAX_TOKEN_MAP.blockForeground),
    '#f8f8f2',
    'the block foreground should follow the theme foreground like any unclaimed slot',
  );
});

test('the global foreground is never written into the main UI tokens', () => {
  const declarations = compileOk(tmTheme(rule([
    ['background', '#282a36'],
    ['foreground', '#f8f8f2'],
  ])));

  for (const token of ['--background', '--foreground', '--card', '--border', '--primary']) {
    assert.equal(declarations.has(token), false, `${token} is not a code theme's to move`);
  }
});

test('longer scope patterns win, so constant.numeric is a number and not a constant', () => {
  const declarations = compileOk(tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#bd93f9']], 'constant.numeric'),
    rule([['foreground', '#8be9fd']], 'constant'),
  ));

  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.number), '#bd93f9');
  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.constant), '#8be9fd');
});

test('a dotted descendant of a pattern matches it', () => {
  const declarations = compileOk(tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff79c6']], 'keyword.control.flow'),
  ));

  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.keyword), '#ff79c6');
});

test('a comma-separated scope selector claims every scope it names', () => {
  const declarations = compileOk(tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff79c6']], 'keyword, storage, punctuation'),
  ));

  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.keyword), '#ff79c6');
  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.punctuation), '#ff79c6');
});

test('the last rule to claim a slot is the one that colours it', () => {
  const declarations = compileOk(tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff79c6']], 'keyword'),
    rule([['foreground', '#50fa7b']], 'keyword.control'),
  ));

  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.keyword), '#50fa7b');
});

test('a three-digit hex is expanded, and alpha is dropped only where the consumer cannot hold it', () => {
  const declarations = compileOk(tmTheme(
    rule([['background', '#f00'], ['foreground', '#00ff0080'], ['caret', '#0f0']]),
    rule([['foreground', '#0000ffff']], 'keyword'),
  ));

  assert.equal(declarations.get('--term-background'), '0 100% 50%');
  assert.equal(
    declarations.get('--editor-fg'),
    '#00ff0080',
    'the editor takes a complete value, so its alpha is the theme author’s business',
  );
  assert.equal(
    declarations.get('--term-foreground'),
    '120 100% 50%',
    'the terminal resolves through hsl(), which has no slot for alpha',
  );
  assert.equal(declarations.get(SYNTAX_TOKEN_MAP.keyword), '#0000ffff');
});

test('a colour that is not hexadecimal is dropped and reported, and the rest still applies', () => {
  const compiled = compileTmTheme(ID, tmTheme(
    rule([['background', 'red'], ['foreground', '#f8f8f2']]),
    rule([['foreground', 'rgb(255, 0, 0)']], 'string'),
  ));

  assert.ok(compiled.ok, 'one unreadable colour costs that colour, not the theme');
  const declarations = declarationsOf(compiled.css);
  assert.equal(declarations.has('--term-background'), false);
  assert.equal(declarations.get('--editor-fg'), '#f8f8f2');
  assert.ok(
    compiled.ignored.some(({ what, reason }) => what === 'background' && reason.includes('hexadecimal')),
    'the author has to be able to see which value was refused',
  );
  assert.ok(
    compiled.ignored.some(({ what }) => what === 'string'),
    'a scope rule with an unusable colour is reported by the scope it claimed',
  );
  assert.equal(
    declarations.get(SYNTAX_TOKEN_MAP.string),
    '#f8f8f2',
    'the slot falls back to the foreground rather than keeping the base palette’s colour',
  );
});

test('a font style is reported as not carried, because no token takes one', () => {
  const compiled = compileTmTheme(ID, tmTheme(
    rule([['foreground', '#f8f8f2']]),
    rule([['foreground', '#ff79c6'], ['fontStyle', 'italic']], 'keyword'),
  ));

  assert.ok(compiled.ok);
  assert.equal(declarationsOf(compiled.css).get(SYNTAX_TOKEN_MAP.keyword), '#ff79c6');
  assert.ok(
    compiled.ignored.some(({ what }) => what === 'fontStyle'),
    'silently losing italics would read as a compiler bug rather than a missing token',
  );
});

test('the selection foreground feeds the terminal alone', () => {
  const declarations = compileOk(tmTheme(rule([
    ['foreground', '#f8f8f2'],
    ['selectionForeground', '#ffffff'],
  ])));

  assert.equal(declarations.get('--term-selection-fg'), '0 0% 100%');
  assert.equal(declarations.has('--editor-selection-fg'), false);
});

test('a body that is not a plist is refused as unreadable rather than compiled to nothing', () => {
  for (const body of ['{"tokens":{}}', 'body { color: red }', '', '<plist><dict></dict></plist>']) {
    const compiled = compileTmTheme(ID, body);
    assert.equal(compiled.ok, false, `${JSON.stringify(body)} is not a .tmTheme`);
    assert.equal(compiled.ok ? null : compiled.reason, 'unreadable-plist');
  }
});

test('a plist with no settings array is unreadable, and one with settings but no colours is unusable', () => {
  const withoutSettings = '<plist version="1.0"><dict><key>name</key><string>Test</string></dict></plist>';

  const unreadable = compileTmTheme(ID, withoutSettings);
  assert.equal(unreadable.ok, false);
  assert.equal(
    unreadable.ok ? null : unreadable.reason,
    'unreadable-plist',
    'a plist without a settings array is not a .tmTheme at all',
  );

  const unusable = compileTmTheme(ID, tmTheme(rule([])));
  assert.equal(unusable.ok, false);
  assert.equal(
    unusable.ok ? null : unusable.reason,
    'nothing-usable',
    'a settings array that states no colour this app has a token for',
  );
});

test('an id that could not sit in a selector refuses the file before it is parsed', () => {
  const compiled = compileTmTheme('user-"] body', tmTheme(rule([['foreground', '#f8f8f2']])));

  assert.equal(compiled.ok, false);
  assert.equal(compiled.ok ? null : compiled.reason, 'unsafe-id');
});

test('an embedded cloudcli key compiles into a second block, placed after the TextMate half', () => {
  const compiled = compileTmTheme(ID, withCloudCli(
    tokenDict([['--muted', '210 40% 92%']]),
    rule([['foreground', '#f8f8f2']]),
  ));

  assert.ok(compiled.ok, `expected a compile, got ${compiled.ok ? '' : compiled.reason}`);
  const blocks = blockBodies(compiled.css);
  assert.equal(blocks.length, 2, 'two payloads, two blocks');

  assert.ok(blocks[0].startsWith(`[data-theme="${ID}"] {`), 'the TextMate half keeps its own selector');
  assert.equal(
    declarationsOf(blocks[0]).get(SYNTAX_TOKEN_MAP.punctuation),
    '#f8f8f2',
    'the TextMate half is compiled as before',
  );

  assert.ok(blocks[1].startsWith(`[data-theme="${ID}"] {`));
  assert.equal(declarationsOf(blocks[1]).get('--muted'), '210 40% 92%');
});

test('an embedded token that meets a TextMate global wins, because it is the later block', () => {
  const compiled = compileTmTheme(ID, withCloudCli(
    tokenDict([['--term-background', '10 20% 30%']]),
    rule([['background', '#282a36'], ['foreground', '#f8f8f2']]),
  ));

  assert.ok(compiled.ok);
  const blocks = blockBodies(compiled.css);
  assert.equal(blocks.length, 2);
  assert.equal(declarationsOf(blocks[0]).get('--term-background'), '231 15% 18%');
  assert.equal(
    declarationsOf(blocks[1]).get('--term-background'),
    '10 20% 30%',
    'the cloudcli key is the more deliberate statement about this app',
  );
});

test('a cloudcli key carrying no tokens is reported, and the TextMate half still compiles', () => {
  const compiled = compileTmTheme(ID, withCloudCli('', rule([['foreground', '#f8f8f2']])));

  assert.ok(compiled.ok);
  assert.ok(
    compiled.ignored.some(({ what, reason }) => what === 'cloudcli.tokens' && reason.includes('missing')),
    'an empty extension key is an author error worth saying out loud',
  );
  assert.equal(declarationsOf(compiled.css).get(SYNTAX_TOKEN_MAP.punctuation), '#f8f8f2');
});

test('a token the whitelist refuses is dropped with the cloudcli prefix, the rest of the block stands', () => {
  const compiled = compileTmTheme(ID, withCloudCli(
    tokenDict([
      ['--sidebar', '0 0% 50%'],
      ['--muted', '210 40% 92%'],
    ]),
    rule([['foreground', '#f8f8f2']]),
  ));

  assert.ok(compiled.ok);
  const blocks = blockBodies(compiled.css);
  assert.equal(blocks.length, 2);
  assert.equal(declarationsOf(blocks[1]).has('--sidebar'), false);
  assert.equal(declarationsOf(blocks[1]).get('--muted'), '210 40% 92%');
  assert.ok(
    compiled.ignored.some(({ what, reason }) => what === 'cloudcli.--sidebar' && reason.includes('not a token')),
    'the prefix is what keeps the console line from being read as a TextMate half drop',
  );
});

test('an unsafe embedded value refuses the whole embedded block, and the TextMate half stands', () => {
  const compiled = compileTmTheme(ID, withCloudCli(
    tokenDict([['--muted', '0 0% 50%} body { color: red }']]),
    rule([['foreground', '#f8f8f2']]),
  ));

  assert.ok(compiled.ok, 'the escape-shaped value is the embedded block\u2019s problem, not the file\u2019s');
  const blocks = blockBodies(compiled.css);
  assert.equal(blocks.length, 1, 'the refused block leaves nothing behind');
  assert.ok(!blocks[0].includes('--muted'));
  assert.ok(
    compiled.ignored.some(({ what, reason }) => what === 'cloudcli.--muted' && reason.includes('refused')),
  );
});

test('an embedded appearance scope scopes the block, and an unknown one is reported with the system fallback', () => {
  const dark = compileTmTheme(ID, withCloudCli(
    `<key>appearance</key><string>dark</string>${tokenDict([['--muted', '210 40% 92%']])}`,
  ));

  assert.ok(dark.ok);
  const darkBlocks = blockBodies(dark.css);
  assert.equal(darkBlocks.length, 1);
  assert.ok(darkBlocks[0].startsWith(`[data-theme="${ID}"].dark {`));

  const unknown = compileTmTheme(ID, withCloudCli(
    `<key>appearance</key><string>always</string>${tokenDict([['--muted', '210 40% 92%']])}`,
  ));

  assert.ok(unknown.ok);
  assert.ok(
    unknown.ignored.some(({ what, reason }) => what === 'cloudcli.appearance' && reason.includes('not one of')),
  );
  assert.ok(blockBodies(unknown.css)[0].startsWith(`[data-theme="${ID}"] {`), 'the fallback is unscoped');
});

test('a non-string value inside the embedded tokens dict is reported as not a string', () => {
  const compiled = compileTmTheme(ID, withCloudCli(
    '<key>tokens</key><dict><key>--muted</key><real>0.5</real></dict>',
    rule([['foreground', '#f8f8f2']]),
  ));

  assert.ok(compiled.ok);
  assert.ok(
    compiled.ignored.some(({ what, reason }) => what === 'cloudcli.--muted' && reason.includes('not a string')),
  );
});

test('the embedded key\u2019s own tokens are contrast-checked like any other option A theme', () => {
  // §5.5's own example: a light-scoped teal --primary meeting the base
  // --primary-foreground lands below the AA floor, and the compiler has to say
  // so through the same `warnings` field a `.json` theme's verdict carries.
  const compiled = compileTmTheme(ID, withCloudCli(
    `<key>appearance</key><string>light</string>${tokenDict([['--primary', '175 84% 32%']])}`,
  ));

  assert.ok(compiled.ok);
  assert.ok(
    compiled.warnings.some(({ appearance, ink, surface }) =>
      appearance === 'light' && ink === '--primary-foreground' && surface === '--primary'),
    'the embedded key moves main-UI tokens, so §5.10 speaks about it',
  );
});

test('a file whose only colours are the embedded key\u2019s still compiles', () => {
  // The `nothing-usable` verdict belongs to the whole file, so an embedded block
  // that can stand on its own must not be sunk by an empty TextMate half.
  const compiled = compileTmTheme(ID, withCloudCli(tokenDict([['--muted', '210 40% 92%']]), rule([])));

  assert.ok(compiled.ok, `expected a compile, got ${compiled.ok ? '' : compiled.reason}`);
  const blocks = blockBodies(compiled.css);
  assert.equal(blocks.length, 1, 'the TextMate half contributes no block');
  assert.equal(declarationsOf(blocks[0]).get('--muted'), '210 40% 92%');
});

test('a file without a cloudcli key carries no warnings, as before', () => {
  const compiled = compileTmTheme(ID, tmTheme(rule([['foreground', '#f8f8f2']])));

  assert.ok(compiled.ok);
  assert.deepEqual(compiled.warnings, []);
});
