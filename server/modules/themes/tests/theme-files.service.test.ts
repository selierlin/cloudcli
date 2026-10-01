import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isSafeThemeFileName,
  readThemeFile,
  resolveThemeFilePath,
  scanThemeFiles,
  themeFileBase,
  themeFileFormat,
} from '@/modules/themes/services/theme-files.service.js';

/** Creates a scratch themes folder; a test writes only the files it needs. */
function scratchThemesDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cloudcli-themes-'));
}

function writeTheme(themesDir: string, fileName: string, content: string): Promise<void> {
  return fs.writeFile(path.join(themesDir, fileName), content, 'utf8');
}

test('themeFileFormat maps the three accepted extensions and rejects the rest', () => {
  assert.equal(themeFileFormat('dracula.css'), 'css');
  assert.equal(themeFileFormat('nord.json'), 'json');
  assert.equal(themeFileFormat('Solarized.tmTheme'), 'tmTheme');
  // Extension matching is case-insensitive so the canonical camel-case
  // spelling is not the only one that works.
  assert.equal(themeFileFormat('solarized.TMTHEME'), 'tmTheme');
  assert.equal(themeFileFormat('UPPER.CSS'), 'css');
  assert.equal(themeFileFormat('notes.txt'), null);
  assert.equal(themeFileFormat('noextension'), null);
  assert.equal(themeFileFormat('archive.css.bak'), null);
});

test('themeFileBase strips only the final extension', () => {
  assert.equal(themeFileBase('dracula.css'), 'dracula');
  assert.equal(themeFileBase('my.theme.json'), 'my.theme');
  assert.equal(themeFileBase('Solarized.tmTheme'), 'Solarized');
});

test('isSafeThemeFileName accepts theme files and rejects traversal shapes', () => {
  assert.equal(isSafeThemeFileName('dracula.css'), true);
  assert.equal(isSafeThemeFileName('my-theme.v2.json'), true);
  assert.equal(isSafeThemeFileName('Nord.tmTheme'), true);

  // Traversal and separators.
  assert.equal(isSafeThemeFileName('../dracula.css'), false);
  assert.equal(isSafeThemeFileName('sub/dracula.css'), false);
  assert.equal(isSafeThemeFileName('sub\\dracula.css'), false);
  assert.equal(isSafeThemeFileName('a..b.css'), false);
  assert.equal(isSafeThemeFileName('..'), false);

  // Characters that would break the `[data-theme="…"]` selector the id lands in.
  assert.equal(isSafeThemeFileName('dra"cula.css'), false);
  assert.equal(isSafeThemeFileName('dracula[1].css'), false);
  assert.equal(isSafeThemeFileName('dra cula.css'), false);
  // Dotfiles are refused by the leading-character rule.
  assert.equal(isSafeThemeFileName('.hidden.css'), false);

  // Extension gate and empty input.
  assert.equal(isSafeThemeFileName('dracula.txt'), false);
  assert.equal(isSafeThemeFileName(''), false);
  assert.equal(isSafeThemeFileName('   '), false);
});

test('resolveThemeFilePath resolves a plain name and refuses escapes', () => {
  const themesDir = path.join(os.tmpdir(), 'cloudcli-themes-resolve');
  const resolved = resolveThemeFilePath(themesDir, 'dracula.css');
  assert.equal(resolved, path.join(path.resolve(themesDir), 'dracula.css'));

  assert.equal(resolveThemeFilePath(themesDir, '../auth.db'), null);
  assert.equal(resolveThemeFilePath(themesDir, 'nested/dracula.css'), null);
  assert.equal(resolveThemeFilePath(themesDir, 'dracula.txt'), null);
  assert.equal(resolveThemeFilePath(themesDir, ''), null);
});

test('scanThemeFiles returns an empty list when the folder does not exist', async () => {
  const themesDir = path.join(os.tmpdir(), `cloudcli-themes-missing-${Date.now()}`);
  assert.deepEqual(await scanThemeFiles(themesDir), []);
});

