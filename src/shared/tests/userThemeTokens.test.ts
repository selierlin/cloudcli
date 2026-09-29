import assert from 'node:assert/strict';

import { test } from 'vitest';

import { SYNTAX_TOKEN_MAP } from '@/shared/syntaxTheme';
import { compileUserThemeTokens } from '@/shared/userThemeTokens';
import type { UserThemeCompileResult } from '@/shared/userThemeTokens';

/**
 * Option A's compiler: a token JSON turned into an overlay stylesheet.
 *
 * Two jobs, and the tests keep them apart. The whitelist and the value shapes
 * are ergonomics — they decide whether a theme's colours arrive — while the
 * structural gate is the one that carries §5.5's promise that option A cannot
 * write a selector. A value that could end its declaration is therefore a
 * refusal of the whole file, not a dropped token, and the cases below are the
 * shapes that would otherwise let a theme out of its box.
 */

const ID = 'user-borealis';

function compile(tokens: Record<string, unknown>, extra: Record<string, unknown> = {}): UserThemeCompileResult {
  return compileUserThemeTokens(ID, JSON.stringify({ ...extra, tokens }));
}

/** Compiles and returns the stylesheet, failing loudly when the file was refused. */
function css(tokens: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const result = compile(tokens, extra);
  assert.ok(result.ok, `expected a stylesheet, got a refusal: ${JSON.stringify(result)}`);
  return result.css;
}

/** The tokens the compiler left out, keyed by name for readable assertions. */
function ignoredNames(result: UserThemeCompileResult): string[] {
  return result.ignored.map((entry) => entry.what);
}

test('a token map compiles into an overlay selector', () => {
  assert.equal(
    css({ '--primary': '175 84% 32%', '--ring': '175 84% 32%' }),
    `[data-theme="${ID}"] {\n  --primary: 175 84% 32%;\n  --ring: 175 84% 32%;\n}\n`,
  );
});

test('a reference to another token is kept as written', () => {
  // The L2 tokens are refs to L1 in the stylesheet, so a theme may restate one
  // rather than flattening it — that is how the palette indirection survives.
  assert.match(css({ '--background': 'var(--palette-ink-950)' }), /--background: var\(--palette-ink-950\);/);
});

test('the declared appearance scopes the overlay to one appearance', () => {
  const tokens = { '--primary': '175 84% 32%' };

  assert.match(
    css(tokens, { appearance: 'light' }),
    new RegExp(`^\\[data-theme="${ID}"\\]:not\\(\\.dark\\) \\{`),
    'a light-only theme must not apply in the dark appearance',
  );
  assert.match(
    css(tokens, { appearance: 'dark' }),
    new RegExp(`^\\[data-theme="${ID}"\\]\\.dark \\{`),
  );
  assert.match(
    css(tokens, { appearance: 'system' }),
    new RegExp(`^\\[data-theme="${ID}"\\] \\{`),
    'system means both appearances, which is what an unscoped overlay does',
  );
  assert.match(
    css(tokens),
    new RegExp(`^\\[data-theme="${ID}"\\] \\{`),
    'a file that says nothing is unscoped rather than guessing an appearance',
  );
});

test('an unrecognised appearance is reported and falls back to both', () => {
  const result = compile({ '--primary': '175 84% 32%' }, { appearance: 'twilight' });

  assert.ok(result.ok);
  assert.match(result.css, new RegExp(`^\\[data-theme="${ID}"\\] \\{`));
  assert.deepEqual(ignoredNames(result), ['appearance']);
  assert.match(result.ignored[0].reason, /not one of/);
});

test('the palette and terminal boards take a triplet, not a complete colour', () => {
  const result = compile({
    '--palette-sand-50': '44 22% 96%',
    // The hex a palette token is most tempting to write. L1 is consumed as
    // `hsl(var(--palette-…))` too, so this has to be refused for the same
    // reason the terminal one below is.
    '--palette-brand-500': '#2f6fdb',
    // The design doc's own example wrote this as a hex. It has to be refused:
    // `readTerminalTheme` resolves `--term-*` as `hsl(var(--term-…))`, so a hex
    // compiles to `hsl(#0b1220)`, the declaration is dropped by the browser,
    // and the terminal silently keeps whatever colour it had before.
    '--term-background': '#0b1220',
  });

  assert.ok(result.ok);
  assert.match(result.css, /--palette-sand-50: 44 22% 96%;/);
  assert.ok(!result.css.includes('--palette-brand-500'), 'the palette takes a triplet and nothing else');
  assert.ok(!result.css.includes('--term-background'), 'the hex form must not reach the stylesheet');
  assert.deepEqual(ignoredNames(result), ['--palette-brand-500', '--term-background']);
  assert.match(result.ignored[0].reason, /HSL triplet/, 'and the report has to say what it wanted');
});

