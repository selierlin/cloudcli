import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { SYNTAX_TOKEN_MAP } from '@/shared/syntaxTheme';

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

/** The preview element; a different attribute from the applied one, on purpose. */
const PREVIEW_SELECTOR = 'style[data-cloudcli-theme-preview]';

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

/**
 * The paste half: the content is in hand, so nothing about it is fetched.
 * `format` defaults to option A's, which is what most of these cases paste; the
 * css ones say so, because that is the whole difference the store dispatches on.
 */
const pasteTarget = (content: string, format: 'json' | 'css' = 'json') => ({
  kind: 'paste' as const,
  theme: { id: PASTE_ID, name: 'Deep sea', content, format },
});

const pastedJson = (tokens: Record<string, string>): string =>
  JSON.stringify({ name: 'Deep sea', tokens });

/** Stores the paste and its pick the way the settings page and the mirror would. */
const seedPastedPick = (
  settings: { writeUserPreference: (key: never, value: unknown) => void },
  content: string,
  format: 'json' | 'css' = 'json',
): void => {
  settings.writeUserPreference('userThemePastes' as never, [
    { id: PASTE_ID, name: 'Deep sea', content, format },
  ]);
  settings.writeUserPreference('themeId' as never, PASTE_ID);
};

const styleElement = (): HTMLStyleElement | null => document.querySelector(STYLE_SELECTOR);

/**
 * The fingerprint a cache entry written by *this* build carries. Derived from the
 * same mapping the module derives it from, so the test cannot pin a value the
 * build would not produce; the "another build" case below passes one by hand.
 */
const CURRENT_FINGERPRINT = JSON.stringify(SYNTAX_TOKEN_MAP);

const seedCache = (
  id: string,
  modifiedAt: number,
  css: string,
  fingerprint: string = CURRENT_FINGERPRINT,
  warnings: Array<Record<string, unknown>> = [],
): void => {
  localStorage.setItem(STYLE_CACHE_KEY, JSON.stringify({ id, modifiedAt, fingerprint, css, warnings }));
};

beforeEach(() => {
  localStorage.clear();
  document.querySelectorAll(`${STYLE_SELECTOR}, ${PREVIEW_SELECTOR}`).forEach((element) => element.remove());
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: 'user-borealis', failedId: null, warnings: [] });
});

test('what an apply caches is what the next boot restore accepts', async () => {
  const first = await loadStores();
  first.settings.writeUserPreference('themeId', 'user-borealis');
  await first.styles.applyUserThemeStyle(fileTarget(), true);
  assert.ok(localStorage.getItem(STYLE_CACHE_KEY), 'an apply is expected to leave a cached copy');

  // The element the apply injected is taken out of the document, or it would
  // satisfy the assertion below whether or not the restore worked — the point is
  // that storage alone is enough to repaint on the next boot.
  document.querySelectorAll(STYLE_SELECTOR).forEach((element) => element.remove());

  // A fresh session, with nothing but what the first one left in storage. The
  // cache is only worth writing if the module's own check accepts it, and that
  // check is what a build change has to be able to fail (§5.5 v4).
  const second = await loadStores();
  second.styles.applyBootUserThemeStyle();

  assert.equal(
    styleElement()?.getAttribute('data-cloudcli-user-theme'),
    'user-borealis',
    'the copy the module wrote must pass the check the module makes of it',
  );
});

test('the cached stylesheet is left alone when the pick has moved on', async () => {
  seedCache('user-borealis', 7, ':root{--cached:1}');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-nord');

  styles.applyBootUserThemeStyle();

  assert.equal(styleElement(), null, 'a cache entry is only evidence for the theme it was written for');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null, warnings: [] });
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: 'user-borealis', failedId: null, warnings: [] });
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
  // Every apply goes through the contrast report, so a theme with nothing to
  // report must be silent — otherwise the console line becomes wallpaper and the
  // one theme that does need reading never gets noticed.
  assert.ok(
    !vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('WCAG AA')),
    'a theme that clears the floors is not warned about',
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis', warnings: [] });
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis', warnings: [] });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('unsafe-value')),
    'this is the value that would have written a rule, so the reason has to name it',
  );
});