test('scanThemeFiles lists the accepted formats and skips everything else', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'dracula.css', '[data-theme="user-dracula"] { --primary: 1 2% 3%; }');
  await writeTheme(themesDir, 'borealis.json', '{"name":"Borealis","tokens":{}}');
  await writeTheme(themesDir, 'Solarized.tmTheme', '<plist><dict></dict></plist>');
  // Wrong extension, oversized, `@import`, and a directory: all refused.
  await writeTheme(themesDir, 'notes.txt', 'not a theme');
  await writeTheme(themesDir, 'huge.css', `/* ${'x'.repeat(256 * 1024)} */`);
  await writeTheme(themesDir, 'importer.css', '@import url("https://example.com/x.css");');
  await fs.mkdir(path.join(themesDir, 'nested.css'));

  const entries = await scanThemeFiles(themesDir);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['user-borealis', 'user-dracula', 'user-solarized'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.format),
    ['json', 'css', 'tmTheme'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.fileName),
    ['borealis.json', 'dracula.css', 'Solarized.tmTheme'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.source),
    ['user', 'user', 'user'],
  );
  assert.deepEqual(
    entries.map((entry) => entry.appearance),
    ['system', 'system', 'system'],
  );
  // The display name keeps the filename's casing; only the id is lowercased.
  assert.equal(entries[2].name, 'Solarized');
  assert.ok(entries.every((entry) => entry.modifiedAt > 0));
});

/** Captures `console.warn` for the length of `run`, restoring it afterwards. */
async function warningsFrom(run: () => Promise<void>): Promise<string[]> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('a theme file\u2019s own name and coverage are read into its entry', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(
    themesDir,
    'deep-sea.json',
    '{"name":"深海","coverage":"full","tokens":{"--primary":"175 84% 32%"}}',
  );
  await writeTheme(themesDir, 'accent.json', '{"coverage":"accent"}');
  await writeTheme(themesDir, 'plain.css', '[data-theme="user-plain"] { --primary: 1 2% 3%; }');

  const byId = new Map((await scanThemeFiles(themesDir)).map((entry) => [entry.id, entry]));

  assert.equal(byId.get('user-deep-sea')?.name, '深海', 'the declared name wins over the filename');
  assert.equal(byId.get('user-deep-sea')?.coverage, 'full');
  assert.equal(byId.get('user-accent')?.coverage, 'accent');
  assert.equal(byId.get('user-accent')?.name, 'accent', 'an undeclared name falls back to the filename base');
  assert.equal(byId.get('user-plain')?.coverage, undefined, 'a stylesheet has nowhere to declare a reach');
  // `appearance` is not read here: in a file it scopes the overlay's rules, which
  // is the compiler\u2019s business, while this field is the overlay role itself.
  assert.equal(byId.get('user-deep-sea')?.appearance, 'system');
});

test('a .json theme that cannot be read is still listed, and the reason is reported', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'broken.json', '{"name": "unterminated');
  await writeTheme(themesDir, 'odd.json', '{"name":"","coverage":"partial"}');
  await writeTheme(themesDir, 'long.json', JSON.stringify({ name: 'x'.repeat(81) }));

  let entries: Awaited<ReturnType<typeof scanThemeFiles>> = [];
  const warnings = await warningsFrom(async () => {
    entries = await scanThemeFiles(themesDir);
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  // The client is the side that can tell the user why a file will not compile,
  // so a file the listing cannot read is listed rather than hidden.
  assert.equal(byId.get('user-broken')?.name, 'broken');
  assert.equal(byId.get('user-odd')?.name, 'odd', 'an empty name is not a name');
  assert.equal(byId.get('user-odd')?.coverage, undefined);
  assert.equal(byId.get('user-long')?.name, 'long', 'a name past the cap falls back to the filename');

  assert.ok(
    warnings.some((warning) => warning.includes('broken.json') && warning.includes('not readable JSON')),
    `unreadable JSON has to name the file (saw: ${warnings.join(' | ')})`,
  );
  assert.ok(
    warnings.some((warning) => warning.includes('odd.json') && warning.includes('unknown coverage')),
    'a reach we drop has to be said out loud',
  );
});

