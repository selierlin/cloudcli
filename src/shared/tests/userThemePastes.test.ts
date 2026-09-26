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
