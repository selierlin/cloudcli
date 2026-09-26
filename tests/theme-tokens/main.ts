import type { ITheme, Terminal } from '@xterm/xterm';

import { GRAPH_LANE_COUNT } from '@/modules/git-panel/utils/commitGraph';
import { installMobileTerminalSelection } from '@/modules/shell/utils/mobileTerminalSelection';
import { readTerminalTheme, TERMINAL_THEME_TOKENS } from '@/modules/shell/utils/terminalTheme';
import { EXTREME_TOKENS, SCALE_TOKEN_NAMES } from '@/shared/tests/neutralScale';
import type { ThemeManifest } from '@/shared/types';
import { applyUserThemeStyle, getUserThemeStyleState } from '@/shared/userThemeStyles';
import type { UserThemeStyleState } from '@/shared/userThemeStyles';
import { applyThemeChrome } from '@/shared/utils';

import '../../src/index.css';
import cssSource from '../../src/index.css?raw';

/**
 * Token contract fixture.
 *
 * This page imports the production stylesheet verbatim and exposes the resolved
 * value of every custom property the stylesheet declares. The browser resolves
 * `var()` chains for us, so a snapshot taken here is the ground truth for
 * "the UI did not change": any edit that rewrites a token to reference another
 * token (a palette indirection) resolves to the identical string.
 *
 * The fixture is deliberately framework-free — it never mounts the app, so it
 * stays fast and cannot be broken by unrelated component work.
 */

export type Appearance = 'light' | 'dark';

export type TokenRead = {
  /** Token name -> resolved value (var() replaced, whitespace normalised). */
  tokens: Record<string, string>;
  /**
   * Colour tokens parsed through the same `hsl(var(--x))` path Tailwind uses.
   * Guards against an indirection that keeps the raw string intact but breaks
   * when the browser actually parses it as a colour.
   */
  rendered: Record<string, string>;
};

/**
 * The terminal tokens, plus the semantic aliases the stylesheet declares.
 * Derived from the runtime token map so a key added there is covered here
 * without a second hand-maintained list.
 */
const TERMINAL_PROBE_TOKENS: string[] = [
  ...Object.values(TERMINAL_THEME_TOKENS),
  '--term-error',
  '--term-success',
  '--term-warning',
  '--term-info',
];

/**
 * The editor tokens hold a complete colour expression (`hsl(var(--palette-…))`,
 * `#282c34`, `rgba(…)`) rather than a triplet, because `EditorView.theme()`
 * writes the value into a rule verbatim. They are therefore probed with a bare
 * `var()`, which is the shape the editor actually emits.
 */
const EDITOR_PROBE_TOKENS: string[] = [
  '--editor-bg',
  '--editor-fg',
  '--editor-caret',
  '--editor-cursor',
  '--editor-selection',
  '--editor-selection-focused',
  '--editor-gutter-bg',
  '--editor-gutter-fg',
  '--editor-active-line-bg',
  '--editor-active-line-gutter-bg',
  '--editor-panel-bg',
  '--editor-panel-fg',
  '--editor-search-match-bg',
  '--editor-search-match-selected-bg',
  '--editor-selection-match-bg',
  '--editor-matching-bracket-bg',
  '--editor-nonmatching-bracket-bg',
  '--editor-fold-placeholder-bg',
  '--editor-fold-placeholder-fg',
  '--editor-tooltip-bg',
  '--editor-tooltip-arrow-border',
  '--editor-tooltip-arrow',
  '--editor-autocomplete-selected-bg',
  '--editor-autocomplete-selected-fg',
  '--editor-diff-add-bg',
  '--editor-diff-add-border',
  '--editor-diff-add-text-bg',
  '--editor-diff-del-bg',
  '--editor-diff-del-border',
  '--editor-diff-del-text-bg',
  '--editor-minimap-bg',
  '--editor-minimap-diff-add',
  '--editor-toolbar-bg',
  '--editor-toolbar-border',
  '--editor-toolbar-fg',
  '--editor-toolbar-hover-bg',
  '--editor-loading-bg',
  '--editor-invalid',
];

