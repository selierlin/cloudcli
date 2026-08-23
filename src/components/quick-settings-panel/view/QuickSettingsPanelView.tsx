import { useCallback, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useTheme } from '../../../contexts/ThemeContext';
import { useQuickSettingsDrag } from '../hooks/useQuickSettingsDrag';
import { useSessionOutlineData } from '../hooks/useSessionOutlineData';
import type {
  PreferenceToggleKey,
  QuickSettingsPanelProps,
  QuickSettingsPreferences,
  QuickSettingsTab,
} from '../types';

import QuickSettingsContent from './QuickSettingsContent';
import QuickSettingsExportBar from './QuickSettingsExportBar';
import QuickSettingsHandle from './QuickSettingsHandle';
import QuickSettingsOutline from './QuickSettingsOutline';
import QuickSettingsPanelHeader from './QuickSettingsPanelHeader';

export default function QuickSettingsPanelView({
  selectedSession,
  onJumpToMessage,
}: QuickSettingsPanelProps) {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<QuickSettingsTab>('outline');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isDarkMode } = useTheme();
  const { preferences, setPreference } = useUiPreferences();
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const { chatMessages, isLoading } = useSessionOutlineData({ isOpen, selectedSession });

  const userMessages = useMemo(
    () => chatMessages.filter((message) => message.type === 'user'),
    [chatMessages],
  );

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(() => ({
    showRawParameters: preferences.showRawParameters,
    showThinking: preferences.showThinking,
    sendByCtrlEnter: preferences.sendByCtrlEnter,
    voiceEnabled: preferences.voiceEnabled,
  }), [
    preferences.sendByCtrlEnter,
    preferences.showRawParameters,
    preferences.showThinking,
    preferences.voiceEnabled,
  ]);

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      setIsOpen((previous) => !previous);
    },
    [consumeSuppressedClick],
  );

  const tabButtonClass = (tab: QuickSettingsTab) =>
    `flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
      activeTab === tab
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;

  return (
    <>
      <QuickSettingsHandle
        isOpen={isOpen}
        isDragging={isDragging}
        style={handleStyle}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      <div
        className={`fixed right-0 top-0 z-[9999] flex h-full w-80 transform flex-col border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} ${isMobile ? 'h-screen' : ''}`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <QuickSettingsPanelHeader />

        <div className="flex gap-1 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={tabButtonClass('settings')}
          >
            {t('quickSettings.tabs.settings')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('outline')}
            className={tabButtonClass('outline')}
          >
            {t('quickSettings.tabs.outline')}
          </button>
        </div>

        {activeTab === 'settings' ? (
          <QuickSettingsContent
            isDarkMode={isDarkMode}
            preferences={quickSettingsPreferences}
            onPreferenceChange={handlePreferenceChange}
          />
        ) : (
          <QuickSettingsOutline
            userMessages={userMessages}
            isLoading={isLoading}
            onJumpToMessage={onJumpToMessage}
          />
        )}

        <QuickSettingsExportBar
          messages={chatMessages}
          sessionTitle={selectedSession?.title}
        />
      </div>
    </>
  );
}
