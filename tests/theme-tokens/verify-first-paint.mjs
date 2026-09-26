/**
 * Behavioural check for the first-paint chrome in `index.html`.
 *
 * `first-paint.spec.ts` reads the source text, which proves the document is wired
 * consistently but not that the inline script behaves. This script loads the real
 * `index.html` in Chromium and checks the four things the script has to get right,
 * across every combination of OS appearance and stored preference:
 *
 * 1. `<html data-appearance>` matches the stored pick, or the OS preference when
 *    there is none.
 * 2. `color-scheme` follows the same value, so native controls agree.
 * 3. Exactly one `theme-color` meta is left: the script removes the media-scoped
 *    fallbacks rather than leaving the browser two to choose between.
 * 4. That meta's colour equals the splash's computed background — the status bar
 *    and the launch screen must not contradict each other.
 *
 * The fixture in this directory cannot cover this: it imports the stylesheet, not
 * the document, so nothing else in the suite ever executes the inline script.
 *
 * Run from the repo root:
 *
 *   node tests/theme-tokens/verify-first-paint.mjs
 */

import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = `file://${fileURLToPath(new URL('../../index.html', import.meta.url))}`;

/** `rgb(r, g, b)` (what `getComputedStyle` reports) as the `#rrggbb` a meta holds. */
function rgbToHex(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

const browser = await chromium.launch();
const failures = [];

console.log('OS scheme | stored pref | data-appearance | theme-color | splash bg');
for (const scheme of ['dark', 'light']) {
  for (const pref of [null, 'light', 'dark']) {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    if (pref) {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem('theme', value);
        } catch (error) {
          // `file://` may block storage; the fallback is then what we observe.
        }
      }, pref);
    }

    await page.goto(url);
    const observed = await page.evaluate(() => ({
      appearance: document.documentElement.dataset.appearance,
      colorScheme: document.documentElement.style.colorScheme,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
      metas: document.querySelectorAll('meta[name="theme-color"]').length,
      splashBackground: getComputedStyle(document.getElementById('app-splash')).backgroundColor,
    }));
    await context.close();

    const expected = pref ?? scheme;
    const where = `OS=${scheme} pref=${pref ?? '(none)'}`;

    if (observed.appearance !== expected) {
      failures.push(`${where}: data-appearance is ${observed.appearance}, expected ${expected}`);
    }
    if (observed.colorScheme !== expected) {
      failures.push(`${where}: color-scheme is ${observed.colorScheme}, expected ${expected}`);
    }
    if (observed.metas !== 1) {
      failures.push(`${where}: ${observed.metas} theme-color metas, expected 1`);
    }
    const splashHex = rgbToHex(observed.splashBackground);
    if (observed.themeColor !== splashHex) {
      failures.push(
        `${where}: theme-color ${observed.themeColor} disagrees with the splash background ${splashHex}`,
      );
    }

    console.log(
      [
        scheme.padEnd(9),
        String(pref ?? '(none)').padEnd(11),
        String(observed.appearance).padEnd(15),
        String(observed.themeColor).padEnd(11),
        `${observed.splashBackground} (${observed.metas} meta)`,
      ].join(' | '),
    );
  }
}

await browser.close();

if (failures.length > 0) {
  console.error(`\nfirst-paint failures:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nAll six combinations agree.');
