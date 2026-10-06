import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { CodeFontFamilyId, FontFamilyId, Project, ProjectSession, QuickSettingsTab, SlashCommand, TerminalFontFamilyId, ThemeManifest } from '@/shared/types';

//----------------- DEPLOYMENT MODE ------------

/**
 * Indicates whether the app runs in Platform mode (hosted) or OSS mode (self-hosted).
 * Read it to hide or gate features that only exist in one of the two deployments.
 */
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';

// ---------------------------

//----------------- TAILWIND CLASS COMPOSITION ------------

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities so the
 * last-specified utility wins. Use it for every className built from props or state.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------

//----------------- CHAT FONT SETTINGS ------------

/** Event dispatched after local chat font settings change so active views can refresh CSS variables. */
export const FONT_SETTINGS_CHANGED_EVENT = 'fontSettingsChanged';

/** Available pixel values for chat text, terminal text and rendered code. */
export const UI_FONT_SIZE_OPTIONS = ['13', '14', '15', '16', '17', '18', '19', '20'];
export const TERMINAL_FONT_SIZE_OPTIONS = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
export const CODE_FONT_SIZE_OPTIONS = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];

/** The selectable typefaces for conversation prose and code blocks. */
export const FONT_FAMILY_OPTIONS: Array<{ id: FontFamilyId; label: string }> = [
  { id: 'system', label: 'system' }, { id: 'serif', label: 'serif' }, { id: 'sans', label: 'sans' },
  { id: 'songti', label: 'songti' }, { id: 'kaiti', label: 'kaiti' }, { id: 'rounded', label: 'rounded' },
  { id: 'jetbrains-mono', label: 'jetbrains-mono' }, { id: 'monospace', label: 'monospace' },
];
export const CODE_FONT_FAMILY_OPTIONS: Array<{ id: CodeFontFamilyId; label: string }> = [
  { id: 'system', label: 'system' }, { id: 'jetbrains-mono', label: 'jetbrains-mono' },
  { id: 'fira-code', label: 'fira-code' }, { id: 'cascadia-code', label: 'cascadia-code' },
  { id: 'source-code-pro', label: 'source-code-pro' }, { id: 'hack', label: 'hack' },
  { id: 'ibm-plex-mono', label: 'ibm-plex-mono' },
];

/**
 * The terminal's faces: the code-block list plus `'theme'`, which means "no
 * opinion" — the base stylesheet's `--term-font-family` answers, so a theme can
 * set the terminal face without overriding a user who has picked one (§3.1).
 */
export const TERMINAL_FONT_FAMILY_OPTIONS: Array<{ id: TerminalFontFamilyId; label: string }> = [
  { id: 'theme', label: 'theme' },
  ...CODE_FONT_FAMILY_OPTIONS,
];

/** CSS stacks matching every selectable chat font family. */
export const FONT_FAMILY_CSS: Record<FontFamilyId, string> = {
  system: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif', serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', sans: '"Heiti SC", "SimHei", "Microsoft YaHei", ui-sans-serif, sans-serif', songti: '"Songti SC", "SimSun", serif', kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif', rounded: 'ui-rounded, "Yuanti SC", "PingFang SC", sans-serif', 'jetbrains-mono': '"JetBrains Mono", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono NFM", "JetBrainsMono NF", ui-monospace, "SF Mono", Menlo, Consolas, monospace', monospace: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
};
export const CODE_FONT_FAMILY_CSS: Record<CodeFontFamilyId, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "CloudCLI Nerd Symbols", monospace', 'jetbrains-mono': '"JetBrains Mono", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono NFM", "JetBrainsMono NF", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "CloudCLI Nerd Symbols", monospace', 'fira-code': '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "CloudCLI Nerd Symbols", monospace', 'cascadia-code': '"Cascadia Code", "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "CloudCLI Nerd Symbols", monospace', 'source-code-pro': '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "CloudCLI Nerd Symbols", monospace', hack: 'Hack, "Hack Nerd Font Mono", "Hack Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "CloudCLI Nerd Symbols", monospace', 'ibm-plex-mono': '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "CloudCLI Nerd Symbols", monospace',
};

