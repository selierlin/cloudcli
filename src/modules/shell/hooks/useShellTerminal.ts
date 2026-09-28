import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { ClipboardAddon, type IClipboardProvider } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import type { ITerminalOptions } from '@xterm/xterm';

import { useTheme } from '@/shared/context/ThemeContext';
import type { MobileTerminalSelectionManager, Project } from '@/shared/types';
import {
  copyTextToClipboard,
  FONT_SETTINGS_CHANGED_EVENT,
  readFontSettings,
} from '@/shared/utils';
import { TERMINAL_INIT_DELAY_MS } from '@/shared/constants';
import { installMobileTerminalSelection } from '@/modules/shell/utils/mobileTerminalSelection';
import { sendSocketMessage } from '@/modules/shell/utils/socket';
import { ensureXtermFocusStyles } from '@/modules/shell/utils/terminalStyles';
import { readTerminalTheme, resolveTerminalFontFamily, FALLBACK_TERMINAL_FONT_FAMILY } from '@/modules/shell/utils/terminalTheme';

const TERMINAL_RESIZE_DELAY_MS = 50;

const TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  fontSize: 14,
  // The value the terminal shipped with, and the same literal the base stylesheet
  // mirrors as `--term-font-family`. A theme or a user choice replaces it at
  // construction and on change (see `resolveTerminalFontFamily`).
  fontFamily: FALLBACK_TERMINAL_FONT_FAMILY,
  allowProposedApi: true,
  allowTransparency: false,
  convertEol: true,
  scrollback: 10000,
  tabStopWidth: 4,
  windowsMode: false,
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
};

/**
 * A face that has not landed yet is invisible to xterm: it sizes the grid from
 * measured glyphs, so a `fit()` taken before the font arrives lays the terminal
 * out for whatever fallback answered and the characters sit wrong afterwards.
 * `FontFaceSet.load` requests the face and resolves once it is usable, and
 * resolves empty for a family the machine does not have — an uninstalled font
 * therefore does not stall the terminal. jsdom has no `document.fonts` (the
 * vitest suite runs there), hence the optional call.
 */
async function waitForTerminalFont(fontFamily: string, fontSize: number): Promise<void> {
  try {
    await document.fonts?.load(`${fontSize}px ${fontFamily}`);
  } catch {
    // `load` rejects on a stack the CSS parser cannot read (a theme can declare
    // one). Nothing to do about it here: the terminal still renders with the
    // closest face that does exist.
  }
}

/**
 * Measure the grid once the face is in, then tell the pty what came out.
 *
 * Both call sites need this for the same reason: xterm derives the grid from
 * measured glyphs, so a `fit()` taken while the face is still on its way sizes the
 * terminal for whatever answered instead — and a repaint alone would leave the pty
 * rendering into the grid from before the change. The atlas is dropped as well;
 * its cache belongs to the face it was built for.
 *
 * A family that is already available — every system face, and any stack on a
 * second call — makes `load` resolve without fetching anything, so waiting is the
 * cheap branch. The disposal check lives here because the wait is the only await
 * between setting the option and fitting.
 */
async function fitAfterFontReady(
  terminal: Terminal,
  terminalRef: MutableRefObject<Terminal | null>,
  fitAddonRef: MutableRefObject<FitAddon | null>,
  wsRef: MutableRefObject<WebSocket | null>,
): Promise<void> {
  await waitForTerminalFont(
    terminal.options.fontFamily ?? FALLBACK_TERMINAL_FONT_FAMILY,
    Number(terminal.options.fontSize),
  );
  // The terminal can be disposed while the face loads.
  if (terminalRef.current !== terminal) {
    return;
  }

  terminal.clearTextureAtlas?.();
  const fitAddon = fitAddonRef.current;
  if (!fitAddon) {
    return;
  }

  fitAddon.fit();
  sendSocketMessage(wsRef.current, {
    type: 'resize',
    cols: terminal.cols,
    rows: terminal.rows,
  });
}

/**
 * Push the current font settings into a live terminal.
 *
 * A stylesheet change never reaches xterm, and neither does a new font: the grid
 * comes from measured glyphs rather than from CSS. A size change needs the same
 * treatment as a face change — both move the metrics, and the old code refreshed
 * without re-fitting, so the pty never learned the new grid.
 */
function applyTerminalFont(
  terminal: Terminal,
  terminalRef: MutableRefObject<Terminal | null>,
  fitAddonRef: MutableRefObject<FitAddon | null>,
  wsRef: MutableRefObject<WebSocket | null>,
): void {
  const settings = readFontSettings();
  const fontSize = Number(settings.terminalFontSize);
  const fontFamily = resolveTerminalFontFamily(settings.terminalFontFamily);
  const faceChanged = terminal.options.fontFamily !== fontFamily;
  const sizeChanged = terminal.options.fontSize !== fontSize;
  if (!faceChanged && !sizeChanged) {
    return;
  }

  terminal.options.fontSize = fontSize;
  terminal.options.fontFamily = fontFamily;

  void fitAfterFontReady(terminal, terminalRef, fitAddonRef, wsRef);
}