test('declarations the compiler dropped are reported without failing the theme', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%', '--safe-area-inset-top': '0px' } });
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json' }), true);

  assert.equal(styles.getUserThemeStyleState().appliedId, 'user-borealis');
  assert.deepEqual(styles.getUserThemeStyleState().failedId, null);
  assert.deepEqual(
    styles.getUserThemeStyleState().warnings.map(({ ink }) => ink),
    ['--primary-foreground'],
    'the same theme also carries a contrast report, alongside the dropped-declaration one',
  );
  assert.match(styleElement()?.textContent ?? '', /--primary: 175 84% 32%;/);
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('ignored 1 declaration')),
    'a token that never arrives is an author error worth saying out loud',
  );
});

test('a theme that applies but cannot be read is warned about, not held back', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json' }), true);

  const appliedState = styles.getUserThemeStyleState();
  assert.equal(appliedState.appliedId, 'user-borealis');
  assert.equal(appliedState.failedId, null);
  assert.deepEqual(
    appliedState.warnings.map(({ appearance, ink, surface, min }) => ({
      appearance, ink, surface, min,
    })),
    [{ appearance: 'light', ink: '--primary-foreground', surface: '--primary', min: 4.5 }],
    '§5.10 asks for a warning; a theme that is hard to read is still the one the user asked for',
  );
  assert.ok(
    Math.abs((appliedState.warnings[0]?.ratio ?? 0) - 3.49) < 0.005,
    'and the ratio is the one the console line names',
  );
  assert.match(styleElement()?.textContent ?? '', /--primary: 175 84% 32%;/);
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('WCAG AA')),
    'the settings page lists files without reading them, so the console is a theme file author\'s only channel',
  );
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) =>
      String(detail).includes('light --primary-foreground on --primary: 3.49:1 < 4.5:1')),
    'and it has to name the pair, the ratio and the floor, or there is nothing to act on',
  );
});

test('a .tmTheme is compiled into an overlay rather than injected as plist XML', async () => {
  fileBody = [
    '<plist version="1.0"><dict>',
    '<key>settings</key><array>',
    '<dict><key>settings</key><dict>',
    '<key>background</key><string>#282a36</string>',
    '<key>foreground</key><string>#f8f8f2</string>',
    '<key>caret</key><string>#f8f8f0</string>',
    '</dict></dict>',
    '<dict><key>scope</key><string>keyword</string>',
    '<key>settings</key><dict><key>foreground</key><string>#ff79c6</string></dict></dict>',
    '</array></dict></plist>',
  ].join('');
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'tmTheme', fileName: 'dracula.tmTheme' }), true);

  const css = styleElement()?.textContent ?? '';
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: 'user-borealis', failedId: null, warnings: [] });
  assert.match(css, /^\[data-theme="user-borealis"\] \{/, 'the plist has to become an overlay, not be passed through');
  // The terminal resolves these as `hsl(var(--term-…))`, so a hex here would be
  // dropped by the browser and the terminal would silently keep its old colour.
  assert.match(css, /--term-background: 231 15% 18%;/);
  assert.match(css, /--term-cursor: \d+ \d+% \d+%;/);
  assert.match(css, /--editor-bg: #282a36;/, 'the editor takes the colour whole');
  assert.ok(
    css.includes(`${SYNTAX_TOKEN_MAP.keyword}: #ff79c6;`),
    'the syntax slot is addressed through the derived mapping, never by a hand-written number',
  );
});

