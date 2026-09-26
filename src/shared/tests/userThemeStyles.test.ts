import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The one user theme stylesheet the document carries.
 *
 * A theme's colours are not in the bundle, so applying one means obtaining its
 * text — a fetch for a theme file, a compile of the content already in hand for a
 * pasted one — and injecting a `<style>` element. What is pinned here is the file
 * half: each failure mode ends at the same place, the default palette, and each
 * one is *said* — a refused file clears the cache entry that made the first paint
 * wrong, a listing that has not answered yet is not treated as a listing that said
 * no, and a response that lands after the user moved on is dropped.
 *
 * Each test loads a fresh module copy: the store is a module-level singleton
 * whose state only moves forward.
 */

/** The cache this module owns. Pinned by name so a rename has to be deliberate. */
const STYLE_CACHE_KEY = 'cloudcli.user-theme-style';

const STYLE_SELECTOR = 'style[data-cloudcli-user-theme]';

let fileBody = ':root{--from-file:1}';
let fileStatus = 200;
let fileRequests: string[] = [];
let deferred: { promise: Promise<Response>; resolve: (response: Response) => void } | null = null;

/** Holds the next file request open, so a test can decide when — and whether — it lands. */
const deferFileResponse = (): void => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  deferred = { promise, resolve };
};

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      file: (fileName: string, version: number) => {
        fileRequests.push(`${fileName}?v=${version}`);
        if (deferred) return deferred.promise;
        if (fileStatus !== 200) {
          return Promise.resolve(new Response('nope', { status: fileStatus }));
        }
        return Promise.resolve(new Response(fileBody, { status: 200 }));
      },
    },
    user: { savePreferences: async () => new Response('{}', { status: 200 }) },
  },
}));

const loadStores = async () => {
  vi.resetModules();
  const styles = await import('@/shared/userThemeStyles');
  const settings = await import('@/shared/userSettings');
  return { styles, settings };
};

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-borealis',
  name: 'Borealis',
  fileName: 'borealis.css',
  format: 'css' as const,
  modifiedAt: 42,
  ...overrides,
});

/** The file half of `UserThemeStyleTarget`; the paste half has its own test file. */
const fileTarget = (overrides: Record<string, unknown> = {}) => ({
  kind: 'file' as const,
  entry: entry(overrides),
});

const PASTE_ID = 'paste-1';

/** The paste half: the content is in hand, so nothing about it is fetched. */
const pasteTarget = (content: string) => ({
  kind: 'paste' as const,
  theme: { id: PASTE_ID, name: 'Deep sea', content },
});

const pastedJson = (tokens: Record<string, string>): string =>
  JSON.stringify({ name: 'Deep sea', tokens });

/** Stores the paste and its pick the way the settings page and the mirror would. */
const seedPastedPick = (
  settings: { writeUserPreference: (key: never, value: unknown) => void },
  content: string,
): void => {
  settings.writeUserPreference('userThemePastes' as never, [
    { id: PASTE_ID, name: 'Deep sea', content },
  ]);
  settings.writeUserPreference('themeId' as never, PASTE_ID);
};

const styleElement = (): HTMLStyleElement | null => document.querySelector(STYLE_SELECTOR);

const seedCache = (id: string, modifiedAt: number, css: string): void => {
  localStorage.setItem(STYLE_CACHE_KEY, JSON.stringify({ id, modifiedAt, css }));
};

beforeEach(() => {
  localStorage.clear();
  document.querySelectorAll(STYLE_SELECTOR).forEach((element) => element.remove());
  fileBody = ':root{--from-file:1}';
  fileStatus = 200;
  fileRequests = [];
  deferred = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the cached stylesheet is restored for the pick it was written for', async () => {
  seedCache('user-borealis', 7, ':root{--cached:1}');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');

  styles.applyBootUserThemeStyle();

  assert.equal(styleElement()?.getAttribute('data-cloudcli-user-theme'), 'user-borealis');
  assert.equal(styleElement()?.textContent, ':root{--cached:1}');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: 'user-borealis', failedId: null });
});

