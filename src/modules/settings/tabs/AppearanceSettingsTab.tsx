import { useTranslation } from 'react-i18next';

import { ThemeModeSelector } from '@/shared/ui';
import {
  CODE_FONT_FAMILY_OPTIONS,
  CODE_FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
} from '@/shared/utils';
import type { CodeEditorSettingsState, CodeFontFamilyId, FontFamilyId, ProjectSortOrder } from '@/shared/types';
import { LanguageSelector } from '@/modules/i18n';
import { useChatFontSettings } from '@/modules/quick-settings-panel';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

const FONT_SELECT_CLASS =
  'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

/** Rendered by Settings for the "appearance" tab, covering theme, project sorting and code editor preferences. */
export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const fontSettings = useChatFontSettings();

  return (
    <div className="space-y-8">
      <SettingsSection title={t('themeMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('themeMode.label')}
            description={t('themeMode.description')}
          >
            <ThemeModeSelector ariaLabel={t('themeMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.fontSettings.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.fontSettings.uiFontSize.label')}
            description={t('appearanceSettings.fontSettings.uiFontSize.description')}
          >
            <select
              value={fontSettings.uiFontSize}
              onChange={(event) => fontSettings.setUiFontSize(event.target.value)}
              className={FONT_SELECT_CLASS}
            >
              {UI_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.terminalFontSize.label')}
            description={t('appearanceSettings.fontSettings.terminalFontSize.description')}
          >
            <select
              value={fontSettings.terminalFontSize}
              onChange={(event) => fontSettings.setTerminalFontSize(event.target.value)}
              className={FONT_SELECT_CLASS}
            >
              {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.fontFamily.label')}
            description={t('appearanceSettings.fontSettings.fontFamily.description')}
          >
            <select
              value={fontSettings.fontFamily}
              onChange={(event) => fontSettings.setFontFamily(event.target.value as FontFamilyId)}
              className={FONT_SELECT_CLASS}
            >
              {FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`appearanceSettings.fontSettings.fontFamilyOptions.${option.id}`)}
                </option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.codeFontSize.label')}
            description={t('appearanceSettings.fontSettings.codeFontSize.description')}
          >
            <select
              value={fontSettings.codeFontSize}
              onChange={(event) => fontSettings.setCodeFontSize(event.target.value)}
              className={FONT_SELECT_CLASS}
            >
              {CODE_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.codeFontFamily.label')}
            description={t('appearanceSettings.fontSettings.codeFontFamily.description')}
          >
            <select
              value={fontSettings.codeFontFamily}
              onChange={(event) => fontSettings.setCodeFontFamily(event.target.value as CodeFontFamilyId)}
              className={FONT_SELECT_CLASS}
            >
              {CODE_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`appearanceSettings.fontSettings.codeFontFamilyOptions.${option.id}`)}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