// ---------------------------

//----------------- CLIPBOARD ------------

/**
 * Copies text with `document.execCommand`, the only path that works in browsers or
 * contexts where the async Clipboard API is unavailable. Private to `copyTextToClipboard`.
 */
function fallbackCopyToClipboard(text: string): boolean {
  if (!text || typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea when the Clipboard API
 * is blocked. Resolves to whether the copy succeeded so callers can show copied feedback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  let copied = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = fallbackCopyToClipboard(text);
  }

  return copied;
}

// ---------------------------

//----------------- NOTIFICATION SOUND ------------

/** localStorage key holding the user's completion-sound preference. Private to the sound helpers. */
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';

/** The browser's AudioContext constructor, including the webkit-prefixed fallback; undefined outside a browser. */
const AudioContextConstructor =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

/** Lazily created and reused, because browsers cap how many AudioContexts a page may open. */
let audioContext: AudioContext | null = null;

/** Reports whether the user has left completion sounds on; defaults to on when unset. */
export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

/** Persists the user's completion-sound preference; call it from settings toggles. */
export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

/** Returns the shared AudioContext, creating it on first use. Private to the sound helpers. */
const getAudioContext = (): AudioContext | null => {
  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
};

/** Schedules one synthesized sine tone on the shared context. Private to `playNotificationSound`. */
const playTone = (
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  peakVolume: number,
): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startsAt);

  // Shape the volume so the synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(peakVolume, startsAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
};

/**
 * Plays the two-tone notification chime, honouring the user's preference unless `force`
 * is set (settings previews pass `force` so the user can hear the sound while it is off).
 */
export const playNotificationSound = async ({ force = false } = {}): Promise<void> => {
  if (!force && !isNotificationSoundEnabled()) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    playTone(context, 740, now, 0.12, 0.075);
    playTone(context, 988, now + 0.11, 0.16, 0.06);
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

/** Plays the chime for a finished assistant turn; named for the chat call site it serves. */
export const playChatCompletionSound = (options = {}): Promise<void> => playNotificationSound(options);

// ---------------------------

//----------------- NOTIFICATION HAPTICS ------------

/** localStorage key holding the user's completion-vibration preference, mirroring the server-side `channels.vibration`. */
const NOTIFICATION_VIBRATION_ENABLED_STORAGE_KEY = 'notificationVibrationEnabled';

/** Which system feedback pattern a notification haptic should play. */
type NotificationHapticType = 'success' | 'warning' | 'error';

/** The single method of the app-local `Haptics` native plugin (ios/App/App/WebCachePlugin.swift) this client calls. */
type NotificationHapticsPlugin = {
  notification: (options: { type: NotificationHapticType }) => Promise<void>;
};

/**
 * Reports whether the page runs inside the Capacitor native shell (the iOS app) rather than a plain
 * browser. Gate native-only capabilities on it: the iOS WebView implements no Vibration API, so
 * haptics only exist through the bridge.
 */
export const isCapacitorNativeShell = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.(),
  );
};

/** Reports whether the user has left completion vibration on; defaults to on when unset, matching the server default. Private to the haptics helpers. */
const isNotificationVibrationEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_VIBRATION_ENABLED_STORAGE_KEY) !== 'false';
};

/** Persists the user's completion-vibration preference; call it from settings toggles. */
export const setNotificationVibrationEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_VIBRATION_ENABLED_STORAGE_KEY, String(enabled));
};

/**
 * Plays the iOS haptic that accompanies a notification, honouring the user's preference unless
 * `force` is set (settings previews pass `force` so the pattern can be felt while it is off).
 *
 * A no-op outside the native shell, and failures stay silent on purpose: a device without a Taptic
 * Engine (iPad, or "System Haptics" switched off) rejects the call, which must never break the
 * completion flow it accompanies.
 */