/**
 * The neutral compatibility scale behind `bg-n-gray-*`. Probed through the same
 * `hsl(var(--token))` path Tailwind emits for those classes, so the baseline is
 * the colour the browser actually paints for the tokenised class — the other
 * half of the equivalence proof in src/shared/tests/neutralScale.test.ts.
 *
 * Derived from that module's vocabulary rather than hand-listed, so a family or
 * step added to the scale is covered here without a second edit.
 */
const NEUTRAL_SCALE_PROBE_TOKENS: string[] = [...SCALE_TOKEN_NAMES, ...EXTREME_TOKENS];

/**
 * The Git commit-graph lanes. `laneColor` in `commitGraph.ts` hands these to
 * SVG `stroke` / `fill` and to inline styles as `hsl(var(--graph-lane-N))`, so
 * probing them through that same path is the colour the History view paints.
 * Derived from the lane count so the two stay in step.
 */
const GRAPH_LANE_PROBE_TOKENS: string[] = Array.from(
  { length: GRAPH_LANE_COUNT },
  (_, index) => `--graph-lane-${index + 1}`,
);

type Probe = {
  token: string;
  property: string;
  /** How the consumer writes the token: `hsl(var(--x))`, or the bare `var(--x)`. */
  wrap?: 'hsl' | 'raw';
};

/**
 * One probe per consumption shape the stylesheet relies on:
 * a plain triplet, a triplet carrying an alpha channel, a token consumed
 * inside `hsl()` by the nav rules, and the bare `var()` the editor emits.
 */
const PROBES: Probe[] = [
  ...EDITOR_PROBE_TOKENS.map((token) => ({ token, property: 'color', wrap: 'raw' as const })),
  { token: '--background', property: 'backgroundColor' },
  { token: '--foreground', property: 'color' },
  { token: '--card', property: 'backgroundColor' },
  { token: '--primary', property: 'backgroundColor' },
  { token: '--primary-foreground', property: 'color' },
  { token: '--border', property: 'backgroundColor' },
  { token: '--muted-foreground', property: 'color' },
  // Consumed as `ring-ring` writes it (Tailwind maps the `ring` colour to
  // `hsl(var(--ring))`), and read back by the contrast suite's focus-visibility
  // pair — no other check resolves this token to a colour.
  { token: '--ring', property: 'color' },
  { token: '--nav-glass-bg', property: 'backgroundColor' },
  { token: '--nav-tab-glow', property: 'backgroundColor' },
  ...NEUTRAL_SCALE_PROBE_TOKENS.map((token) => ({ token, property: 'backgroundColor' })),
  ...GRAPH_LANE_PROBE_TOKENS.map((token) => ({ token, property: 'backgroundColor' })),
  // The terminal tokens go through the same `hsl(var(--token))` path the
  // runtime resolver uses (src/modules/shell/utils/terminalTheme.ts), so a
  // probe here is the colour xterm actually receives.
  ...TERMINAL_PROBE_TOKENS.map((token) => ({ token, property: 'color' })),
];

/** Every custom property the stylesheet declares, sorted. */
function extractTokenNames(css: string): string[] {
  const names = new Set<string>();
  const declaration = /(--[a-z0-9-]+)\s*:/gi;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(css)) !== null) {
    names.add(match[1]);
  }
  return [...names].sort();
}

const tokenNames = extractTokenNames(cssSource);

function buildProbes(): void {
  for (const { token, property, wrap = 'hsl' } of PROBES) {
    const probe = document.createElement('div');
    probe.dataset.token = token;
    probe.dataset.property = property;
    // The stylesheet gives every `div` a 200ms colour transition
    // (`src/index.css` "Color transitions for theme switching"). Without this
    // opt-out a read taken right after an appearance flip returns the value the
    // transition started from, not the resolved palette.
    probe.style.setProperty('transition', 'none');
    probe.style.setProperty(
      property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      // The `hsl()` form is the shape Tailwind emits for `bg-background`; the
      // raw form is the shape `EditorView.theme()` emits.
      wrap === 'raw' ? `var(${token})` : `hsl(var(${token}))`,
    );
    document.body.appendChild(probe);
  }
}

/**
 * The mobile long-press selection chrome (handle, context menu) is CSS that
 * `mobileTerminalSelection.ts` writes inline onto elements it creates, so the
 * tokens it consumes are only observable by actually installing it. This mounts
 * it on a stub terminal — the constructor needs little more than an element,
 * buffer dimensions and the three xterm events — and reads back what it paints.
 */