test('a .tmTheme may claim a coverage through its cloudcli key, held to the same two words', async () => {
  const themesDir = await scratchThemesDir();
  const theme = (coverage?: string) =>
    [
      '<plist version="1.0"><dict>',
      '<key>name</key><string>Nord Night</string>',
      coverage === undefined ? '' : `<key>cloudcli</key><dict><key>coverage</key><string>${coverage}</string></dict>`,
      '<key>settings</key><array><dict><key>settings</key><dict>',
      '<key>foreground</key><string>#f8f8f2</string>',
      '</dict></dict></array>',
      '</dict></plist>',
    ].join('');

  await writeTheme(themesDir, 'Nord.tmTheme', theme('full'));
  await writeTheme(themesDir, 'partial.tmTheme', theme('accent'));
  await writeTheme(themesDir, 'bare.tmTheme', theme());
  await writeTheme(themesDir, 'odd.tmTheme', theme('everything'));

  let entries: Awaited<ReturnType<typeof scanThemeFiles>> = [];
  const warnings = await warningsFrom(async () => {
    entries = await scanThemeFiles(themesDir);
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  // The claim is read at the same trust level as a `.json`'s: the author says
  // what the file reaches, and the badge repeats it without checking the work.
  assert.equal(byId.get('user-nord')?.coverage, 'full');
  assert.equal(byId.get('user-partial')?.coverage, 'accent');
  assert.equal(byId.get('user-bare')?.coverage, undefined, 'no claim, no badge');
  assert.equal(byId.get('user-odd')?.coverage, undefined);
  assert.ok(
    warnings.some((warning) => warning.includes('odd.tmTheme') && warning.includes('unknown coverage')),
    `a reach we drop has to be said out loud (saw: ${warnings.join(' | ')})`,
  );
  // The plist's own top-level `name` is read alongside the claim, at the same
  // trust level — so the declared label wins even when it is not the filename.
  assert.equal(byId.get('user-nord')?.name, 'Nord Night');
  assert.equal(byId.get('user-bare')?.name, 'Nord Night');
});

test('a .tmTheme\u2019s declared name labels the picker, read only from the top level', async () => {
  const themesDir = await scratchThemesDir();
  // `shellVariables` entries legitimately carry a nested `name`; the scan's
  // depth tracking must not mistake one for the theme's own label. The nested
  // entry is written *before* the top-level name on purpose — a scan without
  // the depth gate would take it first and never notice.
  await writeTheme(
    themesDir,
    'nord.tmTheme',
    [
      '<plist version="1.0"><dict>',
      '<key>shellVariables</key><array><dict>',
      '<key>name</key><string>TM_COMMENT_START</string>',
      '<key>value</key><string># </string>',
      '</dict></array>',
      '<key>name</key><string>Nord</string>',
      '<key>settings</key><array><dict><key>settings</key><dict>',
      '<key>foreground</key><string>#f8f8f2</string>',
      '</dict></dict></array>',
      '</dict></plist>',
    ].join(''),
  );
  await writeTheme(
    themesDir,
    'long.tmTheme',
    `<plist><dict><key>name</key><string>${'x'.repeat(81)}</string></dict></plist>`,
  );
  await writeTheme(themesDir, 'empty.tmTheme', '<plist><dict><key>name</key><string>  </string></dict></plist>');
  await writeTheme(
    themesDir,
    'anon.tmTheme',
    '<plist><dict><key>settings</key><array><dict><key>settings</key>'
      + '<dict><key>foreground</key><string>#fff</string></dict></dict></array></dict></plist>',
  );
  // The `cloudcli` claim is read alongside the name, wherever the two keys sit.
  await writeTheme(
    themesDir,
    'claim.tmTheme',
    '<plist><dict><key>name</key><string>Claimed</string>'
      + '<key>cloudcli</key><dict><key>coverage</key><string>accent</string>'
      + '<key>tokens</key><dict><key>--primary</key><string>1 2% 3%</string></dict></dict>'
      + '<key>settings</key><array><dict><key>settings</key>'
      + '<dict><key>foreground</key><string>#fff</string></dict></dict></array></dict></plist>',
  );

  const byId = new Map((await scanThemeFiles(themesDir)).map((entry) => [entry.id, entry]));

  assert.equal(byId.get('user-nord')?.name, 'Nord', 'the declared name wins over the filename casing');
  assert.notEqual(
    byId.get('user-nord')?.name,
    'TM_COMMENT_START',
    'a nested name key is not the theme\u2019s own label',
  );
  assert.equal(byId.get('user-long')?.name, 'long', 'a name past the cap falls back to the filename');
  assert.equal(byId.get('user-empty')?.name, 'empty', 'an empty name is not a name');
  assert.equal(byId.get('user-anon')?.name, 'anon', 'no declared name, the filename base labels it');
  assert.equal(byId.get('user-claim')?.name, 'Claimed');
  assert.equal(byId.get('user-claim')?.coverage, 'accent', 'the cloudcli claim is read alongside the name');
});

test('scanThemeFiles de-duplicates files whose base names collide', async () => {
  const themesDir = await scratchThemesDir();
  // Same base, different extension: both would resolve to id `user-nord`.
  await writeTheme(themesDir, 'Nord.tmTheme', '<plist><dict></dict></plist>');
  await writeTheme(themesDir, 'nord.css', '[data-theme="user-nord"] { --primary: 1 2% 3%; }');

  const entries = await scanThemeFiles(themesDir);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'user-nord');
  // Filenames are visited in case-insensitive sort order, so the winner is
  // deterministic and is the `.css` file — the format that covers the whole UI
  // rather than only syntax, terminal and editor.
  assert.equal(entries[0].fileName, 'nord.css');
});

test('readThemeFile returns content with a per-format content type', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'dracula.css', '[data-theme="user-dracula"] { --primary: 1 2% 3%; }');
  await writeTheme(themesDir, 'borealis.json', '{"name":"Borealis"}');
  await writeTheme(themesDir, 'Solarized.tmTheme', '<plist><dict></dict></plist>');

  const css = await readThemeFile(themesDir, 'dracula.css');
  assert.equal(css.status, 'found');
  assert.equal(css.contentType, 'text/css; charset=utf-8');
  assert.match(css.content.toString('utf8'), /--primary/);

  const json = await readThemeFile(themesDir, 'borealis.json');
  assert.equal(json.status, 'found');
  assert.equal(json.contentType, 'application/json; charset=utf-8');

  const tmTheme = await readThemeFile(themesDir, 'Solarized.tmTheme');
  assert.equal(tmTheme.status, 'found');
  assert.equal(tmTheme.contentType, 'application/xml; charset=utf-8');
});

