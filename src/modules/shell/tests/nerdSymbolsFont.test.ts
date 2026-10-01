import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NERD_SYMBOLS_CODEPOINT_RANGES,
  NERD_SYMBOLS_FONT_FAMILY,
  ensureNerdSymbolsFont,
} from '@/modules/shell/utils/nerdSymbolsFont';
import { CODE_FONT_FAMILY_CSS } from '@/shared/utils';
import { FALLBACK_TERMINAL_FONT_FAMILY } from '@/modules/shell/utils/terminalTheme';

/** The quoted spelling the stacks use for the bundled face. */
const QUOTED_FACE = `"${NERD_SYMBOLS_FONT_FAMILY}"`;

type FakeFace = { family: string; loaded: Promise<unknown> };

function stubFontEnvironment(options: {
  fetchImpl?: (url: string) => Promise<Response>;
  faceFactory?: (family: string, source: ArrayBuffer) => FakeFace;
}): { added: FakeFace[] } {
  const added: FakeFace[] = [];
  const fonts = {
    add: (face: unknown) => {
      added.push(face as FakeFace);
    },
    check: () => false,
  };
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  vi.stubGlobal(
    'FontFace',
    options.faceFactory ??
      ((family: string, source: ArrayBuffer) => ({
        family,
        source,
        loaded: Promise.resolve(),
      })),
  );
  if (options.fetchImpl) {
    vi.stubGlobal('fetch', options.fetchImpl);
  }
  return { added };
}

describe('nerd symbols font', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Drop the module-level install cache so each test starts clean.
    vi.resetModules();
    delete (document as { fonts?: unknown }).fonts;
  });

  it('keeps every terminal stack ending in the bundled face before the generic monospace', () => {
    for (const stack of Object.values(CODE_FONT_FAMILY_CSS)) {
      const tail = stack.slice(stack.indexOf(QUOTED_FACE));
      expect(tail).toBe(`${QUOTED_FACE}, monospace`);
    }
    expect(FALLBACK_TERMINAL_FONT_FAMILY.slice(
      FALLBACK_TERMINAL_FONT_FAMILY.indexOf(QUOTED_FACE),
    )).toBe(`${QUOTED_FACE}, monospace`);
  });

  it('declares exactly the two PUA icon blocks the asset was subsetted to', () => {
    expect(NERD_SYMBOLS_CODEPOINT_RANGES).toEqual([
      [0xe000, 0xf8ff],
      [0xf0000, 0xffffd],
    ]);
  });

  it('registers the face once and reuses the install across calls', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 })),
    );
    stubFontEnvironment({ fetchImpl });

    await ensureNerdSymbolsFont();
    await ensureNerdSymbolsFont();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately without a FontFaceSet (jsdom, legacy engines)', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    delete (document as { fonts?: unknown }).fonts;

    await expect(ensureNerdSymbolsFont()).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stays silent when the fetch fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFontEnvironment({
      fetchImpl: () => Promise.reject(new TypeError('offline')),
    });

    await expect(ensureNerdSymbolsFont()).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('resolves after the timeout while the install keeps running', async () => {
    vi.useFakeTimers();
    let releaseFetch: (() => void) | undefined;
    stubFontEnvironment({
      fetchImpl: () =>
        new Promise<Response>((resolve) => {
          releaseFetch = () =>
            resolve(new Response(new ArrayBuffer(8), { status: 200 }));
        }),
    });

    let settled = false;
    const install = ensureNerdSymbolsFont().then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(true);

    // The abandoned install still finishes and adds the face: a later font
    // change re-loads the stack and picks it up mid-session.
    releaseFetch?.();
    await vi.runAllTimersAsync();
    await install;
  });
});