function readMobileSelectionChrome(): Record<string, string> {
  const content = document.createElement('div');
  content.style.setProperty('transition', 'none');
  document.body.appendChild(content);

  const terminal = {
    element: content,
    cols: 80,
    rows: 24,
    options: {},
    hasSelection: () => false,
    onSelectionChange: () => ({ dispose: () => {} }),
    onResize: () => ({ dispose: () => {} }),
    onScroll: () => ({ dispose: () => {} }),
    refresh: () => {},
  } as unknown as Terminal;

  // A touch environment is what gates the install; the fixture page is desktop.
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 1, configurable: true });

  const manager = installMobileTerminalSelection(terminal, content);
  const handle = content.querySelector<HTMLElement>('.shell-mobile-selection-handle-start');
  const menu = content.querySelector<HTMLElement>('.shell-mobile-selection-menu');
  const button = menu?.querySelector('button') ?? null;
  if (!manager || !handle || !menu || !button) {
    throw new Error('mobile selection chrome did not install');
  }

  const chrome = {
    handleBackground: getComputedStyle(handle).backgroundColor,
    handleBorder: getComputedStyle(handle).border,
    handleBoxShadow: getComputedStyle(handle).boxShadow,
    menuBackground: getComputedStyle(menu).backgroundColor,
    menuBorder: getComputedStyle(menu).border,
    menuBoxShadow: getComputedStyle(menu).boxShadow,
    buttonColor: getComputedStyle(button).color,
  };

  manager.dispose();
  content.remove();
  return chrome;
}

/**
 * The browser-chrome metas are written by `applyThemeChrome`, the same function
 * `ThemeContext` calls on every appearance change; the fixture drives it directly
 * instead of mounting React, which keeps the page framework-free. The meta tags
 * mirror the ones `index.html` ships.
 */
function readThemeChrome(
  appearance: Appearance,
  overrides?: Pick<ThemeManifest, 'themeColor' | 'statusBar'>,
): { themeColor: string | null; statusBar: string | null } {
  for (const name of ['theme-color', 'apple-mobile-web-app-status-bar-style']) {
    if (!document.querySelector(`meta[name="${name}"]`)) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', name);
      document.head.appendChild(meta);
    }
  }

  // The chrome colour is resolved from the token the appearance selects, so the
  // fixture has to be in the same appearance the provider would have applied.
  document.documentElement.classList.toggle('dark', appearance === 'dark');
  applyThemeChrome(appearance, overrides);

  return {
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    statusBar:
      document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content') ?? null,
  };
}

function readTokens(appearance: Appearance): TokenRead {
  document.documentElement.classList.toggle('dark', appearance === 'dark');

  const computed = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const name of tokenNames) {
    tokens[name] = computed.getPropertyValue(name).trim();
  }

  const rendered: Record<string, string> = {};
  for (const probe of Array.from(document.querySelectorAll<HTMLElement>('[data-token]'))) {
    const property = probe.dataset.property as string;
    rendered[probe.dataset.token as string] = getComputedStyle(probe)[
      property as keyof CSSStyleDeclaration
    ] as string;
  }

  return { tokens, rendered };
}

/**
 * The same read, with an overlay theme applied. `null` clears `<html
 * data-theme>`, which is the state the app starts in when the user has not
 * picked a theme: the base palette.
 *
 * The attribute is left in place, so a caller can take several readings by
 * passing different ids; a fresh `page.goto('/')` is what resets it.
 */
function readWithTheme(themeId: string | null, appearance: Appearance): TokenRead {
  if (themeId === null) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = themeId;
  }
  return readTokens(appearance);
}

/**
 * The user theme stylesheet path.
 *
 * A user theme's colours are not in the bundled stylesheet: they arrive from
 * `/api/themes/<file>` and are appended to `<head>` at runtime. That is the one
 * part of the contract this directory can only check in a real engine —
 * `getComputedStyle` is what shows the injected rules actually reaching the
 * page — so the production module is driven here with nothing stubbed but the
 * server, which is the boundary the app itself does not own.
 */