test('readThemeFile refuses unsafe names, missing files and rejected content', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'importer.css', '@import url("https://example.com/x.css");');
  await writeTheme(themesDir, 'huge.css', `/* ${'x'.repeat(256 * 1024)} */`);

  assert.equal((await readThemeFile(themesDir, '../auth.db')).status, 'invalid');
  assert.equal((await readThemeFile(themesDir, 'notes.txt')).status, 'invalid');
  assert.equal((await readThemeFile(themesDir, 'importer.css')).status, 'invalid');
  assert.equal((await readThemeFile(themesDir, 'huge.css')).status, 'invalid');
  assert.equal((await readThemeFile(themesDir, 'absent.css')).status, 'missing');
});

test('the import gate catches the escaped spellings a literal regex cannot see', async () => {
  // `@im\70 ort` and friends are CSSImportRules in a real engine: the tokenizer
  // decodes the ident escapes before any rule exists. A literal /@import/i saw
  // none of them (§5.8 v8); the shared scanner has to refuse every form the
  // client's paste gate refuses, which is what the shared vector list pins.
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'escaped.css', '@im\\70 ort url(https://evil.example/x.css);');
  await writeTheme(themesDir, 'initial.css', '@\\69 mport "x.css";');
  await writeTheme(themesDir, 'clean.css', 'a { color: red }');

  const entries = await scanThemeFiles(themesDir);
  assert.deepEqual(entries.map((entry) => entry.fileName), ['clean.css']);

  const served = await readThemeFile(themesDir, 'escaped.css');
  assert.equal(served.status, 'invalid', 'the serving route re-applies the gate');
  assert.equal((await readThemeFile(themesDir, 'clean.css')).status, 'found');
});

test('a symlink inside the themes folder is followed; one that leaves it is not', async () => {
  const themesDir = await scratchThemesDir();
  const elsewhere = await scratchThemesDir();

  await writeTheme(themesDir, 'clean.css', 'a { color: red }');
  // Points at a sibling *inside* the folder: the current behaviour is to
  // follow it, and this test is what makes a future change to that answer red.
  await fs.symlink(path.join(themesDir, 'clean.css'), path.join(themesDir, 'alias.css'));
  // Points outside: whatever the lexical check sees, the canonical path is not
  // the folder's, and serving it would be a way around the folder boundary.
  await writeTheme(elsewhere, 'secret.css', 'body { display: none }');
  await fs.symlink(path.join(elsewhere, 'secret.css'), path.join(themesDir, 'leak.css'));

  const listed = (await scanThemeFiles(themesDir)).map((entry) => entry.fileName);
  assert.ok(listed.includes('alias.css'), 'a contained symlink is a theme like any other');
  assert.equal(listed.includes('leak.css'), false, 'an escaping symlink is refused');

  const served = await readThemeFile(themesDir, 'leak.css');
  assert.equal(served.status, 'invalid', 'the serving route holds the same line');
  assert.equal((await readThemeFile(themesDir, 'alias.css')).status, 'found');
});

