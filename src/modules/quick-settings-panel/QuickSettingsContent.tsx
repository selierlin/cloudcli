import {
  Braces,
  CaseSensitive,
  SunMoon,
  Type,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ThemeModeSelector } from '@/shared/ui';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import {
  CODE_FONT_FAMILY_OPTIONS,
  CODE_FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
} from '@/shared/utils';
import type { ChatMessage, CodeFontFamilyId, FontFamilyId, LLMProvider, Project } from '@/shared/types';
import { useChatFontSettings } from '@/modules/quick-settings-panel/hooks/useChatFontSettings';
import QuickSettingsExportSection from '@/modules/quick-settings-panel/QuickSettingsExportSection';
import QuickSettingsSection from '@/modules/quick-settings-panel/QuickSettingsSection';

type QuickSettingsContentProps = {
  messages: ChatMessage[];
  sessionTitle?: string;
  provider: LLMProvider;
  selectedProject: Project | null;
  exportExpanded: boolean;
  onExportToggle: () => void;
  isLoading: boolean;
};

const FONT_SELECT_CLASS =
  'min-w-[96px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary';

/** Rendered by QuickSettingsPanelView to show the drawer's appearance rows and conversation export. The remaining chat preferences live in the settings dialog's chat tab. */
export default function QuickSettingsContent({
  messages,
  sessionTitle,
  provider,
  selectedProject,
  exportExpanded,
  onExportToggle,
  isLoading,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const {
    uiFontSize,
    fontFamily,
    codeFontSize,
    codeFontFamily,
    setUiFontSize,
    setFontFamily,
    setCodeFontSize,
    setCodeFontFamily,
  } = useChatFontSettings();

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
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground"><Type className="h-4 w-4 text-muted-foreground" />{t('appearanceSettings.fontSettings.uiFontSize.label')}</span>
          <select value={uiFontSize} onChange={(event) => setUiFontSize(event.target.value)} className={FONT_SELECT_CLASS}>
            {UI_FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}px</option>)}
          </select>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground"><CaseSensitive className="h-4 w-4 text-muted-foreground" />{t('appearanceSettings.fontSettings.fontFamily.label')}</span>
          <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value as FontFamilyId)} className={FONT_SELECT_CLASS}>
            {FONT_FAMILY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(`appearanceSettings.fontSettings.fontFamilyOptions.${option.id}`)}</option>)}
          </select>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground"><Braces className="h-4 w-4 text-muted-foreground" />{t('appearanceSettings.fontSettings.codeFontSize.label')}</span>
          <select value={codeFontSize} onChange={(event) => setCodeFontSize(event.target.value)} className={FONT_SELECT_CLASS}>
            {CODE_FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}px</option>)}
          </select>
        </div>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground"><Braces className="h-4 w-4 text-muted-foreground" />{t('appearanceSettings.fontSettings.codeFontFamily.label')}</span>
          <select value={codeFontFamily} onChange={(event) => setCodeFontFamily(event.target.value as CodeFontFamilyId)} className={FONT_SELECT_CLASS}>
            {CODE_FONT_FAMILY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(`appearanceSettings.fontSettings.codeFontFamilyOptions.${option.id}`)}</option>)}
          </select>
        </div>
      </QuickSettingsSection>

      <QuickSettingsExportSection
        messages={messages}
        sessionTitle={sessionTitle}
        provider={provider}
        selectedProject={selectedProject}
        isOpen={exportExpanded}
        onToggle={onExportToggle}
        isLoading={isLoading}
      />
    </div>
  );
}
