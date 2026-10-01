import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The listing of `~/.cloudcli/themes`, as the picker and the theme resolver
 * read it. Two things matter beyond "it fetches": a failure has to be reported
 * rather than swallowed, because with no listing a stored user theme simply
 * does not come back; and an id without the §5.8 prefix must never be taken for
 * a theme file, because the resolver treats that prefix as the only thing the
 * listing is authoritative about.
 *
 * Each test loads a fresh module copy: the store is a module-level singleton,
 * and `status` only advances once per session by design.
 */

type ListingCall = () => Promise<Response>;

let listing: ListingCall = async () => new Response('{}', { status: 200 });
let requests = 0;

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      list: () => {
        requests += 1;
        return listing();
      },
    },
    user: { savePreferences: async () => new Response('{}', { status: 200 }) },
  },
}));

const loadStore = async () => {
  vi.resetModules();
  return import('@/shared/userThemes');
};

/** A token of the right shape with an unreadable payload, which reads as "present, not expired". */
const signIn = (): void => {
  localStorage.setItem('auth-token', 'header.payload.signature');
};

const listingOf = (themes: unknown[]): ListingCall =>
  async () => new Response(JSON.stringify({ themes }), { status: 200 });

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-borealis',
  name: 'Borealis',
  fileName: 'borealis.css',
  format: 'css',
  modifiedAt: 1000,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  requests = 0;
  listing = listingOf([]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('without a session the listing is not asked for at all', async () => {
  const store = await loadStore();

  await store.refreshUserThemes();

  assert.equal(requests, 0, 'the endpoint is authenticated, so an anonymous call is a guaranteed 401');
  assert.deepEqual(store.getUserThemesState(), { entries: [], status: 'idle' });
});

test('a listing is published as ready and made available to the resolver', async () => {
  signIn();
  listing = listingOf([entry()]);
  const store = await loadStore();

  const seen: unknown[] = [];
  const unsubscribe = store.subscribeToUserThemes(() => seen.push(store.getUserThemesState()));

  await store.refreshUserThemes();

  assert.deepEqual(store.getUserThemesState(), {
    entries: [
      { id: 'user-borealis', name: 'Borealis', fileName: 'borealis.css', format: 'css', modifiedAt: 1000 },
    ],
    status: 'ready',
  });
  assert.deepEqual(
    seen.map((state) => (state as { status: string }).status),
    ['loading', 'ready'],
    'the in-flight state has to be reachable, or a pick cannot be told apart from a missing theme',
  );

  unsubscribe();
  await store.refreshUserThemes();
  assert.equal(requests, 1, 'a listing already read this session is not read again');
});

test('entries that could not have come from the themes folder are dropped', async () => {
  signIn();
  listing = listingOf([
    entry(),
    // A built-in id, which by convention is never derived from a file.
    entry({ id: 'cc-ocean' }),
    // Wrong shapes: the id ends up in a selector and the filename in a path.
    entry({ id: 'user-missing-name', name: undefined }),
    entry({ id: 'user-unknown-format', format: 'scss', fileName: 'x.scss' }),
    entry({ id: 'user-bad-mtime', modifiedAt: 'yesterday' }),
    'not an entry',
  ]);
  const store = await loadStore();

  await store.refreshUserThemes();

  assert.deepEqual(
    store.getUserThemesState().entries.map((theme) => theme.id),
    ['user-borealis'],
    'only an entry that names a user theme file may reach the resolver',
  );
});

test('a declared reach is carried, and one this build does not know costs only the badge', async () => {  signIn();
  listing = listingOf([
    entry({ id: 'user-accent', coverage: 'accent' }),
    entry({ id: 'user-full', coverage: 'full' }),
    entry({ id: 'user-undeclared' }),
    // A reach the server knows and this bundle does not. It only decides
    // whether a badge is drawn, so the entry has to survive it — dropping a
    // working theme over an unrecognised label would be the wrong trade.
    entry({ id: 'user-future', coverage: 'partial' }),
  ]);
  const store = await loadStore();

  await store.refreshUserThemes();

  assert.deepEqual(
    store.getUserThemesState().entries.map(({ id, coverage }) => [id, coverage]),
    [
      ['user-accent', 'accent'],
      ['user-full', 'full'],
      ['user-undeclared', undefined],
      ['user-future', undefined],
    ],
  );
});

test('an mtime that is not a finite number is dropped', async () => {
  signIn();
  // `1e999` is legal JSON and parses to `Infinity`, which `JSON.stringify`
  // would have flattened to `null` — so this body is written out by hand.
  listing = async () => new Response(
    '{"themes":[{"id":"user-inf","name":"Inf","fileName":"inf.css","format":"css","modifiedAt":1e999}]}',
    { status: 200 },
  );
  const store = await loadStore();

  await store.refreshUserThemes();

  assert.deepEqual(
    store.getUserThemesState().entries,
    [],
    'a modifiedAt that cannot be compared is not a revision the cache can key on',
  );
});

test('a request that fails is reported as an error and keeps the state honest', async () => {
  signIn();
  listing = async () => new Response('nope', { status: 500 });
  const store = await loadStore();

  await store.refreshUserThemes();

  assert.deepEqual(store.getUserThemesState(), { entries: [], status: 'error' });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('~/.cloudcli/themes')),
    'the failure is the only account of why a stored user theme did not come back',
  );
});

