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

const pasteEntry = { id: 'paste-1', name: 'Deep sea', content: validTheme, format: 'json' as const };

let listing: () => Promise<Response> = async () => new Response('{}', { status: 200 });
let fileBody = ':root{--t:1}';

vi.mock('@/shared/api', () => ({
  api: {
    themes: {
      list: () => listing(),
      file: async () => new Response(fileBody, { status: 200 }),
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

/**
 * Advanced mode's surface is CodeMirror, which wants a laid-out document that
 * jsdom does not provide. What this file is about is the section's behaviour
 * around that control, so it stands in as a textarea taking the same two props —
 * the value, and what to do when it changes — and it is still found through the
 * label's `for`, exactly as the real one is.
 *
 * It carries a test id of its own, because the stand-in and option A's plain box
 * would otherwise be the same element to a query: which one is on screen is the
 * thing one test below asks, and without this it could not.
 */
vi.mock('@uiw/react-codemirror', () => {
  function CodeMirrorStub({
    id,
    value,
    placeholder,
    onChange,
  }: {
    id?: string;
    value?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
  }) {
    return (
      <textarea
        data-testid="theme-css-editor"
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return { default: CodeMirrorStub };
});

const listed = (themes: unknown[]): (() => Promise<Response>) =>
  async () => new Response(JSON.stringify({ themes }), { status: 200 });

/**
 * Renders the section over a fresh copy of the stores, with the state already
 * stored. The settings module is returned as well, because what the section
 * *writes* is half of what these tests are about. `storedPasteFormat` is a
 * `string` rather than the two known values because one case is about a value
 * this build does not know arriving from the mirror.
 */
async function renderSection(
  themes: unknown[] = [],
  pastes: Array<Record<string, unknown>> = [],
  themeId: string | null = null,
  storedPasteFormat: string | null = null,
) {
  vi.resetModules();
  const settings = await import('@/shared/userSettings');
  settings.writeUserPreference('themeId', themeId);
  if (pastes.length > 0) {
    settings.writeUserPreference('userThemePastes', pastes);
  }
  if (storedPasteFormat !== null) {
    settings.writeUserPreference('themePasteFormat', storedPasteFormat);
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
  return { ...opened, settings };
}

/** Lets the listing and the re-render it causes finish. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Waits out advanced mode's preview debounce (300ms) and the render it causes.
 * Comfortably past the boundary rather than at it, so the test does not depend
 * on which side of it a timer happens to land.
 */
async function passPreviewDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
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
  fileBody = ':root{--t:1}';
  document
    .querySelectorAll('style[data-cloudcli-user-theme], style[data-cloudcli-theme-preview]')
    .forEach((element) => element.remove());
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

test('a file theme\u2019s provenance line names the author and links only an http(s) inspiredBy', async () => {
  const { container } = await renderSection([
    {
      ...fileEntry,
      displayName: { zh: '极光' },
      author: 'selier',
      inspiredBy: 'https://github.com/refact0r/system24',
    },
    // A scheme an anchor must not have: shown as text, never as an href.
    {
      ...fileEntry,
      id: 'user-plain',
      name: 'Plain',
      fileName: 'plain.css',
      inspiredBy: 'javascript:alert(1)',
    },
  ]);

  const labeled = rowFor(container, '极光');
  assert.ok(
    labeled.textContent?.includes('selier'),
    'the author is shown as plain text beside the name',
  );
  const link = labeled.querySelector('a');
  assert.ok(link, 'an http(s) inspiredBy is a link');
  assert.equal(link.getAttribute('href'), 'https://github.com/refact0r/system24');
  assert.equal(link.textContent, 'github.com', 'the link text is the host itself');

  const plain = rowFor(container, 'Plain');
  assert.equal(plain.querySelector('a'), null, 'a non-http(s) inspiredBy never becomes an href');
  assert.ok(
    plain.textContent?.includes('javascript:alert(1)'),
    'free text is shown verbatim rather than quietly dropped',
  );
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
  assert.ok(
    container.querySelector('[role="alert"]') === null,
    'nothing went wrong, so nothing is reported',
  );
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

/**
 * The advanced mode (§5.5 v5): the same box writes one of two formats, and the
 * one that can break the page is behind a confirmation.
 *
 * The line these tests hold is the one between *asking* and *having decided*:
 * a switch that stored the format and then asked would leave the footgun armed
 * on the next reload, which is exactly what §5.6's forced channel exists to
 * cover — so the assertion that the preference is still unset before the answer
 * is the point of the first of them.
 */

const modeButton = (root: HTMLElement, format: 'json' | 'css'): HTMLButtonElement =>
  buttonWithText(root, `userThemes.mode.${format}`);

test('the paste box offers both formats, writes option A, and states the difference', async () => {
  const { container } = await renderSection();

  assert.equal(modeButton(container, 'json').getAttribute('aria-checked'), 'true');
  assert.equal(modeButton(container, 'css').getAttribute('aria-checked'), 'false');
  assert.ok(
    container.textContent?.includes('userThemes.mode.hint'),
    '§5.6 requires the safety difference to be stated at the switch, not left to the word "advanced"',
  );
  assert.equal(
    pasteBox(container).getAttribute('placeholder'),
    'userThemes.pastePlaceholder.json',
    'the example has to match the format being written, or it teaches the wrong one',
  );
  assert.equal(
    container.textContent?.includes('userThemes.mode.cssNote'),
    false,
    'the note is about writing a stylesheet, so it belongs to that mode',
  );
});

test('an unrecognised stored format opens as option A, the safe one', async () => {
  const { container } = await renderSection([], [], null, 'scss');

  assert.equal(
    modeButton(container, 'json').getAttribute('aria-checked'),
    'true',
    'the mirror is writable by other clients, and a value this build cannot read must not leave the switch pointing at neither mode',
  );
});

test('a preference that arrives after the section is open moves the switch with it', async () => {
  const { container, settings } = await renderSection();
  assert.equal(modeButton(container, 'json').getAttribute('aria-checked'), 'true');

  await act(async () => {
    settings.writeUserPreference('themePasteFormat', 'css');
  });

  assert.equal(
    modeButton(container, 'css').getAttribute('aria-checked'),
    'true',
    'the preference arrives from a hydrate as well as from this page, so the switch has to follow the store',
  );
});

test('switching to css asks first, and the preference is written only on a yes', async () => {
  const { container, settings } = await renderSection();

  fireEvent.click(modeButton(container, 'css'));

  assert.ok(
    container.textContent?.includes('userThemes.trust.body'),
    'the risk has to be spelled out before the mode takes effect',
  );
  assert.equal(settings.readUserPreference('themePasteFormat', null), null, 'asking is not deciding');

  fireEvent.click(buttonWithText(container, 'userThemes.trust.confirm'));

  assert.equal(settings.readUserPreference('themePasteFormat', null), 'css');
  assert.equal(modeButton(container, 'css').getAttribute('aria-checked'), 'true');
  assert.equal(
    container.textContent?.includes('userThemes.trust.body'),
    false,
    'and the question goes away with the answer',
  );
});

test('declining the confirmation leaves the box writing option A', async () => {
  const { container, settings } = await renderSection();

  fireEvent.click(modeButton(container, 'css'));
  fireEvent.click(buttonWithText(container, 'userThemes.trust.cancel'));

  assert.equal(settings.readUserPreference('themePasteFormat', null), null);
  assert.equal(modeButton(container, 'json').getAttribute('aria-checked'), 'true');
});

test('in css mode the box stores a stylesheet, under the format the mode names', async () => {
  const { container, settings } = await renderSection();

  fireEvent.click(modeButton(container, 'css'));
  fireEvent.click(buttonWithText(container, 'userThemes.trust.confirm'));
  const css = ':root { --primary: 175 84% 32%; }';
  fireEvent.change(pasteBox(container), { target: { value: css } });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  assert.deepEqual(
    settings.readUserPreference('userThemePastes', null),
    [{ id: 'paste-1', name: 'paste-1', content: css, format: 'css' }],
    'the entry records the format of the mode it was pasted in, not the mode later in force',
  );
  assert.ok(rowFor(container, 'paste-1'), 'and a stylesheet has no name of its own, so it is its id');
  assert.equal(pasteBox(container).getAttribute('placeholder'), 'userThemes.pastePlaceholder.css');
  assert.ok(
    container.textContent?.includes('userThemes.mode.cssNote'),
    'a paste cannot know the id it will get, so the form that needs no id has to be spelled out',
  );
});

test('going back to option A takes effect at once, and is not a question', async () => {
  const { container, settings } = await renderSection([], [], null, 'css');

  fireEvent.click(modeButton(container, 'json'));

  assert.equal(settings.readUserPreference('themePasteFormat', null), 'json');
  assert.equal(
    container.textContent?.includes('userThemes.trust.body'),
    false,
    'only the direction that can break the page is worth confirming',
  );
});

test('clicking raw CSS while it is already in force asks nothing', async () => {
  const { container } = await renderSection([], [], null, 'css');

  fireEvent.click(modeButton(container, 'css'));

  assert.equal(
    container.textContent?.includes('userThemes.trust.body'),
    false,
    'there is no switch to confirm, so asking would be a question with no answer to change',
  );
});

test('a stored css preference opens in css mode without asking again', async () => {
  const { container } = await renderSection([], [], null, 'css');

  assert.equal(modeButton(container, 'css').getAttribute('aria-checked'), 'true');
  assert.equal(
    container.textContent?.includes('userThemes.trust.body'),
    false,
    'the question belongs to the act of switching, and this device already answered it',
  );
});

/**
 * §5.10's contrast warning, where its author can see it.
 *
 * The paste box is the only moment a pasted theme's author is looking at
 * anything, so it is the only moment the warning can reach them. The line these
 * tests hold is that it is a *warning*: the theme was added, the report is not an
 * alert, and a theme with nothing to report says nothing.
 */

test('a paste that is kept but cannot be read is reported as a warning, not a failure', async () => {
  const { container } = await renderSection();

  fireEvent.change(pasteBox(container), { target: { value: validTheme } });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  assert.ok(rowFor(container, 'Deep sea'), 'the theme was added all the same');
  const report = container.querySelector('[role="status"]');
  assert.ok(report, 'a warning with nowhere to appear is not a warning');
  assert.ok(report.textContent?.includes('userThemes.contrastTitle'));
  assert.ok(
    report.textContent?.includes('userThemes.contrastWarning'),
    'and it has to name the pair and the ratio rather than call the theme bad',
  );
  assert.ok(
    report.textContent?.includes('--primary-foreground'),
    'the pair from the example: the label colour the base puts on an accent fill',
  );
  assert.ok(
    report.textContent?.includes('userThemes.contrastAppearance.light'),
    'and which appearance it fails in — the same theme passes in the other one',
  );
  assert.ok(report.textContent?.includes('3.49'));
  // `assert.ok(x === null)` rather than `assert.equal(x, null)`: on failure the
  // latter asks node to describe a jsdom element, and that inspection is deep
  // enough to take the worker down instead of reporting the failure.
  assert.ok(
    container.querySelector('[role="alert"]') === null,
    'nothing failed, so this must not be reported the way a refusal is',
  );
});

test('a paste with nothing to report shows no warning block', async () => {
  const { container } = await renderSection();

  // A terminal colour: a legal option A token, and one no §5.10 pair is made of.
  fireEvent.change(pasteBox(container), {
    target: { value: JSON.stringify({ tokens: { '--term-background': '210 45% 8%' } }) },
  });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  assert.equal(pasteBox(container).value, '', 'it was accepted');
  assert.ok(
    container.querySelector('[role="status"]') === null,
    'a block that always renders would teach the reader to ignore it',
  );
});

test('a refused paste does not leave the previous theme\'s warning on screen', async () => {
  const { container } = await renderSection();

  fireEvent.change(pasteBox(container), { target: { value: validTheme } });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));
  assert.ok(container.querySelector('[role="status"]'), 'the first paste had something to report');

  fireEvent.change(pasteBox(container), { target: { value: 'not json' } });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  assert.ok(container.querySelector('[role="alert"]'), 'the second paste failed');
  assert.ok(
    container.querySelector('[role="status"]') === null,
    'a report about a theme that is not the one that just failed would be read as a report about it',
  );
});

test('a warning for a dark-scoped theme names the dark appearance', async () => {
  const { container } = await renderSection();

  // A teal dark enough for near-white text: it clears the light base and fails
  // the dark one, so the label is not decoration — it is the only thing that says
  // which half of the page the author has to look at.
  fireEvent.change(pasteBox(container), {
    target: { value: JSON.stringify({ appearance: 'dark', tokens: { '--primary': '175 84% 20%' } }) },
  });
  fireEvent.click(buttonWithText(container, 'userThemes.pasteSubmit'));

  const report = container.querySelector('[role="status"]');
  assert.ok(report, 'the theme applies, so its report has somewhere to appear');
  assert.ok(
    report.textContent?.includes('userThemes.contrastAppearance.dark'),
    'the appearance the pair fails in, not a fixed one',
  );
  assert.ok(
    report.textContent?.includes('userThemes.contrastAppearance.light') === false,
    'and not the other, which this theme clears',
  );
});

/**
 * Advanced mode's live preview (§5.5): the page wears the draft while it is
 * written.
 *
 * The hook has its own file for the debounce and the injection; what this file
 * holds is the section's half — that the box says which of the two things
 * happened, because "the page just changed under me" and "the page refused the
 * draft" look the same from the outside otherwise.
 */

const previewElement = (): HTMLStyleElement | null =>
  document.querySelector('style[data-cloudcli-theme-preview]');

/** Opens the section already in advanced mode, past the trust confirmation. */
async function openAdvancedMode() {
  const opened = await renderSection();
  fireEvent.click(modeButton(opened.container, 'css'));
  fireEvent.click(buttonWithText(opened.container, 'userThemes.trust.confirm'));
  return opened;
}

test('advanced mode edits the draft in the editor rather than the plain box', async () => {
  const { container } = await renderSection();
  assert.ok(
    container.querySelector('[data-testid="theme-css-editor"]') === null,
    'option A is a token map, and §5.5 puts the editor on the advanced switch',
  );

  fireEvent.click(modeButton(container, 'css'));
  fireEvent.click(buttonWithText(container, 'userThemes.trust.confirm'));

  assert.ok(
    container.querySelector('[data-testid="theme-css-editor"]'),
    'advanced mode has to reach for the editor rather than leave the box a plain textarea',
  );
});

test('a draft in advanced mode is put on the page and reported as a preview', async () => {
  const { container } = await openAdvancedMode();

  fireEvent.change(pasteBox(container), { target: { value: ':root { --draft: 1; }' } });
  await passPreviewDebounce();

  assert.equal(previewElement()?.textContent, ':root { --draft: 1; }');
  assert.ok(
    container.textContent?.includes('userThemes.previewing'),
    'the page changed, so the box has to say why — otherwise a preview reads as a saved theme',
  );
});

test('a draft that cannot be previewed says so and takes the previous one away', async () => {
  const { container } = await openAdvancedMode();

  fireEvent.change(pasteBox(container), { target: { value: ':root { --draft: 1; }' } });
  await passPreviewDebounce();
  assert.ok(previewElement(), 'the first draft was applied, so there is one to take away');

  fireEvent.change(pasteBox(container), { target: { value: '@import url("x.css");' } });
  await passPreviewDebounce();

  assert.ok(
    previewElement() === null,
    'a refused draft must not leave the previous one on the page — the author would read it as this one',
  );
  assert.ok(container.textContent?.includes('userThemes.previewUnavailable'));
  assert.ok(
    container.textContent?.includes('userThemes.reason.import-rule'),
    'and the reason is the same one a paste of this text would give',
  );
});

test('option A is not previewed and says nothing about previewing', async () => {
  const { container } = await renderSection();

  fireEvent.change(pasteBox(container), { target: { value: validTheme } });
  await passPreviewDebounce();

  assert.ok(previewElement() === null, '§5.5 puts the preview on the advanced switch');
  assert.equal(container.textContent?.includes('userThemes.previewing'), false);
});

/**
 * §5.10's contrast report for a theme *file* (2-L). The listing never reads
 * file content (2-D, deliberate), but the apply step does — and its report
 * rides the style state, which is what this section renders. The line these
 * tests hold: the report belongs to the file list only while a file is what
 * the page is wearing, and a paste's report keeps its own moment.
 */

test('the applied file theme\u2019s readability warnings are shown where the file is listed', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });
  const { container } = await renderSection([{ ...fileEntry, format: 'json', fileName: 'borealis.json' }]);

  fireEvent.click(buttonWithText(rowFor(container, 'Borealis'), 'userThemes.use'));
  await settle();

  const report = container.querySelector('[role="status"]');
  assert.ok(report, 'a warning with nowhere to appear is not a warning');
  assert.ok(report.textContent?.includes('userThemes.contrastTitle'));
  assert.ok(
    report.textContent?.includes('--primary-foreground'),
    'the report names the pair, the same one the console line names',
  );
});

test('a file theme with nothing to report puts no block in the file list', async () => {
  fileBody = JSON.stringify({ tokens: { '--term-background': '210 45% 8%' } });
  const { container } = await renderSection([{ ...fileEntry, format: 'json', fileName: 'borealis.json' }]);

  fireEvent.click(buttonWithText(rowFor(container, 'Borealis'), 'userThemes.use'));
  await settle();

  assert.ok(
    container.querySelector('[role="status"]') === null,
    'a block that always renders would teach the reader to ignore it',
  );
});

test('the file report follows the theme: picking another one takes it away', async () => {
  fileBody = JSON.stringify({ tokens: { '--primary': '175 84% 32%' } });
  const warned = { ...fileEntry, format: 'json' as const, fileName: 'borealis.json' };
  const clean = { ...fileEntry, id: 'user-nord', name: 'Nord', format: 'json' as const, fileName: 'nord.json' };
  const { container } = await renderSection([warned, clean]);

  fireEvent.click(buttonWithText(rowFor(container, 'Borealis'), 'userThemes.use'));
  await settle();
  assert.ok(container.querySelector('[role="status"]'), 'the warned theme is in force, so its report shows');

  fileBody = JSON.stringify({ tokens: { '--term-background': '210 45% 8%' } });
  fireEvent.click(buttonWithText(rowFor(container, 'Nord'), 'userThemes.use'));
  await settle();

  assert.ok(
    container.querySelector('[role="status"]') === null,
    'a report about the theme that just left would be read as one about the theme that just arrived',
  );
});

test('an applied paste keeps its report out of the file list', async () => {
  const { container } = await renderSection([], [pasteEntry], 'paste-1');
  await settle();

  assert.equal(document.documentElement.dataset.theme, 'paste-1');
  assert.ok(
    container.querySelector('[role="status"]') === null,
    'a paste\u2019s report has its own moment — right after the paste — and the file list is not it',
  );
});