test('the editor chrome takes a complete value, because that is how it is consumed', () => {
  const result = compile({
    '--editor-bg': '#282c34',
    '--editor-gutter-separator': '1px solid #ddd',
    '--editor-toolbar-bg': 'hsl(var(--palette-white))',
    '--editor-panel-border': '2px solid black',
  });

  assert.ok(result.ok);
  assert.equal(result.ignored.length, 0);
  assert.match(result.css, /--editor-gutter-separator: 1px solid #ddd;/);
});

test('the code-block panel takes a triplet, because that is how it is consumed', () => {
  const result = compile({ '--code-block-bg': '220 13% 18%' });

  assert.ok(result.ok);
  assert.equal(result.ignored.length, 0);
  assert.match(result.css, /--code-block-bg: 220 13% 18%;/);
});

test('the code-block panel refuses a hex, because the chat half resolves it through hsl()', () => {
  // `hsl(#282c34)` is not a colour, so the declaration would be dropped by the
  // browser and the panel would silently keep painting the board underneath.
  const result = compile({ '--code-block-bg': '#282c34', '--primary': '175 84% 32%' });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), ['--code-block-bg']);
  assert.match(result.ignored[0].reason, /HSL triplet/);
});

test('the nav glass tokens take an optional alpha, in both spellings', () => {
  const result = compile({
    '--nav-glass-bg': 'var(--palette-ink-900) / 0.55',
    '--nav-tab-glow': '175 84% 32% / 0.18',
    '--nav-divider-color': '44 22% 96%',
    '--nav-glass-blur': '24px',
    '--nav-glass-saturate': '1.6',
  });

  assert.ok(result.ok);
  assert.equal(result.ignored.length, 0);
  assert.match(result.css, /--nav-glass-bg: var\(--palette-ink-900\) \/ 0\.55;/);
});

test('a value that does not fit its token is dropped, and named', () => {
  const result = compile({
    '--primary': 'rebeccapurple',
    '--nav-glass-blur': 'a lot',
    '--radius': '0.5rem',
    '--graph-lane-3': 'var(--palette-graph-3)',
  });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), ['--primary', '--nav-glass-blur']);
  assert.match(result.ignored[0].reason, /HSL triplet/);
  assert.match(result.css, /--radius: 0\.5rem;/);
  assert.match(result.css, /--graph-lane-3: var\(--palette-graph-3\);/);
});

test('tokens outside the theme surface are dropped rather than compiled', () => {
  // A *numbered* syntax slot still stands outside the surface: the numbers move
  // with the highlighter's own generator (§5.9), so only the named slots are
  // part of the contract. Spelled in two pieces so this file carries no literal
  // `--cc-syntax-N` of its own.
  const syntaxToken = `--cc-syntax-${3}`;
  const result = compile({
    [syntaxToken]: '#ff79c6',
    '--safe-area-inset-top': '0px',
    '--mobile-nav-height': '999px',
    '--header-base-padding': '0px',
    '--tw-ring-color': '0 0% 0%',
    '--reasoning-fade-duration': '0s',
    '--ui-font-sans': 'Comic Sans MS',
    '--primary': '175 84% 32%',
  });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), [
    syntaxToken,
    '--safe-area-inset-top',
    '--mobile-nav-height',
    '--header-base-padding',
    '--tw-ring-color',
    '--reasoning-fade-duration',
    '--ui-font-sans',
  ]);
  assert.equal(result.css.match(/^\s{2}--/gm)?.length, 1, 'only the semantic token survives');
});

