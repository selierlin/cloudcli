import assert from 'node:assert/strict';

import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import type { MutableRefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useShellConnection } from '@/modules/shell/hooks/useShellConnection';
import { useShellRuntime } from '@/modules/shell/hooks/useShellRuntime';
import { useShellTerminal } from '@/modules/shell/hooks/useShellTerminal';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { TERMINAL_INIT_DELAY_MS } from '@/shared/constants';
import type { Project, ProjectSession } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * The Shell tab used to build xterm from one hard-coded dark palette, so the
 * app's light/dark toggle never reached the terminal (#1335). Three things have
 * to hold: a terminal opens in the app's current theme, a toggle repaints the
 * terminal that is already open instead of rebuilding it (which would close the
 * socket and drop the running session), and the CLI started behind it is told
 * which scheme it is being drawn in.
 */

type FakeTerminal = {
  options: {
    theme?: ITheme;
  };
  disposed: boolean;
};

const { terminals } = vi.hoisted(() => ({ terminals: [] as FakeTerminal[] }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    disposed = false;

    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      terminals.push(this as unknown as FakeTerminal);
    }

    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onData() {
      return { dispose() {} };
    }
    getSelection() {
      return '';
    }
    hasSelection() {
      return false;
    }
    clear() {}
    write() {}
    refresh() {}
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('@/modules/shell/utils/mobileTerminalSelection', () => ({
  installMobileTerminalSelection: () => ({ dispose() {} }),
  // The terminal hook asks before installing touch selection; a desktop test
  // must answer false, and the mock has to export it or the import throws.
  isTouchSelectionEnvironment: () => false,
}));
// Only the URL builder is stubbed: it reads a stored auth token and would bail
// before a socket is ever constructed.
vi.mock('@/modules/shell/utils/socket', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getShellWebSocketUrl: () => 'ws://localhost/shell',
}));

// jsdom ships no ResizeObserver, and the terminal hook observes its container.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;

  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor() {
    FakeSocket.last = this;
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
  }
}

const project = {
  projectId: 'demo',
  name: 'demo',
  displayName: 'demo',
  path: '/tmp/demo',
  fullPath: '/tmp/demo',
} as Project;

const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value });

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(ThemeProvider, null, children);

/** Mounts the terminal hook inside the real ThemeProvider; `result.current` is the theme context. */
function renderShellTerminal() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const closeSocket = vi.fn();

  const view = renderHook(
    () => {
      const theme = useTheme();
      const terminalContainerRef = React.useRef<HTMLDivElement>(container);
      const terminalRef = React.useRef<Terminal | null>(null);
      const fitAddonRef = React.useRef<FitAddon | null>(null);
      const wsRef = React.useRef<WebSocket | null>(null);

      useShellTerminal({
        terminalContainerRef,
        terminalRef,
        fitAddonRef,
        wsRef,
        selectedProject: project,
        minimal: false,
        isRestarting: false,
        closeSocket,
      });

      return theme;
    },
    { wrapper },
  );

  return { ...view, closeSocket };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('WebSocket', FakeSocket);
  localStorage.clear();
  // The preference store is a module-level singleton that outlives localStorage.clear().
  resetUserPreferences();
  document.documentElement.classList.remove('dark');
  document.body.innerHTML = '';
  terminals.length = 0;
  FakeSocket.last = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('builds the terminal with the board resolved from the stylesheet', () => {
  writeUserPreference('theme', 'light');

  renderShellTerminal();

  assert.equal(terminals.length, 1);
  // jsdom has no cascade, so `readTerminalTheme` cannot resolve `--term-*` here
  // — the resolved board (and its light-half contrast) is pinned in a real
  // browser by `tests/theme-tokens/terminal-tokens.spec.ts`. What stays
  // unit-testable is that the constructor asks for a board instead of falling
  // back to xterm's own default palette.
  assert.ok(terminals[0].options.theme);
  assert.ok(Object.keys(terminals[0].options.theme ?? {}).length > 0);
});

test('toggling the theme repaints the open terminal without rebuilding it or closing its socket', () => {
  writeUserPreference('theme', 'light');
  const { result, closeSocket } = renderShellTerminal();
  const lightTheme = terminals[0].options.theme;

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(terminals.length, 1, 'a theme switch must not create a second terminal');
  assert.equal(terminals[0].disposed, false, 'the running terminal must not be disposed');
  assert.equal(closeSocket.mock.calls.length, 0, 'the pty socket must stay open');
  assert.notStrictEqual(terminals[0].options.theme, lightTheme, 'a repaint re-reads the board');

  act(() => {
    result.current.toggleDarkMode();
  });

  assert.equal(terminals.length, 1);
});