test('a .tmTheme with a cloudcli key has its own token pairs contrast-checked on apply', async () => {
  fileBody = [
    '<plist version="1.0"><dict>',
    '<key>cloudcli</key><dict>',
    '<key>appearance</key><string>light</string>',
    '<key>tokens</key><dict><key>--primary</key><string>175 84% 32%</string></dict>',
    '</dict>',
    '<key>settings</key><array>',
    '<dict><key>settings</key><dict><key>foreground</key><string>#f8f8f2</string></dict></dict>',
    '</array></dict></plist>',
  ].join('');
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'tmTheme', fileName: 'dracula.tmTheme' }), true);

  assert.equal(styles.getUserThemeStyleState().appliedId, 'user-borealis');
  assert.ok(
    styles.getUserThemeStyleState().warnings.length === 1,
    'the embedded key moves main-UI tokens, so its warning rides the state the settings page reads',
  );
  const css = styleElement()?.textContent ?? '';
  assert.match(css, /--primary: 175 84% 32%;/, 'the embedded block reaches the document');
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) =>
      String(detail).includes('light --primary-foreground on --primary: 3.49:1 < 4.5:1')),
    'the embedded key moves main-UI tokens, so its warnings ride the same console channel a .json\u2019s do',
  );
});

test('a .tmTheme that is not a plist is refused with the reason', async () => {
  fileBody = '{"tokens": {"--primary": "175 84% 32%"}}';
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(fileTarget({ format: 'tmTheme', fileName: 'dracula.tmTheme' }), true);

  assert.equal(styleElement(), null);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis', warnings: [] });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('unreadable-plist')),
    'the refusal has to name what was wrong with the file',
  );
});

test('a cached copy compiled by another build is not restored', async () => {
  // What a `.tmTheme` compiles to names `--cc-syntax-*` variables, whose numbers
  // a Prism bump can reorder. The file's own revision cannot see that, so a copy
  // from a previous build would paint last build's numbering and then look
  // current — the fingerprint is the only thing that can contradict it.
  seedCache('user-borealis', 7, ':root{--cached:1}', 'a-fingerprint-from-another-build');
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');

  styles.applyBootUserThemeStyle();

  assert.equal(styleElement(), null, 'a stale compiled sheet must not reach the first paint');
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null, warnings: [] });
});

test('a cache entry from before the fingerprint existed is not restored either', async () => {
  localStorage.setItem(STYLE_CACHE_KEY, JSON.stringify({ id: 'user-borealis', modifiedAt: 7, css: ':root{--cached:1}' }));
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');

  styles.applyBootUserThemeStyle();

  assert.equal(styleElement(), null, 'an entry that cannot state its build is treated as one from another build');
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: 'user-borealis', warnings: [] });
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null, warnings: [] });
});

test('picking a built-in clears a refusal so the next pick is tried', async () => {
  fileStatus = 404;
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget(), true);
  assert.equal(styles.getUserThemeStyleState().failedId, 'user-borealis');

  await styles.applyUserThemeStyle(null, true);
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null, warnings: [] });

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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: null, warnings: [] });
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
  const restored = styles.getUserThemeStyleState();
  assert.equal(restored.appliedId, PASTE_ID);
  assert.equal(restored.failedId, null);
  assert.ok(
    restored.warnings.length === 1,
    'the compile the boot restore runs reports the same pairs the apply did',
  );
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
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: PASTE_ID, warnings: [] });
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
    { appliedId: null, failedId: PASTE_ID, warnings: [] },
    'and the state has to say so, or the picker marks the pick as applied while the page never changed',
  );
});

/**
 * The css half of the paste line (§5.5 v5, §5.8 v6). Two claims the store owes
 * this format: its text is what gets injected, and the one gate a stylesheet
 * needs is applied to the content rather than only to the act of pasting.
 */

const PASTED_CSS = '[class*=toolbar] { background: hsl(200 50% 20%); }';

test('a css paste reaches the document as it stands, rather than being compiled', async () => {
  const { styles } = await loadStores();

  await styles.applyUserThemeStyle(pasteTarget(PASTED_CSS, 'css'), true);

  assert.equal(
    styleElement()?.textContent,
    PASTED_CSS,
    'option B is a stylesheet already; recompiling it would be rewriting the author\'s own selectors',
  );
  assert.equal(styles.getUserThemeStyleState().appliedId, PASTE_ID);
  assert.deepEqual(fileRequests, [], 'a paste has no file behind it, whatever format it is in');
});