test('a request that never lands is reported the same way as one that failed', async () => {
  signIn();
  listing = async () => {
    throw new Error('offline');
  };
  const store = await loadStore();

  await store.refreshUserThemes();

  assert.equal(store.getUserThemesState().status, 'error');
});

test('concurrent refreshes collapse into one request', async () => {
  signIn();
  let release = () => {};
  listing = () => new Promise<Response>((resolve) => {
    release = () => resolve(new Response(JSON.stringify({ themes: [entry()] }), { status: 200 }));
  });
  const store = await loadStore();

  const first = store.refreshUserThemes();
  const second = store.refreshUserThemes();
  release();
  await Promise.all([first, second]);

  assert.equal(requests, 1, 'a second caller while the first is in flight must not start a request');
  assert.equal(store.getUserThemesState().status, 'ready');
});

test('only the server prefix marks an id as one the listing has to confirm', async () => {
  const store = await loadStore();

  assert.equal(store.isUserThemeId('user-borealis'), true);
  assert.equal(store.isUserThemeId('cc-ocean'), false);
  assert.equal(store.isUserThemeId(''), false);
});

test('index.json metadata rides along when shaped right and drops when it is not', async () => {
  signIn();
  listing = listingOf([
    entry({
      id: 'user-tui',
      name: 'tui',
      fileName: 'tui.css',
      displayName: { zh: '字符终端', en: 'TUI' },
      author: 'selier',
      inspiredBy: 'https://github.com/refact0r/system24',
    }),
    // Wrong shapes: these only decide labels and links, so the entry survives
    // with the metadata gone — the same trade `coverage` makes.
    entry({ id: 'user-odd', displayName: '终端机', author: 42, inspiredBy: ['x'] }),
    entry({ id: 'user-empty', displayName: {}, author: '', inspiredBy: '' }),
  ]);
  const store = await loadStore();

  await store.refreshUserThemes();

  const [tui, odd, empty] = store.getUserThemesState().entries;
  assert.deepEqual(tui.displayName, { zh: '字符终端', en: 'TUI' });
  assert.equal(tui.author, 'selier');
  assert.equal(tui.inspiredBy, 'https://github.com/refact0r/system24');
  assert.equal(odd.displayName, undefined, 'a name that is not an object is no name');
  assert.equal(odd.author, undefined);
  assert.equal(odd.inspiredBy, undefined);
  assert.equal(empty.displayName, undefined, 'an object with neither language is no name');
  assert.equal(empty.author, undefined);
  assert.equal(empty.inspiredBy, undefined);
});
