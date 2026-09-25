import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { beforeEach, test, vi } from 'vitest';

import { useShellTerminal } from '@/modules/shell/hooks/useShellTerminal';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * xterm is the one themed surface a stylesheet cannot reach: it paints into a
 * canvas and takes concrete colours rather than `var()` references, so the tokens
 * have to be re-read and pushed into `options.theme` whenever the applied theme
 * changes. The editor and the git graph are the opposite case and need no such
 * refresh — their colours are `var()` rules the browser re-resolves on its own.
 *
 * `readTerminalTheme` is stubbed so the test can count reads: a sentinel per call
 * is what tells "the effect re-ran" apart from "it re-read the same values".
 */

const reads = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/modules/shell/utils/terminalTheme', () => ({
  readTerminalTheme: () => ({ background: `read-${(reads.count += 1)}` }),
}));

type StubTerminal = { options: { theme?: { background?: string } } };

/**
 * The hook's other effects stay out of the way: the terminal-construction effect
 * bails out when a terminal is already in the ref (and when no container is
 * mounted), so no real xterm is built, and its cleanup is never registered.
 *
 * The refs are created once and closed over, the way `useRef` would hold them —
 * `terminalRef` is an effect dependency, so a fresh object per render would
 * rebuild the theme on every render and mask what the tests below measure.
 */
function renderTerminal() {
  const terminal: StubTerminal = { options: {} };
  const terminalRef = { current: terminal as unknown as Terminal };

  const view = renderHook(
    () => {
      const theme = useTheme();
      useShellTerminal({
        terminalContainerRef: { current: null },
        terminalRef,
        fitAddonRef: { current: null as unknown as FitAddon | null },
        wsRef: { current: null },
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

  return { view, terminal };
}

beforeEach(() => {
  reads.count = 0;
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
