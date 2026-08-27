import type { ComponentType } from 'react';
import {
  Bell,
  Bot,
  GitBranch,
  Info,
  KeyRound,
  ListChecks,
  MonitorPlay,
  Palette,
  Plug,
} from 'lucide-react';

import type {
  AgentCategory,
  AgentProvider,
  CodeEditorSettingsState,
  CodeFontFamilyId,
  CursorPermissionsState,
  FontFamilyId,
  FontSettingsState,
  ProjectSortOrder,
  SettingsMainTab,
} from '../types/types';

export type SettingsMainTabMeta = {
  id: SettingsMainTab;
  label: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
};

export const SETTINGS_MAIN_TABS: SettingsMainTabMeta[] = [
  { id: 'agents', label: 'Agents', keywords: 'agents subagents claude code', icon: Bot },
  { id: 'appearance', label: 'Appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'git', label: 'Git', keywords: 'git github commits', icon: GitBranch },
  { id: 'api', label: 'API Tokens', keywords: 'api tokens auth keys', icon: KeyRound },
  { id: 'tasks', label: 'Tasks', keywords: 'tasks taskmaster', icon: ListChecks },
  { id: 'browser', label: 'Browser', keywords: 'browser playwright chromium automation', icon: MonitorPlay },
  { id: 'notifications', label: 'Notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'plugins', label: 'Plugins', keywords: 'plugins extensions integrations', icon: Plug },
  { id: 'about', label: 'About', keywords: 'about version info', icon: Info },
];

export const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy'];
export const AGENT_CATEGORIES: AgentCategory[] = ['account', 'permissions', 'mcp'];

export const DEFAULT_PROJECT_SORT_ORDER: ProjectSortOrder = 'date';
export const DEFAULT_SAVE_STATUS = null;
export const DEFAULT_CODE_EDITOR_SETTINGS: CodeEditorSettingsState = {
  wordWrap: false,
  showMinimap: true,
  lineNumbers: true,
  fontSize: '14',
};

export const DEFAULT_FONT_SETTINGS: FontSettingsState = {
  uiFontSize: '14',
  terminalFontSize: '14',
  fontFamily: 'serif',
  codeFontSize: '13',
  codeFontFamily: 'system',
};

export const UI_FONT_SIZE_OPTIONS = ['13', '14', '15', '16', '17', '18'];
export const TERMINAL_FONT_SIZE_OPTIONS = ['11', '12', '13', '14', '15', '16'];
export const FONT_FAMILY_OPTIONS: Array<{ id: FontFamilyId; label: string }> = [
  { id: 'system', label: 'system' },
  { id: 'serif', label: 'serif' },
  { id: 'sans', label: 'sans' },
  { id: 'songti', label: 'songti' },
  { id: 'kaiti', label: 'kaiti' },
  { id: 'rounded', label: 'rounded' },
  { id: 'jetbrains-mono', label: 'jetbrains-mono' },
  { id: 'monospace', label: 'monospace' },
];

/** CSS font stacks for the available font-family choices. */
export const FONT_FAMILY_CSS: Record<FontFamilyId, string> = {
  system: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  sans: '"Heiti SC", "SimHei", "Microsoft YaHei", ui-sans-serif, sans-serif',
  songti: '"Songti SC", "SimSun", serif',
  kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif',
  rounded: 'ui-rounded, "Yuanti SC", "PingFang SC", sans-serif',
  'jetbrains-mono': '"JetBrains Mono", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono NFM", "JetBrainsMono NF", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  monospace: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
};

export const CODE_FONT_SIZE_OPTIONS = ['11', '12', '13', '14', '15', '16'];
export const CODE_FONT_FAMILY_OPTIONS: Array<{ id: CodeFontFamilyId; label: string }> = [
  { id: 'system', label: 'system' },
  { id: 'jetbrains-mono', label: 'jetbrains-mono' },
  { id: 'fira-code', label: 'fira-code' },
  { id: 'cascadia-code', label: 'cascadia-code' },
  { id: 'source-code-pro', label: 'source-code-pro' },
  { id: 'hack', label: 'hack' },
  { id: 'ibm-plex-mono', label: 'ibm-plex-mono' },
];

/** CSS font stacks for the available code font-family choices. */
export const CODE_FONT_FAMILY_CSS: Record<CodeFontFamilyId, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  'jetbrains-mono': '"JetBrains Mono", "JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrainsMono NFM", "JetBrainsMono NF", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'fira-code': '"Fira Code", "Fira Code Retina", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'cascadia-code': '"Cascadia Code", "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'source-code-pro': '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  hack: 'Hack, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'ibm-plex-mono': '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

const FONT_SETTINGS_KEYS: Record<keyof FontSettingsState, string> = {
  uiFontSize: 'uiFontSize',
  terminalFontSize: 'terminalFontSize',
  fontFamily: 'fontFamily',
  codeFontSize: 'codeFontSize',
  codeFontFamily: 'codeFontFamily',
};

/** Reads font settings from localStorage, falling back to defaults. */
export const readFontSettings = (): FontSettingsState => {
  const value = (key: keyof FontSettingsState): string | null =>
    localStorage.getItem(`fontSettings.${FONT_SETTINGS_KEYS[key]}`);

  const uiFontSize = value('uiFontSize') ?? DEFAULT_FONT_SETTINGS.uiFontSize;
  const terminalFontSize = value('terminalFontSize') ?? DEFAULT_FONT_SETTINGS.terminalFontSize;
  const rawFamily = value('fontFamily');
  const fontFamily: FontFamilyId = FONT_FAMILY_OPTIONS.some((o) => o.id === rawFamily)
    ? (rawFamily as FontFamilyId)
    : 'serif';
  const codeFontSize = value('codeFontSize') ?? DEFAULT_FONT_SETTINGS.codeFontSize;
  const rawCodeFamily = value('codeFontFamily');
  const codeFontFamily: CodeFontFamilyId = CODE_FONT_FAMILY_OPTIONS.some((o) => o.id === rawCodeFamily)
    ? (rawCodeFamily as CodeFontFamilyId)
    : 'system';

  return { uiFontSize, terminalFontSize, fontFamily, codeFontSize, codeFontFamily };
};

/** Persists font settings to localStorage. */
export const writeFontSettings = (settings: FontSettingsState): void => {
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.uiFontSize}`, settings.uiFontSize);
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.terminalFontSize}`, settings.terminalFontSize);
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.fontFamily}`, settings.fontFamily);
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.codeFontSize}`, settings.codeFontSize);
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.codeFontFamily}`, settings.codeFontFamily);
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};
