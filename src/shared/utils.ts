import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { CodeFontFamilyId, FontFamilyId, FontSettingsState, Project, ProjectSession } from '@/shared/types';

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

/** CSS stacks matching every selectable chat font family. */
export const FONT_FAMILY_CSS: Record<FontFamilyId, string> = {
  system: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif', serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif', sans: '"Heiti SC", "SimHei", "Microsoft YaHei", ui-sans-serif, sans-serif', songti: '"Songti SC", "SimSun", serif', kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif', rounded: 'ui-rounded, "Yuanti SC", "PingFang SC", sans-serif', 'jetbrains-mono': '"JetBrains Mono", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono NFM", "JetBrainsMono NF", ui-monospace, "SF Mono", Menlo, Consolas, monospace', monospace: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
};
export const CODE_FONT_FAMILY_CSS: Record<CodeFontFamilyId, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', 'jetbrains-mono': '"JetBrains Mono", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono NFM", "JetBrainsMono NF", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 'fira-code': '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 'cascadia-code': '"Cascadia Code", "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 'source-code-pro': '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', hack: 'Hack, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', 'ibm-plex-mono': '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

const DEFAULT_FONT_SETTINGS: FontSettingsState = { uiFontSize: '14', terminalFontSize: '14', fontFamily: 'serif', codeFontSize: '13', codeFontFamily: 'system' };

/** Reads and validates local font choices, falling back to the transcript defaults. */
export function readFontSettings(): FontSettingsState {
  const get = (key: keyof FontSettingsState) => localStorage.getItem(`fontSettings.${key}`);
  const fontFamily = get('fontFamily');
  const codeFontFamily = get('codeFontFamily');
  return {
    uiFontSize: get('uiFontSize') ?? DEFAULT_FONT_SETTINGS.uiFontSize,
    terminalFontSize: get('terminalFontSize') ?? DEFAULT_FONT_SETTINGS.terminalFontSize,
    fontFamily: FONT_FAMILY_OPTIONS.some(({ id }) => id === fontFamily) ? fontFamily as FontFamilyId : DEFAULT_FONT_SETTINGS.fontFamily,
    codeFontSize: get('codeFontSize') ?? DEFAULT_FONT_SETTINGS.codeFontSize,
    codeFontFamily: CODE_FONT_FAMILY_OPTIONS.some(({ id }) => id === codeFontFamily) ? codeFontFamily as CodeFontFamilyId : DEFAULT_FONT_SETTINGS.codeFontFamily,
  };
}

/** Persists all local chat font choices together. */
export function writeFontSettings(settings: FontSettingsState): void {
  for (const [key, value] of Object.entries(settings)) localStorage.setItem(`fontSettings.${key}`, value);
}

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

//----------------- DOCUMENT TITLE ------------

/** Browser tab title shown when no project or session is selected. Private to the title helpers. */
const DEFAULT_PAGE_TITLE = 'CloudCLI UI';

/**
 * Resolves the human-readable label for a session, accounting for Cursor sessions that
 * carry a `name` instead of the summary the other providers return.
 */
export const getSessionTitle = (session: ProjectSession): string => {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
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
