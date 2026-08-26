import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

import type { ProjectSession } from '../../types/app';

export type QuickSettingsTab = 'settings' | 'outline';

/** One lightweight user-turn entry in the QuickSettings outline list. */
export type SessionOutlineItem = {
  timestamp: string;
  snippet: string;
};

export type QuickSettingsPanelProps = {
  selectedSession: ProjectSession | null;
  onJumpToMessage: (timestamp: string, snippet: string) => void;
};

export type PreferenceToggleKey =
  | 'showRawParameters'
  | 'showThinking'
  | 'sendByCtrlEnter'
  | 'voiceEnabled';

export type QuickSettingsPreferences = Record<PreferenceToggleKey, boolean>;

export type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

export type QuickSettingsHandleStyle = CSSProperties;
