import { CaseSensitive, SunMoon, Terminal, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '../../chat/types/types';
import {
  FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
} from '../../settings/constants/constants';
import type { FontFamilyId } from '../../settings/types/types';
import { ThemeModeSelector } from '../../../shared/view/ui';
import LanguageSelector from '../../../shared/view/ui/LanguageSelector';
import {
  INPUT_SETTING_TOGGLES,
  SETTING_ROW_CLASS,
  TOOL_DISPLAY_TOGGLES,
} from '../constants';
import { useChatFontSettings } from '../hooks/useChatFontSettings';
import type {
  PreferenceToggleItem,
  PreferenceToggleKey,
  QuickSettingsPreferences,
} from '../types';

import QuickSettingsExportSection from './QuickSettingsExportSection';
import QuickSettingsSection from './QuickSettingsSection';
import QuickSettingsToggleRow from './QuickSettingsToggleRow';

const FONT_SELECT_CLASS =
  'w-auto min-w-[100px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary';

type QuickSettingsContentProps = {
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
  messages: ChatMessage[];
  sessionTitle?: string;
  /** Controlled expand state of the export section (loads the full transcript). */
  exportExpanded: boolean;
  onExportToggle: () => void;
  /** True while the full transcript is being fetched for export. */
  isLoading: boolean;
};

export default function QuickSettingsContent({
  preferences,
  onPreferenceChange,
  messages,
  sessionTitle,
  exportExpanded,
  onExportToggle,
  isLoading,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const {
    uiFontSize,
    terminalFontSize,
    fontFamily,
    setUiFontSize,
    setTerminalFontSize,
    setFontFamily,
  } = useChatFontSettings();
  const inputSettingToggles = preferences.voiceEnabled
    ? INPUT_SETTING_TOGGLES
    : INPUT_SETTING_TOGGLES.filter(({ key }) => key !== 'voiceEnabled');

  const renderToggleRows = (items: PreferenceToggleItem[]) => (
    items.map(({ key, labelKey, icon }) => (
      <QuickSettingsToggleRow
        key={key}
        label={t(labelKey)}
        icon={icon}
        checked={preferences[key]}
        onCheckedChange={(value) => onPreferenceChange(key, value)}
      />
    ))
  );

  return (
    <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <SunMoon className="h-4 w-4 text-muted-foreground" />
            {t('quickSettings.theme')}
          </span>
          <ThemeModeSelector />
        </div>
        <LanguageSelector compact />
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Type className="h-4 w-4 text-muted-foreground" />
            {t('appearanceSettings.fontSettings.uiFontSize.label')}
          </span>
          <select
            value={uiFontSize}
            onChange={(event) => setUiFontSize(event.target.value)}
            className={FONT_SELECT_CLASS}
          >
            {UI_FONT_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <CaseSensitive className="h-4 w-4 text-muted-foreground" />
            {t('appearanceSettings.fontSettings.fontFamily.label')}
          </span>
          <select
            value={fontFamily}
            onChange={(event) => setFontFamily(event.target.value as FontFamilyId)}
            className={FONT_SELECT_CLASS}
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {t(`appearanceSettings.fontSettings.fontFamilyOptions.${option.id}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            {t('appearanceSettings.fontSettings.terminalFontSize.label')}
          </span>
          <select
            value={terminalFontSize}
            onChange={(event) => setTerminalFontSize(event.target.value)}
            className={FONT_SELECT_CLASS}
          >
            {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(inputSettingToggles)}
        <p className="ml-3 text-xs text-muted-foreground">
          {t('quickSettings.sendByCtrlEnterDescription')}
        </p>
      </QuickSettingsSection>

      <QuickSettingsExportSection
        messages={messages}
        sessionTitle={sessionTitle}
        isOpen={exportExpanded}
        onToggle={onExportToggle}
        isLoading={isLoading}
      />
    </div>
  );
}
