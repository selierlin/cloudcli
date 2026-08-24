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
  monospace: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
};

const FONT_SETTINGS_KEYS: Record<keyof FontSettingsState, string> = {
  uiFontSize: 'uiFontSize',
  terminalFontSize: 'terminalFontSize',
  fontFamily: 'fontFamily',
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

  return { uiFontSize, terminalFontSize, fontFamily };
};

/** Persists font settings to localStorage. */
export const writeFontSettings = (settings: FontSettingsState): void => {
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.uiFontSize}`, settings.uiFontSize);
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.terminalFontSize}`, settings.terminalFontSize);
  localStorage.setItem(`fontSettings.${FONT_SETTINGS_KEYS.fontFamily}`, settings.fontFamily);
};

export const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};