test('index.json labels the themes and is itself never listed', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'tui.css', '[data-theme="user-tui"] { --primary: 1 2% 3%; }');
  await writeTheme(themesDir, 'plain.css', '[data-theme="user-plain"] { --primary: 1 2% 3%; }');
  await writeTheme(
    themesDir,
    'index.json',
    JSON.stringify({
      // The key is matched case-insensitively against the filename base.
      TUI: {
        name: { zh: '字符终端', en: 'TUI' },
        author: 'selier',
        inspiredBy: 'https://github.com/refact0r/system24',
      },
      'no-such-theme': { name: { zh: '幽灵' } },
    }),
  );

  let entries: Awaited<ReturnType<typeof scanThemeFiles>> = [];
  const warnings = await warningsFrom(async () => {
    entries = await scanThemeFiles(themesDir);
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  assert.deepEqual(entries.map((entry) => entry.id), ['user-plain', 'user-tui'],
    'the metadata file is not a theme and never reaches the listing');
  const labeled = byId.get('user-tui');
  assert.deepEqual(labeled?.displayName, { zh: '字符终端', en: 'TUI' });
  assert.equal(labeled?.author, 'selier');
  assert.equal(labeled?.inspiredBy, 'https://github.com/refact0r/system24');
  // `name` stays the file-derived one: the resolver's manifest does not wear
  // the localized label.
  assert.equal(labeled?.name, 'tui');
  // A key with no matching theme is simply nothing — themes come and go.
  assert.equal(byId.get('user-no-such-theme'), undefined);
  assert.equal(warnings.some((warning) => warning.includes('no-such-theme')), false,
    'an entry for an absent theme is not a problem to report');
  // Without metadata, every optional field is absent rather than fabricated.
  assert.equal(byId.get('user-plain')?.displayName, undefined);
  assert.equal(byId.get('user-plain')?.author, undefined);
  assert.equal(byId.get('user-plain')?.inspiredBy, undefined);
});

test('a broken index.json costs the labels, not the listing', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'tui.css', '[data-theme="user-tui"] { --primary: 1 2% 3%; }');
  await writeTheme(themesDir, 'index.json', '{ "tui": unterminated');

  const brokenDir = await scratchThemesDir();
  await writeTheme(brokenDir, 'tui.css', '[data-theme="user-tui"] { --primary: 1 2% 3%; }');
  await writeTheme(brokenDir, 'index.json', '["an", "array"]');

  let entries: Awaited<ReturnType<typeof scanThemeFiles>> = [];
  const warnings = await warningsFrom(async () => {
    entries = await scanThemeFiles(themesDir);
  });
  const arrayEntries = await scanThemeFiles(brokenDir);

  assert.deepEqual(entries.map((entry) => entry.id), ['user-tui'],
    'the theme survives its metadata file');
  assert.equal(entries[0].displayName, undefined);
  assert.ok(
    warnings.some((warning) => warning.includes('index.json') && warning.includes('not readable JSON')),
    `the reason is said out loud (saw: ${warnings.join(' | ')})`,
  );
  assert.deepEqual(arrayEntries.map((entry) => entry.id), ['user-tui'],
    'a non-object root is the same broken-metadata state');
});

test('index.json drops malformed and oversized values without sinking the entry', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'tui.css', '[data-theme="user-tui"] { --primary: 1 2% 3%; }');
  await writeTheme(themesDir, 'odd.css', '[data-theme="user-odd"] { --primary: 1 2% 3%; }');
  await writeTheme(
    themesDir,
    'index.json',
    JSON.stringify({
      tui: {
        name: { zh: '好名字', en: 'x'.repeat(81) },
        author: 'x'.repeat(81),
        inspiredBy: 'x'.repeat(301),
      },
      odd: 'not an object',
    }),
  );

  let entries: Awaited<ReturnType<typeof scanThemeFiles>> = [];
  const warnings = await warningsFrom(async () => {
    entries = await scanThemeFiles(themesDir);
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  const labeled = byId.get('user-tui');
  assert.deepEqual(labeled?.displayName, { zh: '好名字' },
    'an over-long language is dropped, the one that fits stays');
  assert.equal(labeled?.author, undefined, 'an over-long author is dropped');
  assert.equal(labeled?.inspiredBy, undefined, 'an over-long inspiredBy is dropped');
  assert.equal(byId.get('user-odd')?.displayName, undefined);
  assert.ok(
    warnings.some((warning) => warning.includes('odd') && warning.includes('not an object')),
    `a malformed entry is named (saw: ${warnings.join(' | ')})`,
  );
});

test('index.json is refused by the serving route like any non-theme', async () => {
  const themesDir = await scratchThemesDir();
  await writeTheme(themesDir, 'index.json', '{ "tui": {} }');

  assert.equal((await readThemeFile(themesDir, 'index.json')).status, 'invalid');
});