test('a reference to a token outside the theme surface is dropped too', () => {
  // Otherwise the whitelist would leak: a theme could borrow the meaning of a
  // token it is not allowed to set. The named syntax slots are *inside* the
  // surface now, so the outsider here is one of the numbered ones.
  const result = compile({ '--primary': `var(--cc-syntax-${3})` });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'nothing-usable');
  assert.deepEqual(ignoredNames(result), ['--primary']);
});

test('the terminal font token is not a theme token, even though its name fits the family', () => {
  // `--term-font-family` matches `/^--term-[a-z-]+$/`, so without the explicit
  // exclusion its family rule would take a triplet-shaped value — the one shape
  // the terminal board accepts — and compile it into `font-family: 0 0% 0%`,
  // which the browser drops, leaving the terminal to inherit the page font.
  // The value here is deliberately a valid triplet, not a font stack: a stack
  // like `"Fira Code", monospace` would be dropped for shape anyway and so
  // would not prove the exclusion is doing anything.
  const result = compile({ '--term-font-family': '0 0% 0%', '--primary': '175 84% 32%' });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), ['--term-font-family']);
  assert.doesNotMatch(result.css, /--term-font-family/);
});

test('a value that could leave its declaration refuses the whole file', () => {
  // These are the shapes that would end the declaration, start an at-rule or a
  // comment, or reach for a URL. Pinned here is the *response*: the file is
  // refused rather than partly applied, which is what the structural gate
  // decides. The value rules would reject each of these anyway — their
  // character classes have no `}` or `;` in them — so what this layer buys is
  // the right message for an author who is writing CSS in the constrained
  // format, and a promise that does not depend on every rule staying narrow.
  const escapes: Array<[string, string]> = [
    ['closing brace', '175 84% 32% } body { display: none'],
    ['semicolon', '175 84% 32%; body { display: none'],
    ['at-rule', '175 84% 32% @media all'],
    ['import', "url('https://example.com/x.css')"],
    ['comment', '175 84% 32% /* }'],
    ['important', '175 84% 32% !important'],
    ['backslash', '175 84% 32% \\7d'],
    ['angle bracket', '175 84% 32% </style>'],
    ['line break', '175 84%\n32%'],
  ];

  for (const [label, value] of escapes) {
    const result = compile({ '--primary': '175 84% 32%', '--background': value });
    assert.equal(result.ok, false, `${label} must refuse the file`);
    assert.equal(result.ok === false && result.reason, 'unsafe-value', label);
    assert.equal(result.ok === false && result.token, '--background', label);
  }
});

test('a body that is not a token map is refused for the right reason', () => {
  const cases: Array<[string, string, string]> = [
    ['not JSON at all', '<plist><dict/></plist>', 'unreadable-json'],
    ['a JSON array', '[]', 'unreadable-json'],
    ['a JSON string', '"175 84% 32%"', 'unreadable-json'],
    ['no tokens key', '{"name":"Borealis"}', 'no-tokens'],
    ['tokens is not an object', '{"tokens":[]}', 'no-tokens'],
    ['tokens is empty', '{"tokens":{}}', 'no-tokens'],
  ];

  for (const [label, body, reason] of cases) {
    const result = compileUserThemeTokens(ID, body);
    assert.equal(result.ok, false, label);
    assert.equal(result.ok === false && result.reason, reason, label);
  }
});

test('a theme whose every declaration was dropped is refused, not applied empty', () => {
  const result = compile({ '--primary': 'rebeccapurple' });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'nothing-usable');
  assert.deepEqual(ignoredNames(result), ['--primary']);
});

test('an absurdly long value is dropped rather than carried into the document', () => {
  // The cap is not about safety — the structural gate already covers that — but
  // about not letting one declaration of a 256KB file become a 256KB value in
  // the injected sheet and in the cache that mirrors it.
  const result = compile({ '--editor-bg': '#'.repeat(120), '--primary': '175 84% 32%' });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), ['--editor-bg']);
});

test('a non-string value is reported rather than stringified into the stylesheet', () => {
  const result = compile({ '--primary': 175, '--ring': '175 84% 32%' });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), ['--primary']);
  assert.match(result.ignored[0].reason, /not a string/);
  assert.ok(!result.css.includes('175;'), 'a number must not be coerced into a declaration');
});