test('a css pick is restored as it stands before anything is fetched, too', async () => {
  const { styles, settings } = await loadStores();
  seedPastedPick(settings, PASTED_CSS, 'css');

  styles.applyBootUserThemeStyle();

  assert.equal(
    styleElement()?.textContent,
    PASTED_CSS,
    'the first paint is the same compile step, so it has to take the same branch',
  );
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: PASTE_ID, failedId: null, warnings: [] });
  assert.deepEqual(fileRequests, []);
});

test('the @import gate runs on the content at apply time, not only when it was pasted', async () => {
  const { styles } = await loadStores();
  const hostile = `${PASTED_CSS}\n@import url("https://example.invalid/x.css");`;

  await styles.applyUserThemeStyle(pasteTarget(hostile, 'css'), true);

  assert.equal(
    styleElement(),
    null,
    'a mirror written by another client never passed the paste-time gate, so this one has to hold too',
  );
  assert.deepEqual(styles.getUserThemeStyleState(), { appliedId: null, failedId: PASTE_ID, warnings: [] });
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([, detail]) => String(detail).includes('import-rule')),
    'and the refusal has to name the rule it was refused for',
  );
});

test('a pasted theme that cannot be read is accounted for as it applies, too', async () => {
  const { styles } = await loadStores();
  const unreadable = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });

  await styles.applyUserThemeStyle(pasteTarget(unreadable), true);

  assert.equal(styles.getUserThemeStyleState().appliedId, PASTE_ID);
  assert.ok(
    vi.mocked(console.warn).mock.calls.some(([message]) => String(message).includes('WCAG AA')),
    'its author was told in the paste box, and this is the other half: the apply step reports it as well',
  );
});

/**
 * The preview element (§5.5's advanced mode): a draft the settings page is still
 * writing, put on the page so its author can see it.
 *
 * It is the same kind of object as the applied stylesheet — a `<style>` in the
 * head — so what is worth pinning is exactly what follows from the two sharing a
 * document: a preview never becomes the applied theme, it stays the last
 * stylesheet so it is the one seen, and the forced recovery channel takes it away
 * with everything else.
 */

const previewElement = (): HTMLStyleElement | null => document.querySelector(PREVIEW_SELECTOR);

/** Whether `later` follows `earlier` in document order. */
const follows = (earlier: Element, later: Element): boolean =>
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

test('a preview reaches the document without becoming the applied theme', async () => {
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(pasteTarget(pastedJson({ '--primary': '175 84% 32%' })), true);

  styles.previewUserThemeStyle(':root { --draft: 1; }');

  assert.equal(previewElement()?.textContent, ':root { --draft: 1; }');
  assert.equal(
    styles.getUserThemeStyleState().appliedId,
    PASTE_ID,
    'a preview is not a theme: what is picked and applied must not move with a draft',
  );
  assert.ok(
    !(styleElement()?.textContent ?? '').includes('--draft'),
    'and the draft is a second element rather than a rewrite of the applied one',
  );
});

test('a preview stays after the applied stylesheet, so the draft is the one seen', async () => {
  const { styles } = await loadStores();
  styles.previewUserThemeStyle(':root { --draft: 1; }');

  await styles.applyUserThemeStyle(pasteTarget(pastedJson({ '--primary': '175 84% 32%' })), true);

  const applied = styleElement();
  const preview = previewElement();
  assert.ok(applied && preview, 'both stylesheets are expected to be in the document');
  assert.ok(
    follows(applied, preview),
    'same specificity, so only the later sheet is seen — an apply that buried the preview would stop showing it',
  );
});

test('a later preview replaces the one before it', async () => {
  const { styles } = await loadStores();

  styles.previewUserThemeStyle(':root { --draft: 1; }');
  styles.previewUserThemeStyle(':root { --draft: 2; }');

  assert.equal(document.querySelectorAll(PREVIEW_SELECTOR).length, 1, 'one draft, one element');
  assert.equal(previewElement()?.textContent, ':root { --draft: 2; }');
});

