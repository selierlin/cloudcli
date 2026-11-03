import {
  Braces,
  CaseSensitive,
  Palette,
  SunMoon,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Select, ThemeModeSelector } from '@/shared/ui';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import { useAutoHideScrollbar } from '@/shared/hooks/useAutoHideScrollbar';
import { useThemeOptions } from '@/shared/hooks/useThemeOptions';
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
  /** Published with the whole-session share; null for a not-yet-persisted session. */
  sessionId?: string | null;
  provider: LLMProvider;
  selectedProject: Project | null;
  exportExpanded: boolean;
  onExportToggle: () => void;
  isLoading: boolean;
};

/**
 * The select rows stack their label above the control, unlike `SETTING_ROW_CLASS`,
 * which puts label and control side by side. Side by side, the control could only
 * be as wide as the row's leftover space and every row would end up a different
 * width — the panel can be dragged down to 240px, where one shared width that
 * still fits a theme name beside "聊天 / 界面字号" does not exist. Full width keeps
 * every control identical and aligned on both edges at any panel width.
 */
const SELECT_ROW_CLASS =
  'flex flex-col gap-2 rounded-lg border border-transparent bg-muted/60 p-3 transition-colors hover:border-border hover:bg-accent';

type SelectRowProps = {
  icon: typeof Palette;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
};

/** One appearance row of the drawer: a labelled select spanning the row's width. */
function SelectRow({ icon: Icon, label, value, onChange, children }: SelectRowProps) {
  return (
    <label className={SELECT_ROW_CLASS}>
      <span className="flex items-center gap-2 text-sm text-foreground">
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        {label}
      </span>
      <Select className="w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </Select>
    </label>
  );
}

/** Rendered by QuickSettingsPanelView to show the drawer's appearance rows and conversation export. The remaining chat preferences live in the settings dialog's chat tab. */
export default function QuickSettingsContent({
  messages,
  sessionTitle,
  sessionId,
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
  // The drawer only offers a compact switcher; the badge-and-hint picker stays
  // in the settings dialog, which is why the shared options come through a
  // plain select here.
  const { options, selectedId, setThemeId } = useThemeOptions();
  const autoHideScrollbarRef = useAutoHideScrollbar();

  return (
    <div ref={autoHideScrollbarRef} className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            <SunMoon className="h-4 w-4 text-muted-foreground" />
            {t('quickSettings.theme')}
          </span>
          <ThemeModeSelector />
        </div>
        <SelectRow
          icon={Palette}
          label={t('themeSelector.label')}
          value={selectedId ?? ''}
          onChange={(value) => setThemeId(value === '' ? null : value)}
        >
          {options.map((option) => (
            <option key={option.id ?? 'default'} value={option.id ?? ''}>
              {option.nameEn ? `${option.label} · ${option.nameEn}` : option.label}
            </option>
          ))}
        </SelectRow>
        <SelectRow
          icon={Type}
          label={t('appearanceSettings.fontSettings.uiFontSize.label')}
          value={uiFontSize}
          onChange={setUiFontSize}
        >
          {UI_FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}px</option>)}
        </SelectRow>
        <SelectRow
          icon={CaseSensitive}
          label={t('appearanceSettings.fontSettings.fontFamily.label')}
          value={fontFamily}
          onChange={(value) => setFontFamily(value as FontFamilyId)}
        >
          {FONT_FAMILY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(`appearanceSettings.fontSettings.fontFamilyOptions.${option.id}`)}</option>)}
        </SelectRow>
        <SelectRow
          icon={Braces}
          label={t('appearanceSettings.fontSettings.codeFontSize.label')}
          value={codeFontSize}
          onChange={setCodeFontSize}
        >
          {CODE_FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}px</option>)}
        </SelectRow>
        <SelectRow
          icon={Braces}
          label={t('appearanceSettings.fontSettings.codeFontFamily.label')}
          value={codeFontFamily}
          onChange={(value) => setCodeFontFamily(value as CodeFontFamilyId)}
        >
          {CODE_FONT_FAMILY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{t(`appearanceSettings.fontSettings.codeFontFamilyOptions.${option.id}`)}</option>)}
        </SelectRow>
      </QuickSettingsSection>

      <QuickSettingsExportSection
        messages={messages}
        sessionTitle={sessionTitle}
        sessionId={sessionId}
        provider={provider}
        selectedProject={selectedProject}
        isOpen={exportExpanded}
        onToggle={onExportToggle}
        isLoading={isLoading}
      />
    </div>
  );
}