test('the cached stylesheet is left alone when the pick has moved on', async () => {
  seedCache('user-borealis', 7, ':root{--cached:1}');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-nord');

  styles.applyBootUserThemeStyle();

  assert.equal(styleElement(), null, 'a cache entry is only evidence for the theme it was written for');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null });
});

test('an entry is fetched with its mtime, injected and cached', async () => {
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget(), true);

  assert.deepEqual(
    fileRequests,
    ['borealis.css?v=42'],
    'the mtime rides along so a proxy cannot serve an older revision over this one',
  );
  assert.equal(styleElement()?.textContent, ':root{--from-file:1}');
  assert.equal(styleElement()?.getAttribute('data-cloudcli-user-theme'), 'user-borealis');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: 'user-borealis', failedId: null });
  assert.ok(
    JSON.parse(localStorage.getItem(STYLE_CACHE_KEY) ?? 'null')?.css === ':root{--from-file:1}',
    'the content is mirrored so the next load can paint it before the fetch returns',
  );
});

test('a token JSON is compiled before it is injected, and the compiled sheet is what is cached', async () => {
  fileBody = JSON.stringify({
    appearance: 'dark',
    tokens: { '--primary': '175 84% 32%', '--term-background': '#0b1220' },
  });
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json' }), true);

  // A raw JSON body injected as CSS would be an element that matches nothing:
  // the picker would show the theme as applied while the page never changed.
  assert.match(
    styleElement()?.textContent ?? '',
    new RegExp(`^\\[data-theme="user-borealis"\\]\\.dark \\{`),
    'the body has to be compiled, with the scope the file declared',
  );
  assert.ok(
    !(styleElement()?.textContent ?? '').includes('--term-background'),
    'a hex on a token consumed through hsl() would be dropped by the browser, so it is dropped here',
  );
  assert.equal(
    JSON.parse(localStorage.getItem(STYLE_CACHE_KEY) ?? 'null')?.css,
    styleElement()?.textContent,
    'the cache feeds the boot-time injection, so it has to hold the compiled sheet, not the JSON',
  );
});

test('a JSON theme that cannot be compiled is refused with the reason', async () => {
  seedCache('user-borealis', 42, ':root{--cached:1}');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');
  styles.applyBootUserThemeStyle();

  fileBody = 'tokens: --primary: 1 2% 3%';
  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json', modifiedAt: 99 }), true);

  assert.equal(styleElement(), null);
  assert.equal(localStorage.getItem(STYLE_CACHE_KEY), null);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis' });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('unreadable-json')),
    'the refusal has to name what was wrong with the file',
  );
});

test('a value that tried to leave its declaration refuses the file rather than being injected', async () => {
  fileBody = JSON.stringify({
    tokens: { '--primary': '175 84% 32%', '--background': '0 0% 0% } body { display: none' },
  });
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json' }), true);

  assert.equal(styleElement(), null, 'a partial sheet must not be injected either');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis' });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('unsafe-value')),
    'this is the value that would have written a rule, so the reason has to name it',
  );
});

test('declarations the compiler dropped are reported without failing the theme', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%', '--safe-area-inset-top': '0px' } });
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json' }), true);

  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: 'user-borealis', failedId: null });
  assert.match(styleElement()?.textContent ?? '', /--primary: 175 84% 32%;/);
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('ignored 1 declaration')),
    'a token that never arrives is an author error worth saying out loud',
  );
});

test('a .tmTheme file is refused instead of being injected as an unparseable sheet', async () => {
  fileBody = '<plist version="1.0"><dict><key>name</key><string>Dracula</string></dict></plist>';
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'tmTheme', fileName: 'dracula.tmTheme' }), true);

  assert.equal(styleElement(), null);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis' });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('tmTheme')),
    'the gap has to be visible until the .tmTheme parser lands',
  );
});

