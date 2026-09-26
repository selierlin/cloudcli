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
      '<key>name</key><string>Nord</string>',
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
  // `coverage` is the only key this channel reads from a `.tmTheme`: the plist's
  // own `name` is not this channel's to read, so the filename base labels it.
  assert.equal(byId.get('user-nord')?.name, 'Nord');
  assert.equal(byId.get('user-bare')?.name, 'bare');
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
