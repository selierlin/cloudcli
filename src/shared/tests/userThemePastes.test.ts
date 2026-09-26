import assert from 'node:assert/strict';

import { beforeEach, test, vi } from 'vitest';

/**
 * The pasted half of the user themes: the list that lives in the user's
 * preferences rather than in the host's themes folder.
 *
 * Two things are pinned here that the rest of the theme code assumes. One is that
 * adding is *gated*: a pasted theme is the only kind that arrives through a text
 * box, so what it is allowed to contain has to be settled before it is stored —
 * the apply path has no user to explain a failure to. The other is that the list
 * is rebuilt from storage on every read, so a row that is not shaped like a theme
 * costs itself and not the list: these bytes come back from a mirror that a user
 * (or a newer version) can write.
 *
 * Each test loads a fresh module copy: the parsed list is cached per module.
 */

vi.mock('@/shared/api', () => ({
  api: { user: { savePreferences: async () => new Response('{}', { status: 200 }) } },
}));

const loadStores = async () => {
  vi.resetModules();
  const pastes = await import('@/shared/userThemePastes');
  const settings = await import('@/shared/userSettings');
  return { pastes, settings };
};

const themeJson = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  name: 'Deep sea',
  tokens: { '--primary': '175 84% 32%' },
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

test('a pasted theme is stored under a sequential id, with the name it declares', async () => {
  const { pastes, settings } = await loadStores();

  const result = pastes.addPastedTheme(themeJson({ coverage: 'accent' }));

  assert.ok(result.ok);
  assert.deepEqual(result.theme, {
    id: 'paste-1',
    name: 'Deep sea',
    coverage: 'accent',
    content: themeJson({ coverage: 'accent' }),
    format: 'json',
  });
  assert.deepEqual(pastes.getPastedThemes(), [result.theme]);
  assert.deepEqual(
    settings.readUserPreference('userThemePastes', null),
    [result.theme],
    'the list has to be in the preference store, which is what makes it follow the user',
  );
});

test('each paste gets the next id, and one that declares no name is shown as its id', async () => {
  const { pastes } = await loadStores();
  pastes.addPastedTheme(themeJson());

  const second = pastes.addPastedTheme(JSON.stringify({ tokens: { '--primary': '1 2% 3%' } }));

  assert.ok(second.ok);
  assert.equal(second.theme.id, 'paste-2');
  assert.equal(
    second.theme.name,
    'paste-2',
    'nothing is invented for a theme that declares no name — the id is what is known',
  );
  assert.deepEqual(pastes.getPastedThemes().map((theme) => theme.id), ['paste-1', 'paste-2']);
});

test('content the compiler refuses is not stored at all', async () => {
  const { pastes } = await loadStores();

  assert.deepEqual(pastes.addPastedTheme('not json'), { ok: false, reason: 'unreadable-json' });
  assert.deepEqual(
    pastes.addPastedTheme(JSON.stringify({ tokens: { '--safe-area-inset-top': '0px' } })),
    { ok: false, reason: 'nothing-usable' },
    'a body whose every token is dropped would produce an overlay that declares nothing',
  );
  assert.deepEqual(pastes.addPastedTheme(JSON.stringify({ tokens: {} })), {
    ok: false,
    reason: 'no-tokens',
  });
  assert.deepEqual(pastes.getPastedThemes(), [], 'a refused paste must leave no trace');
});

test('a paste that is stored but cannot be read comes back with its warning', async () => {
  const { pastes } = await loadStores();

  const added = pastes.addPastedTheme(themeJson());

  assert.ok(added.ok, '§5.10 asks for a warning, so the paste is kept');
  assert.deepEqual(
    added.warnings.map(({ appearance, ink, surface }) => `${appearance} ${ink} on ${surface}`),
    ['light --primary-foreground on --primary'],
    'the paste box is the only moment its author is looking at anything, so the warning travels back with the entry',
  );
  assert.equal(pastes.getPastedThemes().length, 1, 'and it was added all the same');
});

test('content over the size cap is refused before anything else is looked at', async () => {
  const { pastes } = await loadStores();
  // Padded with an unknown key rather than a huge token value: the cap has to be
  // what refuses this, not a token rule happening to drop the padding first.
  const oversized = JSON.stringify({
    tokens: { '--primary': '175 84% 32%' },
    padding: 'x'.repeat(256 * 1024),
  });

  assert.deepEqual(pastes.addPastedTheme(oversized), { ok: false, reason: 'too-large' });
  assert.deepEqual(pastes.getPastedThemes(), [], 'and nothing is stored');
});

