import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The first-paint chrome contract.
 *
 * Every other suite in this directory applies the theme from JavaScript, which
 * means it only exists once the bundle has downloaded. Before that the page is a
 * static document: the splash paints from literals in `index.html`, and the
 * browser chrome takes its colour from a `<meta name="theme-color">` that no
 * token can reach yet. Those two are on screen together — the splash covers the
 * viewport, the status bar sits above it — so the invariant that has to hold is
 * that they **agree**. A dark launch screen under a white status bar is the bug
 * this file pins.
 *
 * There are three writers of each appearance's colour: the inline script at the
 * end of `<head>` (which resolves the appearance and rewrites the meta), the
 * splash rules (which select on `<html data-appearance>`), and the media-scoped
 * metas left as the no-script fallback. Pinning each occurrence to a literal
 * would keep passing after one of them drifted, so the assertion is that the
 * value is **the same everywhere it appears** — the agreement is the contract,
 * not any particular hex.
 *
 * What this does not prove: the script's *behaviour*, which would need a browser
 * loading the real document. It is a structural guard over the source, in the
 * same shape as the `@layer` check in `theme-overlays.spec.ts`.
 */

const HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

type Appearance = 'light' | 'dark';

const APPEARANCES: Appearance[] = ['light', 'dark'];

/** The `#rrggbb` a declaration carries, or null when the property is absent. */
function declaration(selector: string, property: string): string | null {
  const start = HTML.indexOf(`${selector} {`);
  if (start === -1) return null;

  const body = HTML.slice(start, HTML.indexOf('}', start));
  return new RegExp(`(?:^|[;{\\s])${property}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(body)?.[1] ?? null;
}

/** The selector the splash rule for one appearance is declared under. */
function splashSelector(appearance: Appearance, on: string): string {
  return appearance === 'light' ? `:root[data-appearance='light'] ${on}` : on;
}

/** The two colours the inline script resolves, in source order. */
function scriptColours(): Record<Appearance, string> {
  const match =
    /var\s+colour\s*=\s*pref\s*===\s*'dark'\s*\?\s*'(#[0-9a-fA-F]{3,8})'\s*:\s*'(#[0-9a-fA-F]{3,8})'/.exec(
      HTML,
    );
  if (!match) {
    throw new Error('the inline script no longer resolves one colour per appearance');
  }

  return { dark: match[1], light: match[2] };
}

/** Every `theme-color` meta, with the appearance its `media` scopes it to. */
function themeColorMetas(): { media: string | null; content: string }[] {
  return [...HTML.matchAll(/<meta\s+name="theme-color"([^>]*?)\/?>/g)].map((match) => ({
    media: /media="\(prefers-color-scheme:\s*(\w+)\)"/.exec(match[1])?.[1] ?? null,
    content: /content="([^"]+)"/.exec(match[1])?.[1] ?? '',
  }));
}

/** WCAG 2.x relative luminance of a `#rrggbb` literal. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, order-independent. */
function contrast(one: string, other: string): number {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('the first-paint theme-color agrees with the splash in both appearances', () => {
  const colours = scriptColours();
  const metas = themeColorMetas();

  const disagreements: string[] = [];
  const missing: string[] = [];

  for (const appearance of APPEARANCES) {
    const writers: [string, string | null][] = [
      ['the inline script', colours[appearance]],
      ["the splash's rule", declaration(splashSelector(appearance, '#app-splash'), 'background')],
      [
        'the media-scoped meta',
        metas.find((meta) => meta.media === appearance)?.content ?? null,
      ],
    ];

    for (const [label, value] of writers) {
      if (value === null) missing.push(`${appearance}: ${label} declares no colour`);
    }

    const values = new Set(writers.map(([, value]) => value).filter((value) => value !== null));
    if (values.size > 1) {
      disagreements.push(
        `${appearance}: ${writers.map(([label, value]) => `${label}=${value}`).join(', ')}`,
      );
    }
  }

  expect(
    missing,
    `the first-paint colour went missing from one of its writers:\n${missing.join('\n')}`,
  ).toEqual([]);
  expect(
    disagreements,
    `the first-paint chrome contradicts the splash (the status bar and the launch screen would ` +
      `not match):\n${disagreements.join('\n')}`,
  ).toEqual([]);
});

/**
 * The three consumers the script has to reach, and the source it reads.
 *
 * The key is spelled out because it is the same one `ThemeContext` reads; a
 * typo here would be invisible at runtime (the script would fall back to the OS
 * preference and only disagree with the app for a manual pick).
 *
 * The `remove()` loop matters as much as the insert: the media-scoped metas
 * above are declaration-only fallbacks, and leaving them in place would put two
 * `theme-color` tags in the document for the browser to choose between.
 */
test('the inline script resolves the appearance for all of its consumers', () => {
  const required: [string, RegExp][] = [
    ['reads the key ThemeContext reads', /localStorage\.getItem\('theme'\)/],
    ['falls back to the OS preference', /matchMedia\('\(prefers-color-scheme:\s*dark\)'\)/],
    ['marks the appearance for the splash', /dataset\.appearance\s*=/],
    ['hands the appearance to the UA', /style\.colorScheme\s*=/],
    // The call to `remove()` is part of the pattern: selecting the fallbacks and
    // then not removing them leaves two metas in the document, which is the
    // failure this line exists to catch.
    ['removes the fallback metas', /querySelectorAll\('meta\[name="theme-color"\]'\)[\s\S]*?\.remove\(\)/],
    ['writes one exact meta', /createElement\('meta'\)/],
  ];

  const absent = required
    .filter(([, pattern]) => !pattern.test(HTML))
    .map(([label]) => label);

  expect(absent, `the first-paint script no longer:\n${absent.join('\n')}`).toEqual([]);
});

/**
 * No `theme-color` may be declared outside a media query.
 *
 * A plain one is the shape the stale `#ffffff` had: it wins for every
 * appearance, so it contradicts the splash on one of them no matter what it is
 * set to. Only the script is allowed to write an unqualified value, and it does
 * so at runtime.
 */
test('every declared theme-color is scoped to an appearance', () => {
  const unscoped = themeColorMetas()
    .filter((meta) => meta.media === null)
    .map((meta) => meta.content);

  expect(
    unscoped,
    `index.html declares a theme-color that applies to every appearance, so it cannot match the ` +
      `splash in all of them: ${unscoped.join(', ')}`,
  ).toEqual([]);
});

/**
 * The splash is the first thing a user sees, so it carries the same floor as
 * the rest of the surface — and its colours are literals no other suite reads.
 */
test('the splash colours clear WCAG on their own background', () => {
  const SPLASH_INK: { on: string; property: string; min: number }[] = [
    { on: '#app-splash', property: 'color', min: 4.5 },
    { on: '.splash-sub', property: 'color', min: 4.5 },
    { on: '.splash-spinner', property: 'border-top-color', min: 3 },
  ];

  const failures: string[] = [];
  for (const appearance of APPEARANCES) {
    const surface = declaration(splashSelector(appearance, '#app-splash'), 'background');

    for (const { on, property, min } of SPLASH_INK) {
      const ink = declaration(splashSelector(appearance, on), property);
      if (!ink || !surface) {
        failures.push(`${appearance} ${on}: no ${property} (ink ${ink}) on ${surface}`);
        continue;
      }

      const ratio = contrast(ink, surface);
      if (ratio < min) {
        failures.push(`${appearance} ${on} ${property} on ${surface}: ${ratio.toFixed(2)}:1 < ${min}:1`);
      }
    }
  }

  expect(failures, `splash contrast failures:\n${failures.join('\n')}`).toEqual([]);
});