test('an entry already in the document at the same mtime is not fetched again', async () => {
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget(), true);
  await styles.applyUserThemeStyle(fileTarget(), true);

  assert.equal(fileRequests.length, 1, 'a re-listing of an unchanged file must not refetch it');
});

test('an edited file replaces the stylesheet it supersedes', async () => {
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget({ modifiedAt: 42 }), true);

  fileBody = ':root{--from-file:2}';
  await styles.applyUserThemeStyle(fileTarget({ modifiedAt: 99 }), true);

  assert.deepEqual(fileRequests, ['borealis.css?v=42', 'borealis.css?v=99']);
  assert.equal(document.querySelectorAll(STYLE_SELECTOR).length, 1, 'the old element must not be left behind');
  assert.equal(styleElement()?.textContent, ':root{--from-file:2}');
  assert.equal(styles.getUserThemeStyleState().appliedId, 'user-borealis');
});

test('the replacement is in the document before the element it supersedes leaves', async () => {
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget({ modifiedAt: 42 }), true);

  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batched) => records.push(...batched));
  observer.observe(document.head, { childList: true });
  try {
    fileBody = ':root{--from-file:2}';
    await styles.applyUserThemeStyle(fileTarget({ modifiedAt: 99 }), true);
    // The observer callback is a microtask and the swap above is synchronous,
    // so one turn of the queue is all it takes for the records to arrive;
    // `takeRecords` covers the case where it ran before this line.
    await Promise.resolve();
    records.push(...observer.takeRecords());
  } finally {
    observer.disconnect();
  }

  const ours = (nodes: NodeList): Element[] =>
    [...nodes].filter((node): node is Element => node instanceof Element
      && node.hasAttribute('data-cloudcli-user-theme'));

  assert.ok(
    records.length >= 2,
    'the swap is expected to be at least two mutations: the new element in, the old one out',
  );

  // Replay the mutations in the order the document saw them. The page must never
  // be without a stylesheet in between, which is the flash this ordering avoids.
  let live = 1;
  const counts = records.map((record) => {
    live -= ours(record.removedNodes).length;
    live += ours(record.addedNodes).length;
    return live;
  });
  assert.ok(
    counts.every((count) => count > 0),
    `the document must never be without its theme mid-swap (saw ${counts.join(', ')})`,
  );
  assert.equal(document.querySelectorAll(STYLE_SELECTOR).length, 1);
});

test('a file that cannot be read is refused, its cached copy dropped, and reported', async () => {
  seedCache('user-borealis', 42, ':root{--cached:1}');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');
  styles.applyBootUserThemeStyle();
  assert.ok(styleElement(), 'the cached copy is in place before the listing contradicts it');

  // The file was edited since that copy was cached, and the revision the
  // listing points at is refused — a race the client cannot rule out, because
  // the listing and the fetch are two separate requests.
  fileStatus = 400;
  await styles.applyUserThemeStyle(fileTarget({ modifiedAt: 99 }), true);

  assert.equal(styleElement(), null);
  assert.equal(localStorage.getItem(STYLE_CACHE_KEY), null, 'the copy that painted the wrong theme has to go');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis' });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('user-borealis')),
    'a theme that stopped working has to be findable',
  );
});

test('a theme that already failed is not retried on every render', async () => {
  fileStatus = 500;
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget(), true);

  await styles.applyUserThemeStyle(fileTarget(), true);

  assert.equal(fileRequests.length, 1, 'the refusal stands until a reload, rather than looping');
  assert.equal(styles.getUserThemeStyleState().failedId, 'user-borealis');
});