test('an id that could break the selector refuses the file', () => {
  for (const id of ['cc-ocean', 'borealis', 'user-a"] { --x: 1 } /*', 'user-a b']) {
    const result = compileUserThemeTokens(id, JSON.stringify({ tokens: { '--primary': '175 84% 32%' } }));
    assert.equal(result.ok, false, id);
    assert.equal(result.ok === false && result.reason, 'unsafe-id', id);
  }
});

test('declarations keep the order the file wrote them in', () => {
  const result = compile({
    '--ring': '175 84% 32%',
    '--primary': '175 84% 32%',
    '--background': '44 22% 96%',
  });

  assert.ok(result.ok);
  assert.deepEqual(
    [...result.css.matchAll(/^\s{2}(--[a-z-]+):/gm)].map((match) => match[1]),
    ['--ring', '--primary', '--background'],
    'a stable order keeps the compiled stylesheet diffable',
  );
});

test('the parts of a file that only the picker needs are not the compiler\u2019s business', () => {
  // `name` and `coverage` are read by the listing, so the compiler must neither
  // require them nor let them reach the stylesheet.
  const result = compile({ '--primary': '175 84% 32%' }, { name: '深海', coverage: 'full' });

  assert.ok(result.ok);
  assert.ok(!result.css.includes('深海'));
  assert.ok(!result.css.includes('coverage'));
});

/**
 * §5.10's contrast warning, as it reaches the compiler's result.
 *
 * The one thing this layer has to get right is *which values the check is given*,
 * and in which of the two shapes: a literal triplet, or the reference to follow.
 * Everything about what the check then makes of them belongs to
 * `userThemeContrast`'s own suite.
 */

test('a theme that compiles but cannot be read carries a warning, and still compiles', () => {
  const result = compile({ '--primary': '175 84% 32%' });

  assert.ok(result.ok, '§5.10 asks for a warning, not a refusal');
  assert.deepEqual(
    result.warnings.map(({ appearance, ink, surface }) => `${appearance} ${ink} on ${surface}`),
    ['light --primary-foreground on --primary'],
  );
  assert.match(
    result.css,
    /--primary: 175 84% 32%;/,
    'and the value the warning is about is in the stylesheet all the same',
  );
});

test('a value that is not a colour is not offered to the contrast check', () => {
  // `--nav-glass` is a legal option A token whose shape is `<triplet> / <alpha>`.
  // Handed over as a triplet it would drop the alpha and judge a colour the page
  // never paints, so it must not be offered at all — and a pair pointing at it has
  // to be left alone rather than warned about on the strength of a value that is
  // not what reaches the screen.
  const result = compile(
    { '--background': 'var(--nav-glass)', '--nav-glass': '0 0% 45% / 0.7' },
    { appearance: 'light' },
  );

  assert.ok(result.ok, 'the alpha form is a legal value, not a refusal');
  assert.match(result.css, /--nav-glass: 0 0% 45% \/ 0\.7;/, 'and it is in the stylesheet as written');
  assert.deepEqual(result.warnings, [], 'the check is given neither shape, so it has nothing to say');
});

test('a length or an editor expression is not read as a triplet either', () => {
  // The other half of the same rule: neither of these is a colour at all, and a
  // reader that looked for three numbers would still find them in some of them.
  const result = compile({ '--radius': '0.5rem', '--editor-background': 'hsl(var(--palette-ink-900))' });

  assert.ok(result.ok);
  assert.deepEqual(result.warnings, []);
});

test('a reference is handed over as a reference, not as the colour it points at', () => {
  // Telling the two shapes apart is the compiler's job; a flattened value would
  // leave the contrast check unable to follow the file's own indirection. The
  // background is a colour the base's `--foreground` passes on, so a check that
  // ignored the reference and used the base instead would report a different set.
  const result = compile(
    { '--foreground': 'var(--background)', '--background': '0 0% 80%' },
    { appearance: 'light' },
  );

  assert.ok(result.ok);
  assert.deepEqual(
    result.warnings.map(({ ink, surface }) => `${ink} on ${surface}`),
    [
      '--foreground on --background',
      '--foreground on --card',
      '--muted-foreground on --background',
    ],
  );
});