// CLIs running inside the pty (e.g. `claude auth login`'s "press c to copy"
// device-flow prompt) write to the clipboard via an OSC 52 escape sequence,
// not a browser event — xterm.js ignores OSC 52 unless a clipboard addon is
// loaded. Routes writes through the same fallback-aware helper the terminal's
// own selection-copy shortcut uses, since `navigator.clipboard` is often
// unavailable on self-hosted, non-HTTPS deployments.
// `ClipboardSelectionType.SYSTEM` is `'c'` (vs. `'p'` for the X11 primary
// selection) — compared as a literal since the addon ships it as a const
// enum, which isolatedModules builds (esbuild/Vite) can't import as a value.
const oscClipboardProvider: IClipboardProvider = {
  readText: async (selection) => {
    if (selection !== 'c') {
      return '';
    }
    try {
      return (await navigator.clipboard?.readText?.()) || '';
    } catch {
      return '';
    }
  },
  writeText: async (selection, text) => {
    if (selection !== 'c') {
      return;
    }
    await copyTextToClipboard(text);
  },
};

// The addon's published typings declare a single `(provider?)` constructor
// param, but the shipped runtime actually takes `(base64?, provider?)` — see
// node_modules/@xterm/addon-clipboard/lib/addon-clipboard.js. Cast to call it
// the way it's really implemented.
const ClipboardAddonCtor = ClipboardAddon as unknown as new (
  base64?: unknown,
  provider?: IClipboardProvider,
) => ClipboardAddon;

type UseShellTerminalOptions = {
  terminalContainerRef: RefObject<HTMLDivElement>;
  terminalRef: MutableRefObject<Terminal | null>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  wsRef: MutableRefObject<WebSocket | null>;
  selectedProject: Project | null | undefined;
  minimal: boolean;
  isRestarting: boolean;
  closeSocket: () => void;
};

type UseShellTerminalResult = {
  isInitialized: boolean;
  clearTerminalScreen: () => void;
  disposeTerminal: () => void;
};

