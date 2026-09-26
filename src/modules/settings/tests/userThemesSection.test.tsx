import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The settings page's user-theme section: the two sources, and the two things
 * only this page can do — add a pasted theme and remove one.
 *
 * The distinction pinned here is the one that decides which buttons exist. A
 * theme file cannot be deleted from the page (it lives on the host), and a pasted
 * theme must be deletable (the preferences are its only copy), so a section that
 * rendered them the same way would be promising a deletion it cannot perform or
 * withholding the only one that exists.
 *
 * The fake `t` returns its key, so the assertions read the keys rather than the
 * copy in any one locale.
 */

const validTheme = JSON.stringify({
  name: 'Deep sea',
  tokens: { '--primary': '175 84% 32%' },
});

const fileEntry = {
  id: 'user-borealis',
  name: 'Borealis',
  fileName: 'borealis.css',
  format: 'css' as const,
  modifiedAt: 42,
};

const pasteEntry = { id: 'paste-1', name: 'Deep sea', content: validTheme };

let listing: () => Promise<Response> = async () => new Response('{}', { status: 200 });

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      list: () => listing(),
      file: async () => new Response(':root{--t:1}', { status: 200 }),
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

const listed = (themes: unknown[]): (() => Promise<Response>) =>
  async () => new Response(JSON.stringify({ themes }), { status: 200 });

/** Renders the section over a fresh copy of the stores, with the state already stored. */
async function renderSection(
  themes: unknown[] = [],
  pastes: Array<Record<string, unknown>> = [],
  themeId: string | null = null,
) {
  vi.resetModules();
  const settings = await import('@/shared/userSettings');
  settings.writeUserPreference('themeId', themeId);
  if (pastes.length > 0) {
    settings.writeUserPreference('userThemePastes', pastes);
  }

  listing = listed(themes);
  const { ThemeProvider } = await import('@/shared/context/ThemeContext');
  const UserThemesSection = (await import('@/modules/settings/UserThemesSection')).default;

  const opened = render(
    <ThemeProvider>
      <UserThemesSection />
    </ThemeProvider>,
  );
  await settle();
  return opened;
}

/** Lets the listing and the re-render it causes finish. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** The list item a theme is rendered as, found through its name. */
function rowFor(container: HTMLElement, name: string): HTMLElement {
  const label = [...container.querySelectorAll('span')].find((span) => span.textContent === name);
  assert.ok(label, `no row is labelled ${name}`);
  const row = label.closest('li');
  assert.ok(row, `the entry labelled ${name} is not rendered as a list item`);
  return row;
}

const buttonWithText = (root: HTMLElement, text: string): HTMLButtonElement => {
  const button = [...root.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
  assert.ok(button, `no button reads "${text}"`);
  return button;
};

const pasteBox = (container: HTMLElement): HTMLTextAreaElement => {
  const box = container.querySelector<HTMLTextAreaElement>('#user-theme-paste');
  assert.ok(box, 'the section has to offer somewhere to paste a theme');
  return box;
};

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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('a theme file is listed but cannot be deleted from this page', async () => {
  const { container } = await renderSection([fileEntry]);

  const row = rowFor(container, 'Borealis');
  assert.deepEqual(
    [...row.querySelectorAll('button')].map((button) => button.textContent),
    ['userThemes.use'],
    'the file lives on the host, so the only action this page may offer is picking it',
  );
  assert.ok(container.textContent?.includes('userThemes.files.hint'));
});

test('a pasted theme can be deleted, and deleting it removes the row', async () => {
  const { container } = await renderSection([], [pasteEntry]);

  const row = rowFor(container, 'Deep sea');
  assert.deepEqual(
    [...row.querySelectorAll('button')].map((button) => button.textContent),
    ['userThemes.use', 'userThemes.delete'],
    'the preferences are this theme\'s only copy, so this page has to be able to remove it',
  );

  fireEvent.click(buttonWithText(row, 'userThemes.delete'));

  assert.equal(container.textContent?.includes('Deep sea'), false);
  assert.ok(container.textContent?.includes('userThemes.pastes.empty'));
});

test('pasting a usable theme adds it under the name it declares', async () => {
  const { container } = await renderSection();

  fireEvent.change(pasteBox(container), { target: { value: validTheme } });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  assert.ok(rowFor(container, 'Deep sea'), 'the pasted theme has to appear in the list it was added to');
  assert.equal(container.querySelector('[role="alert"]'), null, 'nothing went wrong, so nothing is reported');
  assert.equal(pasteBox(container).value, '', 'the box is cleared so the next paste starts clean');
});

test('pasting something unusable explains the reason and adds nothing', async () => {
  const { container } = await renderSection();

  fireEvent.change(pasteBox(container), { target: { value: 'not json' } });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  const alert = container.querySelector('[role="alert"]');
  assert.ok(alert, 'a refused paste has to say so where the paste happened');
  assert.ok(alert.textContent?.includes('userThemes.pasteInvalid'));
  assert.ok(
    alert.textContent?.includes('userThemes.reason.unreadable-json'),
    'a generic "invalid" would leave the author guessing which part was wrong',
  );
  assert.ok(container.textContent?.includes('userThemes.pastes.empty'), 'and nothing was added');
});

test('the section names the parameter that resets a theme it cannot undo', async () => {
  const { container } = await renderSection();

  assert.ok(
    container.textContent?.includes('theme=default'),
    '§5.6\'s channel works when this page cannot be read, so this page has to document it',
  );
});

test('the use button puts a theme in force and says which one is in use', async () => {
  const { container } = await renderSection([], [pasteEntry], null);

  fireEvent.click(buttonWithText(rowFor(container, 'Deep sea'), 'userThemes.use'));
  // Applying a theme is a step the pick starts, not one it performs: the
  // stylesheet is compiled and injected a microtask later.
  await settle();

  assert.equal(document.documentElement.dataset.theme, 'paste-1');
  assert.equal(buttonWithText(rowFor(container, 'Deep sea'), 'userThemes.inUse').getAttribute('aria-pressed'), 'true');
});
