import { SunMoon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThemeModeSelector } from '../../../shared/view/ui';
import LanguageSelector from '../../../shared/view/ui/LanguageSelector';
import {
  INPUT_SETTING_TOGGLES,
  SETTING_ROW_CLASS,
  TOOL_DISPLAY_TOGGLES,
} from '../constants';
import type {
  PreferenceToggleItem,
  PreferenceToggleKey,
  QuickSettingsPreferences,
} from '../types';

import QuickSettingsSection from './QuickSettingsSection';
import QuickSettingsToggleRow from './QuickSettingsToggleRow';

type QuickSettingsContentProps = {
  preferences: QuickSettingsPreferences;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
};

export default function QuickSettingsContent({
  preferences,
  onPreferenceChange,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
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
    </div>
  );
}
