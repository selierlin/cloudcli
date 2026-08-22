import { useTranslation } from 'react-i18next';

import { DarkModeToggle } from '../../../../shared/view/ui';
import type {
  CodeEditorSettingsState,
  FontFamilyId,
  FontSettingsState,
  ProjectSortOrder,
} from '../../types/types';
import {
  FONT_FAMILY_OPTIONS,
  TERMINAL_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
} from '../../constants/constants';
import LanguageSelector from '../../../../shared/view/ui/LanguageSelector';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
  fontSettings: FontSettingsState;
  onUiFontSizeChange: (value: string) => void;
  onTerminalFontSizeChange: (value: string) => void;
  onFontFamilyChange: (value: FontFamilyId) => void;
};

const SELECT_CLASS =
  'appearance-none w-full rounded-lg border border-input bg-card p-2.5 pr-10 text-sm text-foreground touch-manipulation focus:border-primary focus:ring-1 focus:ring-primary sm:w-28';

export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
  fontSettings,
  onUiFontSizeChange,
  onTerminalFontSizeChange,
  onFontFamilyChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
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
              className="w-full touch-manipulation appearance-none rounded-lg border border-input bg-card p-2.5 pr-10 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
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
              className="w-full touch-manipulation appearance-none rounded-lg border border-input bg-card p-2.5 pr-10 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
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
              onChange={(event) => onUiFontSizeChange(event.target.value)}
              className={SELECT_CLASS}
            >
              {UI_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.terminalFontSize.label')}
            description={t('appearanceSettings.fontSettings.terminalFontSize.description')}
          >
            <select
              value={fontSettings.terminalFontSize}
              onChange={(event) => onTerminalFontSizeChange(event.target.value)}
              className={SELECT_CLASS}
            >
              {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fontSettings.fontFamily.label')}
            description={t('appearanceSettings.fontSettings.fontFamily.description')}
          >
            <select
              value={fontSettings.fontFamily}
              onChange={(event) => onFontFamilyChange(event.target.value as FontFamilyId)}
              className={`${SELECT_CLASS} sm:w-36`}
            >
              {FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(`appearanceSettings.fontSettings.fontFamilyOptions.${option.id}`)}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
