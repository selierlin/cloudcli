import { useTranslation } from 'react-i18next';

import { Select, ThemeModeSelector } from '@/shared/ui';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import {
  CODE_FONT_FAMILY_OPTIONS,
  CODE_FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
} from '@/shared/utils';
import type { CodeEditorSettingsState, CodeFontFamilyId, FontFamilyId, ProjectSortOrder, TerminalFontFamilyId } from '@/shared/types';
import { LanguageSelector } from '@/modules/i18n';
import { useChatFontSettings } from '@/modules/quick-settings-panel';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import ThemeSelector from '@/modules/settings/ThemeSelector';
import TokenPreviewSection from '@/modules/settings/TokenPreviewSection';
import UserThemesSection from '@/modules/settings/UserThemesSection';

/**
 * One width for every select in this tab, so the controls read as a column: wide
 * enough for the longest font name ("Source Code Pro") once the arrow's space is
 * reserved, and full-width on narrow screens, where a fixed width would crowd
 * the label.
 */
const SELECT_CLASS = 'w-full sm:w-40';

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
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();

  return (
    <div className="space-y-8">
      <SettingsSection title={t('themeMode.label')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('themeMode.label')}
            description={t('themeMode.description')}
          >
            <ThemeModeSelector ariaLabel={t('themeMode.label')} />
          </SettingsRow>

          {/* The selector's grid owns the full row width on every layout, so this
              row stacks on all sizes rather than reserving a side column like
              the rows with compact controls do. */}
          <SettingsRow
            label={t('themeSelector.label')}
            description={t('themeSelector.description')}
            className="flex-col items-stretch gap-2"
          >
            <ThemeSelector ariaLabel={t('themeSelector.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <UserThemesSection />

      <TokenPreviewSection />

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
            <Select
              className={SELECT_CLASS}
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.keepProjectsExpanded.section', { defaultValue: 'Sidebar' })}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.keepProjectsExpanded.label', { defaultValue: 'Keep projects expanded' })}
            description={t('appearanceSettings.keepProjectsExpanded.description', { defaultValue: 'Open several projects together and remember them after reloading.' })}
          >
            <SettingsToggle
              checked={preferences.keepProjectsExpanded}
              onChange={(value) => setPreference('keepProjectsExpanded', value)}
              ariaLabel={t('appearanceSettings.keepProjectsExpanded.label', { defaultValue: 'Keep projects expanded' })}
            />
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
            <Select
              className={SELECT_CLASS}
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
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
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.fontSettings.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.fontSettings.uiFontSize.label')}
            description={t('appearanceSettings.fontSettings.uiFontSize.description')}
          >
            <Select
              className={SELECT_CLASS}
              value={fontSettings.uiFontSize}
              onChange={(event) => fontSettings.setUiFontSize(event.target.value)}
            >
              {UI_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.terminalFontSize.label')}
            description={t('appearanceSettings.fontSettings.terminalFontSize.description')}
          >
            <Select
              className={SELECT_CLASS}
              value={fontSettings.terminalFontSize}
              onChange={(event) => fontSettings.setTerminalFontSize(event.target.value)}
            >
              {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.terminalFontFamily.label')}
            description={t('appearanceSettings.fontSettings.terminalFontFamily.description')}
          >
            <Select
              className={SELECT_CLASS}
              value={fontSettings.terminalFontFamily}
              onChange={(event) => fontSettings.setTerminalFontFamily(event.target.value as TerminalFontFamilyId)}
            >
              {TERMINAL_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id === 'theme'
                    ? t('appearanceSettings.fontSettings.terminalFontFamilyOptions.theme')
                    : t(`appearanceSettings.fontSettings.codeFontFamilyOptions.${option.id}`)}
                </option>
              ))}
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.fontFamily.label')}
            description={t('appearanceSettings.fontSettings.fontFamily.description')}
          >
            <Select
              className={SELECT_CLASS}
              value={fontSettings.fontFamily}
              onChange={(event) => fontSettings.setFontFamily(event.target.value as FontFamilyId)}
            >
              {FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`appearanceSettings.fontSettings.fontFamilyOptions.${option.id}`)}
                </option>
              ))}
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.codeFontSize.label')}
            description={t('appearanceSettings.fontSettings.codeFontSize.description')}
          >
            <Select
              className={SELECT_CLASS}
              value={fontSettings.codeFontSize}
              onChange={(event) => fontSettings.setCodeFontSize(event.target.value)}
            >
              {CODE_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </Select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.codeFontFamily.label')}
            description={t('appearanceSettings.fontSettings.codeFontFamily.description')}
          >
            <Select
              className={SELECT_CLASS}
              value={fontSettings.codeFontFamily}
              onChange={(event) => fontSettings.setCodeFontFamily(event.target.value as CodeFontFamilyId)}
            >
              {CODE_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`appearanceSettings.fontSettings.codeFontFamilyOptions.${option.id}`)}
                </option>
              ))}
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
