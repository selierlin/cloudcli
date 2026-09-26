import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The picker's half of the user theme listing: the themes a file in
 * `~/.cloudcli/themes` adds, and what it says when one of them cannot be put on
 * screen.
 *
 * The distinctions pinned here are the ones a list of options cannot show by
 * itself. A theme whose file failed is still a theme — it stays on offer, and
 * the sentence under the list is what explains why picking it painted nothing.
 * A pick the listing has not answered for yet is neither: saying nothing for one
 * request is what keeps the picker from announcing a fallback it would have to
 * take back.
 *
 * The fake `t` returns its key, so the assertions read the keys rather than the
 * copy in any one locale.
 */

let listing: () => Promise<Response> = async () => new Response('{}', { status: 200 });
let file: () => Promise<Response> = async () => new Response(':root{--t:1}', { status: 200 });

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      list: () => listing(),
      file: () => file(),
    },
    user: { savePreferences: async () => new Response('{}', { status: 200 }) },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options ? `${key}:${JSON.stringify(options)}` : key
    ),
    i18n: { language: 'en' },
  }),
}));

const entry = {
  id: 'user-borealis',
  name: 'Borealis',
  fileName: 'borealis.css',
  format: 'css' as const,
  modifiedAt: 42,
};

const listed = (themes: unknown[]): (() => Promise<Response>) =>
  async () => new Response(JSON.stringify({ themes }), { status: 200 });

/** Loads a fresh picker over a fresh copy of the stores, with the pick already stored. */
async function renderPicker(
  themeId: string | null,
  { restoreCachedStyle = false }: { restoreCachedStyle?: boolean } = {},
) {
  vi.resetModules();
  const settings = await import('@/shared/userSettings');
  settings.writeUserPreference('themeId', themeId);

  // Stands in for the boot-time restore `main.tsx` runs: the cache is put in the
  // document before the picker exists, exactly as it would be on a reload.
  if (restoreCachedStyle) {
    const styles = await import('@/shared/userThemeStyles');
    styles.applyCachedUserThemeStyle();
  }

  const { ThemeProvider } = await import('@/shared/context/ThemeContext');
  const ThemeSelector = (await import('@/modules/settings/ThemeSelector')).default;

  const opened = render(
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>,
  );
  return opened;
}

/** Lets the listing, the stylesheet and the re-render they cause finish. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Option buttons are found through their label: the coverage badge renders
 * inside the button, so it joins the accessible name and matching on the theme
 * name alone would not resolve.
 */
function optionButton(container: HTMLElement, label: string): HTMLButtonElement {
  const labelSpan = [...container.querySelectorAll('span')].find((span) => span.textContent === label);
  assert.ok(labelSpan, `no option is labelled ${label}`);
  const button = labelSpan.closest('button');
  assert.ok(button, `the option labelled ${label} is not rendered as a button`);
  return button;
}

const status = (container: HTMLElement): Element | null => container.querySelector('[role="status"]');

function ensureChromeMeta(name: string): void {
  if (!document.querySelector(`meta[name="${name}"]`)) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('auth-token', 'header.payload.signature');
  document.querySelectorAll('style[data-cloudcli-user-theme]').forEach((element) => element.remove());
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
  ensureChromeMeta('theme-color');
  ensureChromeMeta('apple-mobile-web-app-status-bar-style');
  listing = listed([]);
  file = async () => new Response(':root{--t:1}', { status: 200 });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('the listing adds options to the picker, and a theme that declares no reach claims none', async () => {
  listing = listed([entry]);
  const { container } = await renderPicker('user-borealis');
  await settle();

  const option = optionButton(container, 'Borealis');
  assert.equal(option.getAttribute('aria-checked'), 'true', 'the stored pick has to read as chosen');
  assert.equal(
    option.querySelectorAll('span').length,
    1,
    'a file that declares no coverage carries no badge (§5.8 v4)',
  );
  assert.equal(status(container), null);

  fireEvent.click(optionButton(container, 'themeSelector.default'));
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
});

test('a badge is drawn for the reach a file declares, and only then', async () => {
  listing = listed([
    { ...entry, coverage: 'full' },
    { ...entry, id: 'user-nord', name: 'Nord', fileName: 'nord.json', format: 'json', coverage: 'accent' },
    { ...entry, id: 'user-plain', name: 'Plain', fileName: 'plain.css' },
  ]);
  const { container } = await renderPicker(null);
  await settle();

  /** Everything inside the option that is not the label — the badge, when there is one. */
  const badge = (label: string) =>
    [...optionButton(container, label).querySelectorAll('span')]
      .map((span) => span.textContent)
      .filter((text) => text !== label);

  assert.deepEqual(badge('Borealis'), ['themeSelector.coverage.full']);
  assert.deepEqual(badge('Nord'), ['themeSelector.coverage.accent']);
  assert.deepEqual(badge('Plain'), [], 'a theme that says nothing about its reach claims nothing');
});

test('a theme whose stylesheet failed stays on offer and is explained', async () => {
  listing = listed([entry]);
  file = async () => new Response('nope', { status: 404 });
  const { container } = await renderPicker('user-borealis');
  await settle();

  assert.ok(optionButton(container, 'Borealis'), 'the file failed, not the theme');
  const hint = status(container);
  assert.ok(hint, 'a pick that stopped working has to be explained');
  assert.ok(hint.textContent?.includes('themeSelector.loadFailed'));
  assert.ok(hint.textContent?.includes('user-borealis'), 'the hint has to name the theme');
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
});

test('a theme the listing rules out is explained as missing', async () => {
  listing = listed([entry]);
  const { container } = await renderPicker('user-gone');
  await settle();

  const hint = status(container);
  assert.ok(hint);
  assert.ok(hint.textContent?.includes('themeSelector.notInstalled'));
  assert.ok(hint.textContent?.includes('user-gone'));
  assert.equal(document.documentElement.dataset.theme, 'cc-light');
});

test('a theme restored from the cache is on offer before the listing answers', async () => {
  let answer = (): void => {};
  listing = () => new Promise<Response>((resolve) => {
    answer = () => resolve(new Response(JSON.stringify({ themes: [] }), { status: 200 }));
  });
  localStorage.setItem('cloudcli.user-theme-style', JSON.stringify({
    id: 'user-borealis',
    modifiedAt: 42,
    css: ':root{--t:1}',
  }));

  const { container } = await renderPicker('user-borealis', { restoreCachedStyle: true });

  // The stylesheet is what put this theme on screen, and the listing has not
  // said anything about it yet — so the option is built from the id alone, the
  // pick reads as chosen, and nothing claims the theme is missing.
  const option = optionButton(container, 'user-borealis');
  assert.equal(option.getAttribute('aria-checked'), 'true');
  assert.equal(document.documentElement.dataset.theme, 'user-borealis');
  assert.equal(status(container), null);

  answer();
  await settle();

  // Now the absence is evidence, and the theme the cache painted is gone.
  assert.ok(status(container)?.textContent?.includes('themeSelector.notInstalled'));
});

test('nothing is claimed about a pick while the listing is still on its way', async () => {
  let answer = (): void => {};
  listing = () => new Promise<Response>((resolve) => {
    answer = () => resolve(new Response(JSON.stringify({ themes: [entry] }), { status: 200 }));
  });

  const { container } = await renderPicker('user-borealis');

  assert.equal(
    status(container),
    null,
    'a listing that has not answered is not a listing that said the theme is absent',
  );

  answer();
  await settle();

  assert.equal(status(container), null, 'and once it answers, the theme is there after all');
  assert.equal(optionButton(container, 'Borealis').getAttribute('aria-checked'), 'true');
});