test('the size cap lives in the compile step, so a preview cannot show content a paste would refuse', async () => {
  const { pastes } = await loadStores();
  const oversizedJson = JSON.stringify({
    tokens: { '--primary': '175 84% 32%' },
    padding: 'x'.repeat(256 * 1024),
  });
  const oversizedSheet = `:root { --a: 1; }\n${'x'.repeat(256 * 1024)}`;

  assert.deepEqual(
    pastes.compilePastedTheme({ id: 'paste-1', name: '', content: oversizedJson, format: 'json' }),
    { ok: false, reason: 'too-large', ignored: [] },
    'the settings page compiles a draft through this function before anything is stored, so the cap has to be here',
  );
  assert.deepEqual(
    pastes.compilePastedTheme({ id: 'paste-1', name: '', content: oversizedSheet, format: 'css' }),
    { ok: false, reason: 'too-large', ignored: [] },
    'and it holds for both formats, since both are compiled by the same call',
  );
});

test('a value that tried to leave its declaration refuses the paste', async () => {
  const { pastes } = await loadStores();

  const result = pastes.addPastedTheme(JSON.stringify({
    tokens: { '--background': '0 0% 0% } body { display: none' },
  }));

  assert.deepEqual(result, { ok: false, reason: 'unsafe-value' });
  assert.deepEqual(pastes.getPastedThemes(), []);
});

test('an unknown coverage is dropped while the theme itself is kept', async () => {
  const { pastes } = await loadStores();

  const added = pastes.addPastedTheme(themeJson({ coverage: 'partial' }));

  assert.ok(added.ok);
  assert.equal(added.theme.coverage, undefined, 'a reach this build does not know is not stored');
  assert.equal(pastes.getPastedThemes().length, 1, 'losing the theme over it would be the wrong trade');
});

test('removing a theme also clears a pick that named it', async () => {
  const { pastes, settings } = await loadStores();
  const added = pastes.addPastedTheme(themeJson());
  assert.ok(added.ok);
  settings.writeUserPreference('themeId', added.theme.id);

  pastes.removePastedTheme(added.theme.id);

  assert.deepEqual(pastes.getPastedThemes(), []);
  assert.equal(
    settings.readUserPreference('themeId', 'unset'),
    'unset',
    'the pick would otherwise survive as a dangling id and be reported as a missing theme',
  );
});

test('removing a theme leaves a pick that named a different one alone', async () => {
  const { pastes, settings } = await loadStores();
  pastes.addPastedTheme(themeJson());
  const second = pastes.addPastedTheme(themeJson({ name: 'Other' }));
  assert.ok(second.ok);
  settings.writeUserPreference('themeId', second.theme.id);

  pastes.removePastedTheme('paste-1');

  assert.equal(settings.readUserPreference<string | null>('themeId', null), 'paste-2');
});

test('removing an id that is not there changes nothing', async () => {
  const { pastes, settings } = await loadStores();
  pastes.addPastedTheme(themeJson());
  settings.writeUserPreference('themeId', 'paste-1');

  pastes.removePastedTheme('paste-9');

  assert.equal(pastes.getPastedThemes().length, 1);
  assert.equal(settings.readUserPreference<string | null>('themeId', null), 'paste-1');
});

test('a row that is not shaped like a pasted theme is dropped, not the list', async () => {
  const { pastes, settings } = await loadStores();
  settings.writeUserPreference('userThemePastes', [
    { id: 'paste-1', name: 'Kept', content: themeJson() },
    { id: 'user-borealis', name: 'Wrong prefix', content: themeJson() },
    { id: 'paste-2', name: '', content: themeJson() },
    { id: 'paste-3', name: 'No content' },
    'not an object',
    null,
  ]);

  assert.deepEqual(
    pastes.getPastedThemes().map((theme) => theme.id),
    ['paste-1'],
    'only the row that is a pasted theme survives; the rest cost themselves',
  );
});

test('a stored row keeps an unknown coverage out but keeps the row', async () => {
  const { pastes, settings } = await loadStores();
  settings.writeUserPreference('userThemePastes', [
    { id: 'paste-1', name: 'Kept', content: themeJson(), coverage: 'partial' },
  ]);

  const [theme] = pastes.getPastedThemes();
  assert.equal(theme?.name, 'Kept');
  assert.equal(theme?.coverage, undefined);
});

