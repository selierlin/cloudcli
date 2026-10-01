import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { beforeEach, test, vi } from 'vitest';

import { useShellTerminal } from '@/modules/shell/hooks/useShellTerminal';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { FONT_SETTINGS_CHANGED_EVENT } from '@/shared/utils';
import { readFontSettings, writeFontSettings } from '@/shared/fontSettings';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * xterm is the one themed surface a stylesheet cannot reach: it paints into a
 * canvas and takes concrete colours rather than `var()` references, so the tokens
 * have to be re-read and pushed into `options.theme` whenever the applied theme
 * changes. The editor and the git graph are the opposite case and need no such
 * refresh — their colours are `var()` rules the browser re-resolves on its own.
 *
 * The same applies to the face: the grid is built from measured glyphs, so a new
 * font (from a theme or from Settings) has to be pushed in and re-fitted.
 *
 * `readTerminalTheme` is stubbed so the test can count reads: a sentinel per call
 * is what tells "the effect re-ran" apart from "it re-read the same values".
 * `resolveTerminalFontFamily` is stubbed for the same reason — it returns the
 * choice, so the test can name the face it expects to land in `options`.
 */

const reads = vi.hoisted(() => ({ count: 0, darkAtRead: [] as boolean[] }));

vi.mock('@/modules/shell/utils/terminalTheme', () => ({
  readTerminalTheme: () => {
    // The board is resolved from the cascade, so this records which appearance
    // the document was in when the read happened. `.dark` is `ThemeProvider`'s
    // writer, not the fixture's, so this is the ordering — see the test below.
    reads.darkAtRead.push(document.documentElement.classList.contains('dark'));
    return { background: `read-${(reads.count += 1)}` };
  },
  resolveTerminalFontFamily: (choice: string) => `stub-font-${choice}`,
  FALLBACK_TERMINAL_FONT_FAMILY: 'stub-fallback-stack',
}));

type StubTerminal = {
  options: { theme?: { background?: string }; fontFamily?: string; fontSize?: number };
  cols: number;
  rows: number;
  clearTextureAtlas?: () => void;
};

/**
 * The hook's other effects stay out of the way: the terminal-construction effect
 * bails out when a terminal is already in the ref (and when no container is
 * mounted), so no real xterm is built, and its cleanup is never registered.
 *
 * The refs are created once and closed over, the way `useRef` would hold them —
 * `terminalRef` is an effect dependency, so a fresh object per render would
 * rebuild the theme on every render and mask what the tests below measure.
 *
 * The stub starts out the way construction leaves a real terminal: font options
 * already resolved from the stored settings. Otherwise the mount-time face check
 * would see `undefined -> resolved` and re-fit, and every count below would carry
 * a stray first call.
 */
function renderTerminal() {
  const fit = vi.fn();
  const atlas = vi.fn();
  const sent: unknown[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => sent.push(JSON.parse(payload)),
  } as unknown as WebSocket;

  const terminal: StubTerminal = {
    options: { fontFamily: 'stub-font-theme', fontSize: 14 },
    cols: 80,
    rows: 24,
    clearTextureAtlas: atlas,
  };
  const terminalRef = { current: terminal as unknown as Terminal };
  const fitAddonRef = { current: { fit } as unknown as FitAddon | null };
  const wsRef = { current: socket };

  const view = renderHook(
    () => {
      const theme = useTheme();
      useShellTerminal({
        terminalContainerRef: { current: null },
        terminalRef,
        fitAddonRef,
        wsRef,
        selectedProject: null,
        minimal: false,
        isRestarting: false,
        closeSocket: () => {},
      });
      return theme;
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
    },
  );

  return { view, terminal, fit, sent, atlas };
}

