/**
 * Registers the bundled Nerd Symbols face and exposes its family name.
 *
 * Shell icons (starship prompt glyphs, `eza --icons` file marks, powerline
 * segments) live in the Unicode Private Use Area: no system font carries them
 * unless the viewer installed a Nerd Font, and the renderer answers with a
 * fallback glyph (the "tofu" box) for every missing one. The bundled face is a
 * subset of nerd-fonts' `SymbolsNerdFontMono` (v3.5.1, MIT) trimmed to the two
 * PUA icon blocks, so a stock browser — iOS Safari included — can render them
 * without anything installed locally.
 *
 * The face name is appended to the tail of every terminal font stack (see
 * `CODE_FONT_FAMILY_CSS` and `FALLBACK_TERMINAL_FONT_FAMILY`): families are
 * tried per glyph, so a real Nerd Font installed on the machine wins and this
 * face only answers for glyphs nothing earlier covers.
 */
import nerdSymbolsFontUrl from '@/modules/shell/assets/nerd-symbols.woff2';

export const NERD_SYMBOLS_FONT_FAMILY = 'CloudCLI Nerd Symbols';

/** A face that never arrives must not hold the terminal hostage. */
const INSTALL_TIMEOUT_MS = 3000;

type FontsApi = {
  add: (face: unknown) => void;
  check: (font: string, text?: string) => boolean;
};

/**
 * The PUA icon blocks the subset carries. Exported for tests: the assertion is
 * not about the literal numbers but that they stay in sync with what was
 * subsetted into the asset (U+E000-F8FF plus U+F0000-FFFFD, nerd-fonts v3
 * layout) — a wider or narrower trim changes this pair with it.
 */
export const NERD_SYMBOLS_CODEPOINT_RANGES: ReadonlyArray<
  readonly [start: number, end: number]
> = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
];

function readFontsApi(): FontsApi | null {
  // jsdom (the vitest environment) has no FontFaceSet; the terminal falls back
  // to whatever the test stubs answer and never needs real glyphs.
  if (typeof document === 'undefined' || !document.fonts) {
    return null;
  }
  return document.fonts as unknown as FontsApi;
}

let installPromise: Promise<void> | null = null;

function installFace(fonts: FontsApi): Promise<void> {
  return fetch(nerdSymbolsFontUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const source = await response.arrayBuffer();
      // No `unicode-range`: the default full range keeps `FontFaceSet.load`
      // treating this face as a candidate for any text, which is what the
      // font-ready wait below relies on to have fetched it before fitting.
      const face = new FontFace(NERD_SYMBOLS_FONT_FAMILY, source);
      await face.load();
      fonts.add(face);
    });
}

/**
 * Make the face usable, at most once per page load.
 *
 * Resolving does not guarantee the face is in: an offline fetch rejects, the
 * timeout gives up waiting (the install itself keeps running and adds the face
 * whenever it lands — later font changes pick it up), and browsers without the
 * API resolve immediately. Every failure path stays silent on purpose: icons
 * degrade to tofu, never to a broken terminal.
 */
export function ensureNerdSymbolsFont(): Promise<void> {
  const fonts = readFontsApi();
  if (!fonts || typeof FontFace === 'undefined' || typeof fetch === 'undefined') {
    return Promise.resolve();
  }
  if (!installPromise) {
    installPromise = Promise.race([
      installFace(fonts),
      new Promise<void>((resolve) => {
        setTimeout(resolve, INSTALL_TIMEOUT_MS);
      }),
    ]).catch(() => {
      // Keep the settled promise cached: a failed install must not re-fetch a
      // 1.2 MB asset on every settings change for the rest of the session.
    });
  }
  return installPromise;
}