test('the stylesheet is kept while the listing has not answered, and dropped once it rules the theme out', async () => {
  seedCache('user-borealis', 42, ':root{--cached:1}');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');
  styles.applyBootUserThemeStyle();

  await styles.applyUserThemeStyle(null, false);
  assert.ok(styleElement(), 'an unanswered listing is not evidence that the file is gone');

  await styles.applyUserThemeStyle(null, true);

  assert.equal(styleElement(), null);
  assert.equal(localStorage.getItem(STYLE_CACHE_KEY), null);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null });
});

test('picking a built-in clears a refusal so the next pick is tried', async () => {
  fileStatus = 404;
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget(), true);
  assert.equal(styles.getUserThemeStyleState().failedId, 'user-borealis');

  await styles.applyUserThemeStyle(null, true);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null });

  fileStatus = 200;
  await styles.applyUserThemeStyle(fileTarget({ modifiedAt: 99 }), true);
  assert.equal(styles.getUserThemeStyleState().appliedId, 'user-borealis');
});

test('a response that lands after the user moved on is dropped', async () => {
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');
  deferFileResponse();

  const pending = styles.applyUserThemeStyle(fileTarget(), true);
  await styles.applyUserThemeStyle(null, true);
  deferred?.resolve(new Response(':root{--late:1}', { status: 200 }));
  await pending;

  assert.equal(styleElement(), null, 'the theme the user left must not reappear once its fetch lands');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null });
  assert.equal(localStorage.getItem(STYLE_CACHE_KEY), null);
});

test('a pasted theme is compiled and injected without asking the server for anything', async () => {
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(pasteTarget(pastedJson({ '--primary': '175 84% 32%' })), true);

  assert.deepEqual(fileRequests, [], 'the content is in hand, so there is nothing to fetch');
  assert.equal(styleElement()?.getAttribute('data-cloudcli-user-theme'), PASTE_ID);
  assert.match(styleElement()?.textContent ?? '', /^\[data-theme="paste-1"\] \{/);
  assert.equal(styles.getUserThemeStyleState().appliedId, PASTE_ID);
  assert.equal(
    localStorage.getItem(STYLE_CACHE_KEY),
    null,
    'a paste carries its own content, so mirroring it again would be a second copy to keep in step',
  );
});

test('a pasted pick is restored from its own content before anything is fetched', async () => {
  const { styles, settings } = await loadStores();
  seedPastedPick(settings, pastedJson({ '--primary': '175 84% 32%' }));

  styles.applyBootUserThemeStyle();

  assert.equal(
    styleElement()?.getAttribute('data-cloudcli-user-theme'),
    PASTE_ID,
    'a paste needs no cache: its content is in the preference mirror the first paint already has',
  );
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: PASTE_ID, failedId: null });
  assert.deepEqual(fileRequests, []);
});

test('an edited paste replaces the stylesheet it supersedes', async () => {
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(pasteTarget(pastedJson({ '--primary': '175 84% 32%' })), true);

  await styles.applyUserThemeStyle(pasteTarget(pastedJson({ '--primary': '10 20% 30%' })), true);

  assert.equal(document.querySelectorAll(STYLE_SELECTOR).length, 1, 'one theme, one element');
  assert.match(styleElement()?.textContent ?? '', /--primary: 10 20% 30%;/);
  assert.equal(styles.getUserThemeStyleState().appliedId, PASTE_ID);
});

test('a paste that no longer compiles is reported rather than painting nothing quietly', async () => {
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(pasteTarget('not json'), true);

  assert.equal(styleElement(), null);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: PASTE_ID });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('unreadable-json')),
    'the refusal has to name what was wrong',
  );
});

test('the boot restore reports a pasted pick it cannot compile', async () => {
  const { styles, settings } = await loadStores();
  seedPastedPick(settings, 'not json');

  styles.applyBootUserThemeStyle();

  assert.equal(styleElement(), null, 'a first paint that could not compile must not pretend it did');
  assert.deepEqual(
    styles.getUserThemeStyleState(),
    { appliedId: null, failedId: PASTE_ID },
    'and the state has to say so, or the picker marks the pick as applied while the page never changed',
  );
});
