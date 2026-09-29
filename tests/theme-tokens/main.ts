import type { ITheme, Terminal } from '@xterm/xterm';

import { GRAPH_LANE_COUNT } from '@/modules/git-panel/utils/commitGraph';
import { installMobileTerminalSelection } from '@/modules/shell/utils/mobileTerminalSelection';
import {
  FALLBACK_TERMINAL_FONT_FAMILY,
  readTerminalTheme,
  readThemedTerminalFontFamily,
  resolveTerminalFontFamily,
  TERMINAL_THEME_TOKENS,
} from '@/modules/shell/utils/terminalTheme';
import type { TerminalFontFamilyId } from '@/shared/types';
import { EXTREME_TOKENS, SCALE_TOKEN_NAMES } from '@/shared/tests/neutralScale';
import { ensureSyntaxStyleElement, SYNTAX_TOKEN_MAP, syntaxTheme } from '@/shared/syntaxTheme';
import type { SyntaxSemanticName } from '@/shared/syntaxTheme';
import type { ThemeManifest } from '@/shared/types';
import { applyUserThemeStyle, getUserThemeStyleState, previewUserThemeStyle } from '@/shared/userThemeStyles';
import type { UserThemeStyleState } from '@/shared/userThemeStyles';
import { applyThemeChrome } from '@/shared/utils';
import { readTokenSnapshot } from '@/shared/tokenSnapshot';

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

/**
 * Every custom property the stylesheet declares, plus the syntax slots the Prism
 * sheet injects at runtime.
 *
 * The syntax variables are derived from the Prism theme objects, so they cannot
 * live in `index.css` — a `<style>` this app injects carries them instead, and
 * the scan above cannot see that element. Listing them by hand is what puts the
 * slots on the baseline at all: without it, renaming them, or one of them
 * quietly losing its value, would leave the baseline diff empty.
 *
 * A slot a theme omits reads back as an empty string and is recorded as one —
 * the baseline already carries two such entries (`--reasoning-collapse-duration`
 * and `--reasoning-fade-duration`), because "the property exists but resolves to
 * nothing" is a state this page is supposed to show rather than hide.
 */
const tokenNames = [
  ...new Set([...extractTokenNames(cssSource), ...Object.values(SYNTAX_TOKEN_MAP)]),
].sort();

/**
 * The contract slots' token names, read from the map the app publishes rather
 * than from a second list here: a spec asking "did this theme declare the syntax
 * slots?" has to mean the same set the generator named, or the two drift apart
 * without either side noticing.
 */
const syntaxTokenNames: string[] = Object.values(SYNTAX_TOKEN_MAP);

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

/**
 * What one syntax slot resolves to right now.
 *
 * Read through the same bare `var()` shape the Prism style object hands the
 * highlighter. A user theme that moves syntax colours — a `.tmTheme` compiles to
 * exactly these names — has to beat the base sheet the stylesheet module injects,
 * and "does it" is a document-order question only a real engine can answer.
 */
