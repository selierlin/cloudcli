import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import {
  buildTokenGroups,
  readTokenSnapshot,
  SEMANTIC_GROUP,
  swatchColorFor,
  tokenGroupId,
} from '@/shared/tokenSnapshot';

/**
 * The token snapshot, against a fake computed style.
 *
 * jsdom does not cascade, so `getComputedStyle` is stood in with a fake that
 * answers from one of two maps keyed on the `.dark` class — the same contract
 * the real engine gives (the class is the only thing scoping the two
 * appearances). What the fakes cannot stand in for is the *restoration*: that
 * the class the read found is the class the page keeps, which is asserted
 * directly here and, for a real engine, in the fixture spec.
 */

const LIGHT: Record<string, string> = {
  '--background': '10 20% 30%',
  '--muted-foreground': '25 5% 45%',
  '--palette-brand-500': '221.2 83.2% 53.3%',
  '--editor-bg': '#282c34',
  '--tw-ring-color': 'rgb(59 130 246 / 0.5)',
  '--font-ui': 'ui-sans-serif, system-ui',
  color: 'rgb(0, 0, 0)',
};

const DARK: Record<string, string> = {
  '--background': '210 45% 8%',
  '--muted-foreground': '25 5% 45%',
  '--palette-brand-500': '217.2 91.2% 59.8%',
  '--editor-bg': '#1e1e1e',
  '--tw-ring-color': 'rgb(59 130 246 / 0.5)',
  '--font-ui': 'ui-sans-serif, system-ui',
  '--dark-only': '0 0% 1%',
  color: 'rgb(255, 255, 255)',
};

function fakeDeclaration(values: Record<string, string>): CSSStyleDeclaration {
  const names = Object.keys(values);
  const declaration = {
    getPropertyValue: (name: string) => values[name] ?? '',
    length: names.length,
  } as unknown as Record<string | number, unknown>;
  names.forEach((name, index) => {
    declaration[index] = name;
  });
  return declaration as unknown as CSSStyleDeclaration;
}

const mockComputed = () =>
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() =>
    fakeDeclaration(document.documentElement.classList.contains('dark') ? DARK : LIGHT),
  );

let spy: ReturnType<typeof mockComputed> | undefined;

beforeEach(() => {
  document.documentElement.className = '';
  spy = mockComputed();
});

afterEach(() => {
  spy?.mockRestore();
  spy = undefined;
});

test('the snapshot carries both appearances and the groups arrive in table order', () => {
  const snapshot = readTokenSnapshot();

  const semantic = snapshot.groups[0];
  assert.equal(semantic.id, SEMANTIC_GROUP, 'the L2 surface is what readers reason about, so it is first');
  const background = semantic.entries.find((entry) => entry.name === '--background');
  assert.ok(background);
  assert.equal(background.light, '10 20% 30%');
  assert.equal(background.dark, '210 45% 8%');

  const ids = snapshot.groups.map((group) => group.id);
  assert.ok(ids.indexOf('palette') > 0 && ids.indexOf('editor') > 0, 'families follow the semantic group');
  assert.ok(ids.indexOf('palette') < ids.indexOf('editor'), 'table order, not map order');

  assert.equal(
    snapshot.tokenCount,
    new Set(
      [...Object.keys(LIGHT), ...Object.keys(DARK)].filter((name) => name.startsWith('--')),
    ).size,
    'every name either scope resolves is in the snapshot exactly once',
  );

  const names = new Set(snapshot.groups.flatMap((group) => group.entries.map((entry) => entry.name)));
  assert.equal(
    names.has('color'),
    false,
    'a computed style carries hundreds of standard properties; the preview is custom properties only',
  );
});

test('the read restores the appearance it found, from either side', () => {
  readTokenSnapshot();
  assert.equal(
    document.documentElement.classList.contains('dark'),
    false,
    'a light page stays light after the read',
  );

  document.documentElement.classList.add('dark');
  const snapshot = readTokenSnapshot();
  assert.equal(
    document.documentElement.classList.contains('dark'),
    true,
    'a dark page stays dark after the read — the flip exists only inside the task',
  );
  // The same read from the dark side must also produce the dark-side values:
  // the mutation that skips the flip lives in the branch only this side runs.
  const semantic = snapshot.groups.find((group) => group.id === SEMANTIC_GROUP);
  const background = semantic?.entries.find((entry) => entry.name === '--background');
  assert.equal(background?.dark, '210 45% 8%', 'the dark column is the dark value, not the light one');
  assert.equal(background?.light, '10 20% 30%', 'and the light column is still the light value');
});

test('a token only one scope declares shows an empty other side', () => {
  const snapshot = readTokenSnapshot();
  const semantic = snapshot.groups.find((group) => group.id === SEMANTIC_GROUP);
  const darkOnly = semantic?.entries.find((entry) => entry.name === '--dark-only');
  assert.ok(darkOnly, 'the union of both scopes is enumerated, not the intersection');
  assert.equal(darkOnly.dark, '0 0% 1%');
  assert.equal(darkOnly.light, '');
  assert.equal(darkOnly.lightSwatch, null);
  assert.equal(darkOnly.darkSwatch, 'hsl(0 0% 1%)');
});

test('entries inside a group are sorted by name', () => {
  const snapshot = readTokenSnapshot();
  const semantic = snapshot.groups.find((group) => group.id === SEMANTIC_GROUP);
  const names = semantic?.entries.map((entry) => entry.name) ?? [];
  assert.deepEqual(names, [...names].sort());
});

test('grouping routes by known prefix and leaves the rest to the semantic group', () => {
  assert.equal(tokenGroupId('--palette-brand-500'), 'palette');
  assert.equal(tokenGroupId('--editor-bg'), 'editor');
  assert.equal(tokenGroupId('--tw-ring-color'), 'tw');
  assert.equal(tokenGroupId('--background'), SEMANTIC_GROUP);
  assert.equal(tokenGroupId('--muted-foreground'), SEMANTIC_GROUP, 'the L2 surface has no family prefix');
  assert.equal(tokenGroupId('--palette'), SEMANTIC_GROUP, 'the name must be the prefix plus more, not the prefix alone');
});

test('swatches: wrapped triplets, verbatim colours, null for everything else', () => {
  assert.equal(swatchColorFor('221.2 83.2% 53.3%'), 'hsl(221.2 83.2% 53.3%)');
  assert.equal(swatchColorFor('175 84% 32% / 0.5'), 'hsl(175 84% 32% / 0.5)');
  assert.equal(swatchColorFor('#282c34'), '#282c34');
  assert.equal(swatchColorFor('rgb(59 130 246 / 0.5)'), 'rgb(59 130 246 / 0.5)');
  assert.equal(swatchColorFor('hsl(175 84% 32%)'), 'hsl(175 84% 32%)');
  assert.equal(swatchColorFor('ui-sans-serif, system-ui'), null, 'a font stack is not a colour');
  assert.equal(swatchColorFor('2.5'), null);
  assert.equal(swatchColorFor(''), null);
});

test('buildTokenGroups takes the maps directly, so the grouping is checkable without a DOM', () => {
  const light = new Map([['--background', '10 20% 30%']]);
  const dark = new Map([['--background', '210 45% 8%']]);
  const snapshot = buildTokenGroups(light, dark);
  assert.equal(snapshot.groups.length, 1);
  assert.equal(snapshot.groups[0].entries[0].lightSwatch, 'hsl(10 20% 30%)');
  assert.equal(snapshot.groups[0].entries[0].darkSwatch, 'hsl(210 45% 8%)');
});