export type UserThemeOptions = {
  id?: string;
  fileName?: string;
  modifiedAt?: number;
  /** Format the listed file claims, which is what decides how the body is compiled. */
  format?: 'css' | 'json' | 'tmTheme';
  /** Body of the theme file, or `''` for a file the server refuses. */
  css?: string;
  /** Status the stub answers with; anything but 200 means the file is not there. */
  status?: number;
  /** Whether the listing has been read, which is what makes an absent entry evidence. */
  listingComplete?: boolean;
};

export type UserThemeApplication = {
  /** The theme file URLs the stub was asked for during this application, in order. */
  requests: string[];
  /** How many injected stylesheets are in the document; more than one would mean a stale sheet. */
  styleCount: number;
  /** The id on the injected stylesheet, or null. */
  styleId: string | null;
  /** What the page paints for `--background` while the theme's id is on `<html>`. */
  background: string;
  /** What the stylesheet store publishes. */
  state: UserThemeStyleState;
  /** Whether a copy of the file survived in localStorage. */
  cached: boolean;
};

/** The files the stub answers for, and every theme file URL it has been asked for. */
const themeFiles = new Map<string, { body: string; status: number }>();
const themeRequests: string[] = [];

/**
 * Answers `/api/themes/<file>` from `themeFiles` and forwards everything else.
 *
 * Only the server is replaced: `applyUserThemeStyle` still goes through
 * `authenticatedFetch`, still builds its own `?v=<mtime>`, and still gets a
 * real `Response` back.
 */
function installThemeFileServer(): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const match = /^\/api\/themes\/([^?]*)/.exec(url);
    if (!match) {
      return nativeFetch(input, init);
    }

    themeRequests.push(url);
    const record = themeFiles.get(decodeURIComponent(match[1]));
    return record
      ? new Response(record.body, { status: record.status })
      : new Response('not found', { status: 404 });
  };
}

async function applyUserTheme(options: UserThemeOptions = {}): Promise<UserThemeApplication> {
  const {
    id = 'user-fixture',
    fileName = 'fixture.css',
    modifiedAt = 42,
    format = 'css',
    css = '',
    status = 200,
    listingComplete = true,
  } = options;

  if (status === 200) {
    themeFiles.set(fileName, { body: css, status });
  } else {
    themeFiles.delete(fileName);
  }

  const before = themeRequests.length;
  await applyUserThemeStyle({ id, name: id, fileName, format, modifiedAt }, listingComplete);

  // The provider writes the resolved id to `<html data-theme>`; this page is
  // framework-free, so the step the provider would take is taken here.
  document.documentElement.dataset.theme = id;

  const probe = document.querySelector<HTMLElement>('[data-token="--background"]');
  const injected = document.querySelector('style[data-cloudcli-user-theme]');
  return {
    requests: themeRequests.slice(before),
    styleCount: document.querySelectorAll('style[data-cloudcli-user-theme]').length,
    styleId: injected?.getAttribute('data-cloudcli-user-theme') ?? null,
    background: probe ? getComputedStyle(probe).backgroundColor : '',
    state: getUserThemeStyleState(),
    cached: localStorage.getItem('cloudcli.user-theme-style') !== null,
  };
}

declare global {
  interface Window {
    __THEME_TOKENS__?: {
      read(appearance: Appearance): TokenRead;
      /** The same read with an overlay theme applied, or `null` for the base palette. */
      readWithTheme(themeId: string | null, appearance: Appearance): TokenRead;
      /** The xterm theme the shell hook would build right now. */
      readTerminalTheme(): ITheme;
      /** The colours the mobile selection chrome injects right now. */
      readMobileSelectionChrome(): Record<string, string>;
      /** The browser-chrome metas for an appearance, written by the production applier. */
      readThemeChrome(
        appearance: Appearance,
        overrides?: Pick<ThemeManifest, 'themeColor' | 'statusBar'>,
      ): { themeColor: string | null; statusBar: string | null };
      /** Runs the production user-theme stylesheet path against a stubbed file server. */
      applyUserTheme(options: UserThemeOptions): Promise<UserThemeApplication>;
    };
  }
}

buildProbes();
installThemeFileServer();

window.__THEME_TOKENS__ = {
  read: readTokens,
  readWithTheme,
  readTerminalTheme,
  readMobileSelectionChrome,
  readThemeChrome,
  applyUserTheme,
};