function readSyntaxToken(name: SyntaxSemanticName): string {
  const probe = document.createElement('div');
  probe.style.setProperty('transition', 'none');
  probe.style.setProperty('color', `var(${SYNTAX_TOKEN_MAP[name]})`);
  document.body.appendChild(probe);
  try {
    return getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

/** The id on the rendered code-block probe, so a spec can select the element. */
const CODE_BLOCK_PROBE_ID = 'cc-code-block-probe';

const PRISM_PRE_SELECTOR = 'pre[class*="language-"]';

/**
 * A code block with the shape the two real consumers produce, reported as the
 * computed colour of `<pre>` and of the `<code>` inside it.
 *
 * The fixture never mounts the app, so the block is assembled here — but out of
 * the *production* style object rather than a hand-written copy:
 * `react-syntax-highlighter` inlines the Prism sheet's `pre[…]` rule as
 * `preProps`, and both consumers (chat's `Markdown`, code-editor's
 * `MarkdownCodeBlock`) then replace the `code[…]` half with their own
 * `codeTagProps`, which carry no colour. The body colour therefore reaches
 * `<code>` by inheritance, and which element's computed colour actually moves
 * when a theme sets the slot is a question only a real engine can be asked.
 */
function readCodeBlockColours(): { pre: string; code: string } {
  document.getElementById(CODE_BLOCK_PROBE_ID)?.remove();

  const pre = document.createElement('pre');
  pre.id = CODE_BLOCK_PROBE_ID;
  pre.className = 'language-ts';
  pre.style.setProperty('transition', 'none');
  for (const [property, value] of Object.entries(syntaxTheme.style[PRISM_PRE_SELECTOR] ?? {})) {
    pre.style.setProperty(
      property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`),
      value,
    );
  }

  const code = document.createElement('code');
  code.className = 'language-ts';
  code.textContent = 'const answer = 41;';
  code.style.setProperty('transition', 'none');
  // What a caller's own `codeTagProps` amount to: no colour of their own.
  code.style.setProperty('background', 'transparent');

  pre.appendChild(code);
  document.body.appendChild(pre);

  return { pre: getComputedStyle(pre).color, code: getComputedStyle(code).color };
}

/**
 * The code-block *panel* — the board a fenced block sits on — read the way the
 * consumers paint it, next to the editor page it is meant to match.
 *
 * The fixture never mounts the app, so the panel is assembled here — but out of
 * the consumers' own spellings. `chat` is what the chat transcript's panel
 * carries (`bg-code-block/50` in light, `dark:bg-code-block` in dark): the light
 * half keeps the half-transparent shape `--muted` had, the dark half stays
 * opaque, as the `--n-zinc-900` atom was. The editor's preview writes the token
 * straight onto its `<pre>` in both appearances, which is what removed the old
 * "the dark half falls through to Prism's own background" asymmetry, so that one
 * is read as an inline background rather than through a utility class.
 *
 * `reference` is the editor page itself and `half` is the chat panel's light
 * half spelled by hand, so a caller can ask both questions without restating a
 * palette value: does the panel sit on the same board as the editor beside it,
 * and is the light half that board at 50%? Every probe sets `transition: none`,
 * because a value read mid-interpolation is a value no one painted.
 */
function readCodeBlockBoards(): {
  reference: string;
  chat: string;
  editor: string;
  half: string;
} {
  const probe = (): HTMLDivElement => {
    const element = document.createElement('div');
    element.style.setProperty('transition', 'none');
    return element;
  };

  const reference = probe();
  reference.style.setProperty('background', 'var(--editor-bg)');

  const chat = probe();
  chat.className = 'bg-code-block/50 dark:bg-code-block';

  const editor = probe();
  editor.style.setProperty('background', 'hsl(var(--code-block-bg))');

  const half = probe();
  half.style.setProperty('background', 'hsl(var(--code-block-bg) / 0.5)');

  document.body.append(reference, chat, editor, half);
  try {
    return {
      reference: getComputedStyle(reference).backgroundColor,
      chat: getComputedStyle(chat).backgroundColor,
      editor: getComputedStyle(editor).backgroundColor,
      half: getComputedStyle(half).backgroundColor,
    };
  } finally {
    reference.remove();
    chat.remove();
    editor.remove();
    half.remove();
  }
}

/**
 * Runs the production syntax-sheet injection again, the way a later-loaded chunk
 * would if that module ever stopped being part of the entry graph. The module
 * itself injects once, before any overlay exists, so this is the only way to ask
 * whether an overlay still wins when the base sheet arrives second.
 *
 * `placement: 'last'` is the negative control for that question. It writes the
 * *same* declarations but appends them, which is where a base layer has to lose:
 * a test that keeps reading the themed colour under it is not measuring document
 * order at all, whatever it claims to.
 */
function reinjectSyntaxStyleSheet(placement: 'first' | 'last' = 'first'): void {
  document.getElementById('cc-syntax-theme')?.remove();
  if (placement === 'first') {
    ensureSyntaxStyleElement();
    return;
  }

  const styleElement = document.createElement('style');
  styleElement.id = 'cc-syntax-theme';
  styleElement.textContent = syntaxTheme.css;
  document.head.appendChild(styleElement);
}

/**
 * Takes a declaration back out of an injected `<style>` element, returning how
 * many rules it was in.
 *
 * An overlay a theme arrives in is a real element, so its rules are reachable
 * through CSSOM — and deleting a declaration is what turns "this slot is what
 * paints that" into something observable: what the page shows afterwards is the
 * layer underneath, which for these tokens is the base Prism palette. The count
 * is returned rather than a boolean so a caller can tell "removed it and the page
 * fell back" from "removed nothing and the page happened to look right".
 */
function removeDeclaration(styleElementSelector: string, token: string): number {
  const element = document.querySelector<HTMLStyleElement>(styleElementSelector);
  const sheet = element?.sheet;
  if (!sheet) {
    throw new Error(`${styleElementSelector} is not a stylesheet in the document`);
  }

  let removed = 0;
  for (const rule of Array.from(sheet.cssRules)) {
    // 1 is CSSRule.STYLE_RULE, spelled numerically because not every engine
    // exposes the named constant on the global.
    if (rule.type !== 1) continue;
    const style = (rule as CSSStyleRule).style;
    if (!style.getPropertyValue(token)) continue;
    style.removeProperty(token);
    removed += 1;
  }
  return removed;
}

/**
 * The bare, fallback-less read of the terminal font token.
 *
 * `readThemedTerminalFontFamily` cannot be asked about a token the base sheet
 * never declares — the stylesheet always declares `--term-font-family` — so the
 * "no value" states are produced by overriding it instead. This helper is what
 * shows the failure the production guard exists to prevent: with no `var()`
 * fallback and no value behind the token, the probe reads the *inherited* stack,
 * which is a real font stack and so indistinguishable from a declared one.
 */
function probeFontFamilyWithoutFallback(token: string): string {
  const probe = document.createElement('div');
  probe.style.display = 'none';
  probe.style.transition = 'none';
  probe.style.fontFamily = `var(${token})`;
  document.body.appendChild(probe);
  try {
    return getComputedStyle(probe).fontFamily;
  } finally {
    probe.remove();
  }
}

/**
 * The token preview's read, verbatim from the component's module. The fixture
 * page is where the real-engine questions about it live: computed-style
 * enumeration reaching the declared tokens (including names injected at
 * runtime), the two appearances differing, and the `.dark` class surviving the
 * internal flip.
 */
function readTokenPreviewSnapshot() {
  return readTokenSnapshot();
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
 *
 * The second source takes the same path with the fetch replaced by content the
 * caller already has (`paste`). Driving both through one entry point is
 * deliberate: the difference between them is supposed to be one step, and a
 * `paste` reading with no requests recorded is what shows it stayed that way.
 */
export type UserThemeOptions = {
  id?: string;
  fileName?: string;
  modifiedAt?: number;
  /** Format the listed file claims, which is what decides how the body is compiled. */
  format?: 'css' | 'json' | 'tmTheme';
  /** Body of the theme file, or `''` for a file the server refuses. */
  css?: string;
  /**
   * The content whose text is *in hand* rather than served — the pasted source.
   * When given, nothing is asked of the stub: proving that is the point.
   */
  paste?: string;
  /**
   * The format the pasted content is written in. A paste has no filename, so
   * this is the only thing that says which compiler it goes to; option A's is
   * the default because it is the mode the settings page opens in.
   */
  pasteFormat?: 'json' | 'css';
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

/**
 * What the page looks like with a draft on it.
 *
 * `isLast` is the half of this a jsdom test cannot reach: the preview and the
 * applied theme are both plain `<style>` elements at the same specificity, so
 * which one the page wears is settled by document order alone, and only an
 * engine that actually cascades can say that the draft won.
 */
export type UserThemePreview = {
  /** How many preview elements are in the document; more than one would be a stale draft. */
  previewCount: number;
  /** What the page paints for `--background` with the draft in place. */
  background: string;
  /** Whether the preview is the last element in `<head>`, which is what makes it win. */
  isLast: boolean;
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
    paste,
    pasteFormat = 'json',
    status = 200,
    listingComplete = true,
  } = options;

  if (paste === undefined) {
    if (status === 200) {
      themeFiles.set(fileName, { body: css, status });
    } else {
      themeFiles.delete(fileName);
    }
  }

  const before = themeRequests.length;
  await applyUserThemeStyle(
    paste === undefined
      ? { kind: 'file', entry: { id, name: id, fileName, format, modifiedAt } }
      : { kind: 'paste', theme: { id, name: id, content: paste, format: pasteFormat } },
    listingComplete,
  );

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

/**
 * The advanced mode's draft, driven through the production function.
 *
 * `null` is what the settings page sends when the box is empty, so it is also
 * how this fixture asks the other question: whether taking the draft away leaves
 * the theme that was already in the document where it was.
 */
function previewUserTheme(css: string | null): UserThemePreview {
  previewUserThemeStyle(css);

  const probe = document.querySelector<HTMLElement>('[data-token="--background"]');
  const preview = document.querySelector('style[data-cloudcli-theme-preview]');
  return {
    previewCount: document.querySelectorAll('style[data-cloudcli-theme-preview]').length,
    background: probe ? getComputedStyle(probe).backgroundColor : '',
    isLast: preview !== null && preview === document.head.lastElementChild,
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
      /** The themed terminal font stack, or null when the token carries no value. */
      readThemedTerminalFontFamily(): string | null;
      /** The stack xterm would use for a given user preference. */
      resolveTerminalFontFamily(choice: TerminalFontFamilyId): string;
      /** The production fallback stack, so the suite can assert the literal. */
      fallbackTerminalFontFamily: string;
      /** A bare `var(token)` with no fallback — the failure the production guard prevents. */
      probeFontFamilyWithoutFallback(token: string): string;
      /** The colours the mobile selection chrome injects right now. */
      readMobileSelectionChrome(): Record<string, string>;
      /** The browser-chrome metas for an appearance, written by the production applier. */
      readThemeChrome(
        appearance: Appearance,
        overrides?: Pick<ThemeManifest, 'themeColor' | 'statusBar'>,
      ): { themeColor: string | null; statusBar: string | null };
      /** Runs the production user-theme stylesheet path against a stubbed file server. */
      applyUserTheme(options: UserThemeOptions): Promise<UserThemeApplication>;
      /** Puts a draft stylesheet in the document, or takes it away, and reads what the page paints. */
      previewUserTheme(css: string | null): UserThemePreview;
      /** What one shared syntax slot resolves to right now. */
      readSyntaxToken(name: SyntaxSemanticName): string;
      /** The contract syntax slots' token names, so a spec keeps no list of its own. */
      syntaxTokenNames: string[];
      /** Renders the code-block probe and reports `<pre>`'s and `<code>`'s computed colours. */
      readCodeBlockColours(): { pre: string; code: string };
      /** The code-block panel's board, the editor page it follows, and its light half. */
      readCodeBlockBoards(): { reference: string; chat: string; editor: string; half: string };
      /** Re-runs the production syntax-sheet injection, as a later-loaded chunk would. */
      reinjectSyntaxStyleSheet(placement?: 'first' | 'last'): void;
      /** Removes a declaration from an injected sheet, returning the rules it was in. */
      removeDeclaration(styleElementSelector: string, token: string): number;
      /** The token preview's snapshot, in both appearances, taken by the production module. */
      readTokenPreviewSnapshot(): {
        groups: { id: string; entries: { name: string; light: string; dark: string; lightSwatch: string | null; darkSwatch: string | null }[] }[];
        tokenCount: number;
      };
    };
  }
}

buildProbes();
installThemeFileServer();

window.__THEME_TOKENS__ = {
  read: readTokens,
  readWithTheme,
  readTerminalTheme,
  readThemedTerminalFontFamily,
  resolveTerminalFontFamily,
  fallbackTerminalFontFamily: FALLBACK_TERMINAL_FONT_FAMILY,
  probeFontFamilyWithoutFallback,
  readMobileSelectionChrome,
  readThemeChrome,
  applyUserTheme,
  previewUserTheme,
  readSyntaxToken,
  syntaxTokenNames,
  readCodeBlockColours,
  readCodeBlockBoards,
  reinjectSyntaxStyleSheet,
  removeDeclaration,
  readTokenPreviewSnapshot,
};