beforeEach(() => {
  reads.count = 0;
  reads.darkAtRead = [];
  localStorage.clear();
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

test('an open terminal re-reads the board when an overlay theme is picked', () => {
  const { view, terminal } = renderTerminal();
  assert.equal(terminal.options.theme?.background, 'read-1');

  act(() => {
    view.result.current.setThemeId('cc-polar');
  });

  assert.equal(
    terminal.options.theme?.background,
    'read-2',
    'picking an overlay must repaint an already-running terminal',
  );
});

test('an open terminal re-reads the board when the overlay is cleared', () => {
  writeUserPreference('themeId', 'cc-polar');
  const { view, terminal } = renderTerminal();
  assert.equal(terminal.options.theme?.background, 'read-1');

  act(() => {
    view.result.current.setThemeId(null);
  });

  assert.equal(terminal.options.theme?.background, 'read-2');
});

test('an open terminal re-reads the board on an appearance flip', () => {
  const { view, terminal } = renderTerminal();
  assert.equal(terminal.options.theme?.background, 'read-1');

  act(() => {
    view.result.current.toggleDarkMode();
  });

  assert.equal(terminal.options.theme?.background, 'read-2');
});

/**
 * The three above only prove the effect *re-ran*; they say nothing about which
 * board it read, because the stub hands back a counter. The board comes from
 * the cascade, which means the read is only correct if the document is already
 * in the appearance being switched to.
 *
 * That is not free: `.dark` is written by `ThemeProvider`, and React runs a
 * descendant's passive effect before its ancestor's, so the terminal — a
 * descendant — reads before the class lands unless the writer runs in an
 * earlier phase. jsdom resolves no cascade, so this pins the ordering rather
 * than a colour: what the stub records is whether `.dark` was on `<html>`.
 */
test('the board is read after the appearance class has been applied', () => {
  const { view } = renderTerminal();
  assert.deepEqual(reads.darkAtRead, [false], 'the light board is read with .dark absent');

  act(() => {
    view.result.current.toggleDarkMode();
  });

  assert.deepEqual(
    reads.darkAtRead,
    [false, true],
    'the dark board must be read with .dark already on <html>',
  );

  act(() => {
    view.result.current.toggleDarkMode();
  });

  assert.deepEqual(
    reads.darkAtRead,
    [false, true, false],
    'and back again: .dark must be gone before the light board is read',
  );
});

/**
 * The guard that makes the three above mean something: they have to be measuring
 * the dependencies, not "every render re-reads". Nothing about the applied theme
 * changes here, so a read would be wasted work.
 */
test('a re-render that changes no theme does not re-read the board', () => {
  const { view } = renderTerminal();
  assert.equal(reads.count, 1);

  act(() => {
    view.rerender();
  });

  assert.equal(reads.count, 1, 'an unrelated re-render must not rebuild the terminal theme');
});

/**
 * A face change moves the glyph metrics, so a repaint is not enough: the grid has
 * to be re-measured and the pty told, or the remote side keeps rendering into the
 * old one. The atlas is dropped as well — its cache belongs to the face it was
 * built for.
 */
test('a font choice reaches the live terminal: face, atlas, fit and the pty', async () => {
  const { terminal, fit, sent, atlas } = renderTerminal();

  await act(async () => {
    writeFontSettings({ ...readFontSettings(), terminalFontFamily: 'fira-code' });
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  });

  assert.equal(terminal.options.fontFamily, 'stub-font-fira-code');
  assert.equal(fit.mock.calls.length, 1, 'a new face must re-fit the grid');
  assert.deepEqual(sent, [{ type: 'resize', cols: 80, rows: 24 }]);
  assert.equal(atlas.mock.calls.length, 1, 'the glyph atlas belongs to the face it was built for');
});

/**
 * The size path needs the same treatment as the face path — it moves the metrics
 * too. It used to refresh without fitting, which left the pty on the old grid.
 */
test('a terminal font-size change re-fits and tells the pty too', async () => {
  const { terminal, fit, sent } = renderTerminal();

  await act(async () => {
    writeFontSettings({ ...readFontSettings(), terminalFontSize: '20' });
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  });

  assert.equal(terminal.options.fontSize, 20);
  assert.equal(fit.mock.calls.length, 1);
  assert.deepEqual(sent, [{ type: 'resize', cols: 80, rows: 24 }]);
});

/**
 * The guard that makes the two above mean something: they must be measuring the
 * change, not "every font event re-fits". A no-op event should cost nothing.
 */
test('a font event that changes nothing does not re-fit', async () => {
  const { fit, sent } = renderTerminal();

  await act(async () => {
    window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
  });

  assert.equal(fit.mock.calls.length, 0);
  assert.deepEqual(sent, []);
});

/**
 * The order is the whole point of waiting: `fit()` measures glyphs, so fitting
 * before the face lands sizes the grid for the fallback. jsdom has no
 * `FontFaceSet`, so this stubs one — which also makes the optional call in the
 * hook observable at all.
 */
test('a face change waits for the font before re-fitting', async () => {
  const order: string[] = [];
  const load = vi.fn(async () => {
    order.push('load');
    return [];
  });
  const fonts = document as unknown as { fonts?: unknown };
  fonts.fonts = { load };

  try {
    const { fit } = renderTerminal();
    fit.mockImplementation(() => {
      order.push('fit');
    });

    await act(async () => {
      writeFontSettings({ ...readFontSettings(), terminalFontFamily: 'jetbrains-mono' });
      window.dispatchEvent(new Event(FONT_SETTINGS_CHANGED_EVENT));
    });

    assert.deepEqual(load.mock.calls[0], ['14px stub-font-jetbrains-mono']);
    assert.deepEqual(order, ['load', 'fit'], 'the grid must be measured once the face is in');
  } finally {
    delete fonts.fonts;
  }
});