export const triggerNotificationHaptic = async (
  { type = 'success', force = false }: { type?: NotificationHapticType; force?: boolean } = {},
): Promise<void> => {
  if (!isCapacitorNativeShell() || (!force && !isNotificationVibrationEnabled())) {
    return;
  }

  const haptics = (window as unknown as { Capacitor?: { registerPlugin?: (name: string) => unknown } })
    .Capacitor?.registerPlugin?.('Haptics') as NotificationHapticsPlugin | undefined;
  if (!haptics) {
    return;
  }

  try {
    await haptics.notification({ type });
  } catch (error) {
    console.warn('Unable to trigger notification haptic:', error);
  }
};

// ---------------------------

//----------------- DOCUMENT TITLE ------------

/** Browser tab title shown when no project or session is selected. Private to the title helpers. */
const DEFAULT_PAGE_TITLE = 'CloudCLI UI';

/**
 * Resolves the human-readable label for a session: the persisted `summary` (the custom
 * name the sessions API returns for every provider, Cursor included), else the `name` a
 * Cursor session object may carry locally, else the provider's placeholder. Reads the
 * same fields in the same order as the sidebar row, so the header, document title and
 * sidebar never disagree about a session's name.
 */
export const getSessionTitle = (session: ProjectSession): string => {
  const title = (session.summary as string) || (session.name as string);
  if (session.__provider === 'cursor') {
    return title || 'Untitled Session';
  }

  return title || 'New Session';
};

/**
 * Builds the browser tab title for the current selection: the session title when one is
 * open, otherwise the project name, otherwise the app name.
 */
export const getPageTitle = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string => {
  if (selectedSession) {
    return getSessionTitle(selectedSession);
  }

  const displayName = selectedProject?.displayName?.trim();
  return displayName ? `${displayName} - ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};

// ---------------------------

//----------------- THEME CHROME ------------

/**
 * The colour `<meta name="theme-color">` falls back to while the token it follows is unavailable,
 * per appearance — the base `--background` each palette ships (§5.8 v8). A dark page falling back
 * to white would repaint the iOS status bar into the one state the palette was chosen to avoid.
 * Private to `applyThemeChrome`.
 */
const FALLBACK_THEME_COLOR = { light: '#f7f6f3', dark: '#141414' } as const;

/** How iOS paints the status bar per appearance, when a theme declares no opinion. Private to `applyThemeChrome`. */
const STATUS_BAR_BY_APPEARANCE = { light: 'default', dark: 'black-translucent' } as const;

/**
 * Resolves a triplet token (`44 22% 96%`) to the colour the browser paints for it, by writing
 * `hsl(var(--token))` — the declaration shape Tailwind emits — onto a probe and reading it back,
 * so expanding the `var()` chain stays the browser's job.
 *
 * Returns `''` rather than guessing when the token is not declared, or when it does not hold a
 * triplet: an undeclared token would otherwise resolve to the probe's inherited colour, and a
 * token holding a whole colour expression (`#282c34`) makes the declaration invalid and lands in
 * the same place — either way the caller would publish a colour that is not the theme's.
 * Private to `applyThemeChrome`.
 */
function readTokenColor(token: string): string {
  if (typeof document === 'undefined') {
    return '';
  }

  if (!getComputedStyle(document.documentElement).getPropertyValue(token).trim()) {
    return '';
  }

  const probe = document.createElement('div');
  probe.style.display = 'none';
  // `src/index.css` transitions colours for 200ms on an appearance switch, so a read taken inside
  // that window returns the colour the transition started from rather than the new palette.
  probe.style.transition = 'none';
  probe.style.color = `hsl(var(${token}))`;
  if (!probe.style.color) {
    return '';
  }
  document.body.appendChild(probe);

  try {
    return getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }
}

/** Splits a computed `rgb()` / `rgba()` colour into 8-bit channels plus alpha; `null` when unparsable. Private to `resolveOpaqueTokenColor`. */
function parseColorChannels(color: string): { channels: [number, number, number]; alpha: number } | null {
  const match = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (!match) {
    return null;
  }

  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    channels: [parts[0], parts[1], parts[2]],
    alpha: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1,
  };
}