/**
 * §5.8 v8: the reference rule reaches the expression shape too (P2-2), and the
 * §5.12 lane knobs joined the authorization surface (P2-3).
 */

test('an expression value may only reference tokens the theme could have set', () => {
  // The expression shape is loose on purpose — it goes into EditorView.theme()
  // as a complete value — but looseness of shape is not looseness of contract:
  // a name the whitelist never authorized must not become a colour source.
  // A *numbered* slot, not `SYNTAX_TOKEN_MAP.keyword`: the named slots are part
  // of the contract now, so a reference to one points at a token the theme could
  // have set itself. What stays out of reach is the number, whose meaning moves
  // with the highlighter's own generator. The name is spelled in two pieces
  // because a literal `--cc-syntax-N` in this file would trip the scan that keeps
  // hand-written numbers out of the tree — the same rule this case leans on.
  const numberedSlot = `--cc-syntax-${3}`;
  const rejected = compile({
    '--editor-fg': `var(${numberedSlot})`,
    '--editor-bg': '#282c34',
  });
  assert.ok(rejected.ok);
  assert.deepEqual(ignoredNames(rejected), ['--editor-fg']);

  const geometry = compile({ '--editor-fg': 'var(--safe-area-top)', '--editor-bg': '#282c34' });
  assert.ok(geometry.ok);
  assert.deepEqual(ignoredNames(geometry), ['--editor-fg']);

  // The legal spellings are untouched: a complete value that borrows a themed
  // token — even embedded mid-value, not as the whole value — compiles.
  const accepted = compile({
    '--editor-fg': 'hsl(var(--palette-white))',
    '--editor-panel-border': '1px solid var(--primary)',
    '--editor-bg': '#282c34',
  });
  assert.ok(accepted.ok);
  assert.deepEqual(accepted.ignored, []);
  assert.match(accepted.css, /--editor-panel-border: 1px solid var\(--primary\);/);
});

test('every named syntax slot is one a theme may set', () => {
  // The whitelist's family pattern and the generator's names have to be one
  // spelling. A name falling outside the pattern would be *silently* unsettable
  // — no assertion would fail, the theme would just never move that colour — so
  // this walks the generator's own table instead of keeping a second list, which
  // is also what makes the pattern and `SYNTAX_SELECTORS` stay in step.
  const result = compile(
    Object.fromEntries(Object.values(SYNTAX_TOKEN_MAP).map((token) => [token, '#c678dd'])),
  );

  assert.ok(result.ok);
  assert.deepEqual(result.ignored, []);
  for (const token of Object.values(SYNTAX_TOKEN_MAP)) {
    assert.ok(result.css.includes(`${token}: #c678dd;`), `"${token}" did not reach the stylesheet`);
  }
});

test('a numbered syntax slot is not a token a theme may set', () => {
  // Spelled in two pieces for the same reason as above: this file may not carry
  // a hand-written `--cc-syntax-N` literal either.
  const numberedSlot = `--cc-syntax-${3}`;
  const result = compile({ [numberedSlot]: '#c678dd', '--primary': '175 84% 32%' });

  assert.ok(result.ok);
  assert.deepEqual(ignoredNames(result), [numberedSlot]);
});

test('the §5.12 lane knobs take the numbers the fallback formula is made of', () => {
  const accepted = compile({
    '--graph-lane-base-hue': '315.3',
    '--graph-lane-hue-step': '95.1',
    '--primary': '175 84% 32%',
  });
  assert.ok(accepted.ok);
  assert.equal(accepted.ignored.length, 0);
  assert.match(accepted.css, /--graph-lane-base-hue: 315\.3;/);
  assert.match(accepted.css, /--graph-lane-hue-step: 95\.1;/);

  // A hue is a plain number: a unit would ride into `hsl(calc(base + step * n))`
  // and silently unmake the colour, and a negative step is a name the rule never
  // promised — the factory pair is positive and the formula wraps by itself.
  const rejected = compile({
    '--graph-lane-base-hue': '10px',
    '--graph-lane-hue-step': '-5',
    '--primary': '175 84% 32%',
  });
  assert.ok(rejected.ok);
  assert.deepEqual(ignoredNames(rejected), ['--graph-lane-base-hue', '--graph-lane-hue-step']);
});