export function useShellTerminal({
  terminalContainerRef,
  terminalRef,
  fitAddonRef,
  wsRef,
  selectedProject,
  minimal,
  isRestarting,
  closeSocket,
}: UseShellTerminalOptions): UseShellTerminalResult {
  const { isDarkMode, resolvedThemeId } = useTheme();
  const [isInitialized, setIsInitialized] = useState(false);
  const resizeTimeoutRef = useRef<number | null>(null);
  const mobileSelectionRef = useRef<MobileTerminalSelectionManager | null>(null);
  const selectedProjectKey = selectedProject?.fullPath || selectedProject?.path || '';
  const hasSelectedProject = Boolean(selectedProject);

  useEffect(() => {
    ensureXtermFocusStyles();
  }, []);

  const clearTerminalScreen = useCallback(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.clear();
    terminalRef.current.write('\x1b[2J\x1b[H');
  }, [terminalRef]);

  const disposeTerminal = useCallback(() => {
    if (mobileSelectionRef.current) {
      mobileSelectionRef.current.dispose();
      mobileSelectionRef.current = null;
    }

    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }

    fitAddonRef.current = null;
    setIsInitialized(false);
  }, [fitAddonRef, terminalRef]);

  useEffect(() => {
    const terminalContainer = terminalContainerRef.current;
    if (!terminalContainer || !hasSelectedProject || isRestarting || terminalRef.current) {
      return;
    }

    const fontSettings = readFontSettings();
    const nextTerminal = new Terminal({
      ...TERMINAL_OPTIONS,
      fontSize: Number(fontSettings.terminalFontSize),
      fontFamily: resolveTerminalFontFamily(fontSettings.terminalFontFamily),
      theme: readTerminalTheme(),
    });
    terminalRef.current = nextTerminal;

    const nextFitAddon = new FitAddon();
    fitAddonRef.current = nextFitAddon;
    nextTerminal.loadAddon(nextFitAddon);

    nextTerminal.loadAddon(new ClipboardAddonCtor(undefined, oscClipboardProvider));

    // Avoid wrapped partial links in compact login flows.
    if (!minimal) {
      nextTerminal.loadAddon(new WebLinksAddon());
    }

    try {
      nextTerminal.loadAddon(new WebglAddon());
    } catch {
      console.warn('[Shell] WebGL renderer unavailable, using Canvas fallback');
    }

    nextTerminal.open(terminalContainer);
    mobileSelectionRef.current = installMobileTerminalSelection(
      nextTerminal,
      terminalContainer,
      {
        onFontSizeChange: (fontSize) => {
          nextTerminal.options.fontSize = fontSize;

          const currentFitAddon = fitAddonRef.current;
          if (currentFitAddon) {
            currentFitAddon.fit();
            sendSocketMessage(wsRef.current, {
              type: 'resize',
              cols: nextTerminal.cols,
              rows: nextTerminal.rows,
            });
          } else {
            nextTerminal.refresh(0, nextTerminal.rows - 1);
          }
        },
      },
    );

    const copyTerminalSelection = async () => {
      const selection = nextTerminal.getSelection();
      if (!selection) {
        return false;
      }

      return copyTextToClipboard(selection);
    };

    const handleTerminalCopy = (event: ClipboardEvent) => {
      if (!nextTerminal.hasSelection()) {
        return;
      }

      const selection = nextTerminal.getSelection();
      if (!selection) {
        return;
      }

      event.preventDefault();

      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', selection);
        return;
      }

      void copyTextToClipboard(selection);
    };

    terminalContainer.addEventListener('copy', handleTerminalCopy);

    nextTerminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'c' &&
        nextTerminal.hasSelection()
      ) {
        event.preventDefault();
        event.stopPropagation();
        void copyTerminalSelection();
        return false;
      }

      if (
        event.type === 'keydown' &&
        (event.ctrlKey || event.metaKey) &&
        event.key?.toLowerCase() === 'v'
      ) {
        // Block native paste so data is only injected after clipboard-read resolves.
        event.preventDefault();
        event.stopPropagation();

        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          navigator.clipboard
            .readText()
            .then((text) => {
              sendSocketMessage(wsRef.current, {
                type: 'input',
                data: text,
              });
            })
            .catch(() => {});
        }

        return false;
      }

      return true;
    });

    window.setTimeout(() => {
      const currentTerminal = terminalRef.current;
      if (!currentTerminal) {
        return;
      }

      // The first fit decides the grid for everything the pty sends next, so it
      // waits for the face like every later change does.
      void fitAfterFontReady(currentTerminal, terminalRef, fitAddonRef, wsRef);
    }, TERMINAL_INIT_DELAY_MS);

    setIsInitialized(true);

    const dataSubscription = nextTerminal.onData((data) => {
      sendSocketMessage(wsRef.current, {
        type: 'input',
        data,
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = window.setTimeout(() => {
        const currentFitAddon = fitAddonRef.current;
        const currentTerminal = terminalRef.current;
        if (!currentFitAddon || !currentTerminal) {
          return;
        }

        currentFitAddon.fit();
        sendSocketMessage(wsRef.current, {
          type: 'resize',
          cols: currentTerminal.cols,
          rows: currentTerminal.rows,
        });
      }, TERMINAL_RESIZE_DELAY_MS);
    });

    resizeObserver.observe(terminalContainer);

    return () => {
      terminalContainer.removeEventListener('copy', handleTerminalCopy);
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      dataSubscription.dispose();
      closeSocket();
      disposeTerminal();
    };
  }, [
    closeSocket,
    disposeTerminal,
    fitAddonRef,
    isRestarting,
    hasSelectedProject,
    minimal,
    selectedProjectKey,
    terminalContainerRef,
    terminalRef,
    wsRef,
  ]);

  // Apply terminal font changes (Settings → Appearance → Fonts) live.
  useEffect(() => {
    const applyFontSettings = () => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }
      applyTerminalFont(terminal, terminalRef, fitAddonRef, wsRef);
    };

    window.addEventListener(FONT_SETTINGS_CHANGED_EVENT, applyFontSettings);
    return () => window.removeEventListener(FONT_SETTINGS_CHANGED_EVENT, applyFontSettings);
  }, [fitAddonRef, terminalRef, wsRef]);

  // xterm paints into a canvas and needs concrete colours, so a stylesheet change
  // never reaches an open terminal on its own. Re-read the --term-* tokens whenever
  // the applied theme changes: that is what lets a theme restyle a terminal that is
  // already running. `resolvedThemeId` is the overlays' half of that and changes on
  // an appearance flip too, but both deps are listed so an appearance-dependent
  // --term-* would stay covered if one is ever introduced.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = readTerminalTheme();
    // `--term-font-family` is a `--term-*` token like the colours, so the same
    // refresh carries the face — an overlay's light and dark blocks may even
    // declare different ones.
    applyTerminalFont(terminal, terminalRef, fitAddonRef, wsRef);
  }, [fitAddonRef, isDarkMode, resolvedThemeId, terminalRef, wsRef]);

  return {
    isInitialized,
    clearTerminalScreen,
    disposeTerminal,
  };
}