test('removing the preview leaves the applied theme alone', async () => {
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(pasteTarget(pastedJson({ '--primary': '175 84% 32%' })), true);
  styles.previewUserThemeStyle(':root { --draft: 1; }');

  styles.previewUserThemeStyle(null);

  assert.ok(previewElement() === null);
  assert.equal(styles.getUserThemeStyleState().appliedId, PASTE_ID);
  assert.ok(styleElement(), 'the theme the user picked has to survive the draft going away');
});

test('the forced recovery channel takes the preview with it', async () => {
  const { styles } = await loadStores();
  styles.previewUserThemeStyle(':root { --draft: 1; }');

  styles.clearAppliedUserThemeStyle();

  assert.ok(
    previewElement() === null,
    'a draft that made the page unreadable is exactly what this channel has to escape',
  );
});

/**
 * The contrast report travels with the state (§5.10): it describes the sheet in
 * the document, so it survives a reload through the cache, follows the old
 * sheet while its replacement is on the way, and goes with the theme when the
 * theme goes.
 */

test('the warnings of the applied file theme travel with the cache to the next boot', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });
  const first = await loadStores();
  first.settings.writeUserPreference('themeId', 'user-borealis');
  await first.styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json' }), true);
  assert.ok(first.styles.getUserThemeStyleState().warnings.length === 1, 'the first session compiled a report');

  document.querySelectorAll(STYLE_SELECTOR).forEach((element) => element.remove());

  const second = await loadStores();
  second.styles.applyBootUserThemeStyle();

  assert.equal(styleElement()?.getAttribute('data-cloudcli-user-theme'), 'user-borealis');
  assert.deepEqual(
    second.styles.getUserThemeStyleState().warnings.map(({ ink }) => ink),
    ['--primary-foreground'],
    'the boot restore injects the sheet without recompiling it, so its report has to travel with it',
  );
});

test('a cache entry that cannot state its warnings is not restored', async () => {
  localStorage.setItem(
    STYLE_CACHE_KEY,
    JSON.stringify({
      id: 'user-borealis',
      modifiedAt: 7,
      fingerprint: CURRENT_FINGERPRINT,
      css: ':root{--cached:1}',
      warnings: 'yesterday',
    }),
  );
  const { styles, settings } = await loadStores();
  settings.writeUserPreference('themeId', 'user-borealis');

  styles.applyBootUserThemeStyle();

  assert.equal(
    styleElement(),
    null,
    'an entry this build cannot vouch for is treated as one from another build',
  );
});

test('switching to a theme that fails takes the old warning off the state', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json', modifiedAt: 42 }), true);
  assert.ok(styles.getUserThemeStyleState().warnings.length === 1);

  fileStatus = 500;
  await styles.applyUserThemeStyle(
    fileTarget({ id: 'user-nord', format: 'json', fileName: 'nord.json', modifiedAt: 99 }),
    true,
  );

  assert.deepEqual(
    styles.getUserThemeStyleState(),
    { appliedId: null, failedId: 'user-nord', warnings: [] },
    'the page has fallen back, so a warning about the theme it was wearing would be read as one about this one',
  );
});

test('the old warning stays while the replacement is still loading', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });
  const { styles } = await loadStores();
  await styles.applyUserThemeStyle(fileTarget({ format: 'json', fileName: 'borealis.json', modifiedAt: 42 }), true);
  assert.ok(styles.getUserThemeStyleState().warnings.length === 1);

  deferFileResponse();
  const pending = styles.applyUserThemeStyle(
    fileTarget({ format: 'json', fileName: 'borealis.json', modifiedAt: 99 }),
    true,
  );
  assert.equal(
    styles.getUserThemeStyleState().warnings.length,
    1,
    'until the new sheet lands, what the page wears is the old one, and its report is the current one',
  );
  deferred?.resolve(
    new Response(JSON.stringify({ tokens: { '--term-background': '210 45% 8%' } }), { status: 200 }),
  );
  await pending;

  assert.deepEqual(
    styles.getUserThemeStyleState().warnings,
    [],
    'the replacement has nothing to report, and the state describes the sheet now in the document',
  );
});