/** Formats 8-bit channels as `#rrggbb`. Private to `resolveOpaqueTokenColor`. */
const toHexColor = (channels: number[]): string =>
  `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/**
 * Resolves a token to the opaque `#rrggbb` the browser chrome has to be given — the OS paints that
 * chrome itself, so a translucent colour has nothing to blend against. A translucent token is
 * flattened onto `backdropToken` (the page behind the chrome); resolution fails (`''`) when that
 * backdrop is missing or translucent too, leaving the caller's fallback in place.
 * Private to `applyThemeChrome`.
 */
function resolveOpaqueTokenColor(token: string, backdropToken = '--background'): string {
  const color = parseColorChannels(readTokenColor(token));
  if (!color) {
    return '';
  }

  if (color.alpha >= 1) {
    return toHexColor(color.channels);
  }

  const backdrop = token === backdropToken ? null : parseColorChannels(readTokenColor(backdropToken));
  if (!backdrop || backdrop.alpha < 1) {
    return '';
  }

  return toHexColor(
    color.channels.map((channel, index) =>
      Math.round(channel * color.alpha + backdrop.channels[index] * (1 - color.alpha)),
    ),
  );
}

/**
 * Publishes the resolved appearance to the browser chrome, which sits outside the page and so
 * cannot read a token: `<meta name="theme-color">` (the OS status bar on iOS, the address bar
 * elsewhere) and the iOS `apple-mobile-web-app-status-bar-style`. A theme overrides either through
 * `ThemeManifest.themeColor` (a token name) and `ThemeManifest.statusBar`.
 *
 * The tab favicon follows the same appearance: the shell ships the light render as the static
 * default and the first-paint script in `index.html` swaps it for the dark render on a dark start,
 * so this only has to republish on later switches.
 *
 * Called by `ThemeContext` on every appearance change and by the theme-token fixture, so a test can
 * drive the production chain rather than re-typing it.
 */
export function applyThemeChrome(
  appearance: 'light' | 'dark',
  overrides?: Pick<ThemeManifest, 'themeColor' | 'statusBar'>,
): void {
  if (typeof document === 'undefined') {
    return;
  }

  const statusBar = overrides?.statusBar ?? STATUS_BAR_BY_APPEARANCE[appearance];
  document
    .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute('content', statusBar);

  const themeColor =
    resolveOpaqueTokenColor(overrides?.themeColor ?? '--background') || FALLBACK_THEME_COLOR[appearance];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

  document
    .querySelector('link[rel="icon"]')
    ?.setAttribute('href', `/icons/favicon-${appearance}-32.png`);
}
//----------------- SLASH COMMANDS ------------

/**
 * Whether a slash command is a provider skill (as opposed to a built-in or a
 * custom `.md` command). Skills are mapped with `type: 'skill'`; the metadata
 * check catches entries that only carry the skill marker there. Used wherever
 * commands are grouped or executed differently by kind.
 */
export const isSkillCommand = (command: SlashCommand): boolean =>
  command.type === 'skill' || command.metadata?.type === 'skill';

// ---------------------------

//----------------- QUICK SETTINGS PANEL ------------

/** DOM id of a quick settings tab button; pairs with `getQuickSettingsTabPanelId` for aria-controls / aria-labelledby. */
export const getQuickSettingsTabId = (tab: QuickSettingsTab): string => `quick-settings-tab-${tab}`;

/** DOM id of the tabpanel a quick settings tab controls; pairs with `getQuickSettingsTabId`. */
export const getQuickSettingsTabPanelId = (tab: QuickSettingsTab): string => `quick-settings-tabpanel-${tab}`;