test('the shell init message tells the server which colour scheme the terminal is in', () => {
  vi.useFakeTimers();
  const isDarkModeRef = ref(false);

  const view = renderHook(() =>
    useShellConnection({
      wsRef: ref<WebSocket | null>(null),
      terminalRef: ref({ write: vi.fn(), cols: 80, rows: 24 } as unknown as Terminal | null),
      fitAddonRef: ref({ fit: vi.fn() } as unknown as FitAddon | null),
      selectedProjectRef: ref<Project | null | undefined>(project),
      selectedSessionRef: ref<ProjectSession | null | undefined>(null),
      initialCommandRef: ref<string | null | undefined>(null),
      isPlainShellRef: ref(false),
      bypassPermissionsRef: ref(false),
      isDarkModeRef,
      onProcessCompleteRef: ref<((exitCode: number) => void) | null | undefined>(null),
      isInitialized: true,
      autoConnect: false,
      closeSocket: vi.fn(),
      clearTerminalScreen: vi.fn(),
    }),
  );

  act(() => {
    view.result.current.connectToShell();
  });
  act(() => {
    FakeSocket.last?.onopen?.();
    vi.advanceTimersByTime(TERMINAL_INIT_DELAY_MS);
  });

  const initFrame = JSON.parse(FakeSocket.last?.sent[0] ?? '{}') as Record<string, unknown>;
  assert.equal(initFrame.type, 'init');
  assert.equal(initFrame.colorScheme, 'light');
});

type ShellRuntimeView = {
  runtime: ReturnType<typeof useShellRuntime>;
  theme: ReturnType<typeof useTheme>;
};

/** Renders the shell runtime with a real terminal container, the way Shell does. */
function ShellRuntimeHarness({ onRender }: { onRender: (view: ShellRuntimeView) => void }) {
  const theme = useTheme();
  const runtime = useShellRuntime({
    selectedProject: project,
    selectedSession: null,
    initialCommand: null,
    isPlainShell: false,
    bypassPermissions: false,
    minimal: false,
    autoConnect: false,
    isRestarting: false,
  });
  React.useEffect(() => {
    onRender({ runtime, theme });
  });
  return React.createElement('div', { ref: runtime.terminalContainerRef });
}

/** Mounts the harness; the returned getter reads the latest committed render. */
function renderShellRuntime(): () => ShellRuntimeView {
  let latest: ShellRuntimeView | null = null;
  const onRender = (view: ShellRuntimeView) => {
    latest = view;
  };
  render(React.createElement(ThemeProvider, null, React.createElement(ShellRuntimeHarness, { onRender })));
  return () => latest as unknown as ShellRuntimeView;
}

/** Opens a shell socket and returns a function that plays the server's launch-theme frame. */
function connectShell(current: () => ShellRuntimeView) {
  act(() => {
    current().runtime.connectToShell();
  });
  const socket = FakeSocket.last as FakeSocket;
  act(() => {
    socket.onopen?.();
    vi.advanceTimersByTime(TERMINAL_INIT_DELAY_MS);
  });
  const reportLaunchTheme = (colorScheme: string) =>
    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'claude_theme', colorScheme }) });
    });
  return { socket, reportLaunchTheme };
}

// A running Claude CLI keeps the colours it was launched with, so right after a
// toggle it still shows the look the theme was changed away from (#1335).
test('a Claude CLI launched in the other theme asks for a restart until the themes match', () => {
  vi.useFakeTimers();
  writeUserPreference('theme', 'light');
  const current = renderShellRuntime();
  const { socket, reportLaunchTheme } = connectShell(current);
  const toggle = () =>
    act(() => {
      current().theme.toggleDarkMode();
    });

  reportLaunchTheme('light');
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'launched in the current theme');

  toggle();
  assert.equal(current().runtime.isClaudeThemeOutdated, true, 'the CLI still draws its light theme');

  toggle();
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'back in the theme it launched in');

  toggle();
  assert.equal(current().runtime.isClaudeThemeOutdated, true);

  // Restart: the old socket closes, and the new launch reports the current theme.
  act(() => {
    socket.onclose?.();
  });
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'no CLI is running');
  connectShell(current).reportLaunchTheme('dark');
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'the restarted CLI matches');
});

test('a reattached CLI started in the other theme asks for a restart at once', () => {
  vi.useFakeTimers();
  writeUserPreference('theme', 'light');
  const current = renderShellRuntime();

  // The server reports the theme of the pty it reattached to, not the one just sent.
  connectShell(current).reportLaunchTheme('dark');

  assert.equal(current().runtime.isClaudeThemeOutdated, true);
});

test('shells that are not a themed Claude launch never ask for a restart', () => {
  vi.useFakeTimers();
  writeUserPreference('theme', 'light');
  const current = renderShellRuntime();
  // The server sends no launch theme for plain shells, Codex and the like.
  const { reportLaunchTheme } = connectShell(current);

  act(() => {
    current().theme.toggleDarkMode();
  });
  assert.equal(current().runtime.isClaudeThemeOutdated, false);

  reportLaunchTheme('sepia');
  assert.equal(current().runtime.isClaudeThemeOutdated, false, 'an unknown value is ignored');
});