test('the list keeps its identity between reads so it can seed React state', async () => {
  const { pastes } = await loadStores();
  pastes.addPastedTheme(themeJson());

  const first = pastes.getPastedThemes();
  assert.equal(pastes.getPastedThemes(), first, 'a fresh array per read would re-render on every preference change');

  pastes.addPastedTheme(themeJson({ name: 'Other' }));
  assert.notEqual(pastes.getPastedThemes(), first, 'and a change does have to be visible as one');
});

/**
 * The css half of the paste line (§5.5 v5, §5.8 v6).
 *
 * A stylesheet is not compiled, so what is worth pinning is that it is stored
 * exactly as typed — and that the one gate a block of declarations cannot need
 * still applies to it, because a paste has no server in front of it.
 */

const CSS_THEME = ':root { --primary: 175 84% 32%; }';

test('a css paste is stored as it stands, shown under its id because a sheet declares no name', async () => {
  const { pastes } = await loadStores();

  const added = pastes.addPastedTheme(CSS_THEME, 'css');

  assert.ok(added.ok);
  assert.deepEqual(added.theme, {
    id: 'paste-1',
    name: 'paste-1',
    content: CSS_THEME,
    format: 'css',
  });
  assert.deepEqual(
    pastes.compilePastedTheme(added.theme),
    { ok: true, css: CSS_THEME, ignored: [], warnings: [] },
    'compiling a css entry is the identity: the sheet is injected as it stands, not mapped to tokens',
  );
  assert.deepEqual(
    added.warnings,
    [],
    'and §5.10\'s token-level warning has nothing to say about a stylesheet, which is not a token map',
  );
});

test('an @import anywhere in a pasted stylesheet refuses it', async () => {
  const { pastes } = await loadStores();
  const withTrailingImport = `${CSS_THEME}\n@import url("https://example.invalid/x.css");`;

  assert.deepEqual(
    pastes.addPastedTheme(withTrailingImport, 'css'),
    { ok: false, reason: 'import-rule' },
    'the gate is not a prefix check — the rule can sit anywhere in the text',
  );
  assert.deepEqual(pastes.getPastedThemes(), [], 'a refused paste must leave no trace');
});

test('the @import gate belongs to the stylesheet format, not to every paste', async () => {
  const { pastes } = await loadStores();

  // In option A the same text cannot reach the document at all: `@` is one of the
  // characters the structural gate refuses, so the whole file is refused. A
  // different verdict on purpose — the two formats have different escape routes.
  assert.deepEqual(
    pastes.addPastedTheme(JSON.stringify({ tokens: { '--primary': '@import url(x)' } }), 'json'),
    { ok: false, reason: 'unsafe-value' },
  );
});

test('an entry stored before formats existed is read as option A, which is the only thing it can be', async () => {
  const { pastes, settings } = await loadStores();
  settings.writeUserPreference('userThemePastes', [
    { id: 'paste-1', name: 'Kept', content: themeJson() },
  ]);

  const [theme] = pastes.getPastedThemes();

  assert.equal(theme?.format, 'json', 'only this format was ever written without one');
  assert.ok(
    theme && pastes.compilePastedTheme(theme).ok,
    'and the entry it was written as is still the entry it is read as',
  );
});

test('a stored entry claiming a format this build cannot compile costs itself, not the list', async () => {
  const { pastes, settings } = await loadStores();
  settings.writeUserPreference('userThemePastes', [
    { id: 'paste-1', name: 'Kept', content: themeJson() },
    { id: 'paste-2', name: 'From a newer build', content: CSS_THEME, format: 'scss' },
  ]);

  assert.deepEqual(
    pastes.getPastedThemes().map((theme) => theme.id),
    ['paste-1'],
    'there would be nothing to compile that row with, which is the rule `readEntry` uses for a file too',
  );
});

test('a css paste that happens to read as JSON still declares no metadata', async () => {
  const { pastes } = await loadStores();
  // Option A's keys belong to option A. A stylesheet has nowhere to declare a
  // name or a reach (§5.8 v5), so this text is a stylesheet that declares
  // nothing — not a theme that named itself on the way in.
  const jsonShaped = JSON.stringify({
    name: 'Deep sea',
    coverage: 'accent',
    tokens: { '--primary': '175 84% 32%' },
  });

  const added = pastes.addPastedTheme(jsonShaped, 'css');

  assert.ok(added.ok);
  assert.equal(added.theme.name, 'paste-1');
  assert.equal(added.theme.coverage, undefined);
  assert.equal(added.theme.format, 'css');
});
