import { memo, useCallback, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useQuickSettingsDrag } from '@/modules/quick-settings-panel/hooks/useQuickSettingsDrag';
import { useSessionOutlineData } from '@/modules/quick-settings-panel/hooks/useSessionOutlineData';
import { useProjectMainState } from '@/modules/project-workspace';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import QuickSettingsHandle from '@/modules/quick-settings-panel/QuickSettingsHandle';
import QuickSettingsPanelHeader from '@/modules/quick-settings-panel/QuickSettingsPanelHeader';
import QuickSettingsOutline from '@/modules/quick-settings-panel/QuickSettingsOutline';

/** Exported as QuickSettingsPanel and rendered by the project-workspace module as its slide-out quick settings drawer. */
function QuickSettingsPanelView() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'outline'>('settings');
  const [exportExpanded, setExportExpanded] = useState(false);
  const { t } = useTranslation('settings');
  const { selectedProject, selectedSession, handleSessionSelect } = useProjectMainState();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

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

  const { outlineItems, chatMessages, isLoading } = useSessionOutlineData({
    isOpen,
    selectedSession,
    activeTab,
    exportExpanded,
  });

  const handleJumpToMessage = useCallback((timestamp: string, snippet: string) => {
    if (!selectedSession) return;
    handleSessionSelect({
      ...selectedSession,
      __searchTargetTimestamp: timestamp,
      __searchTargetSnippet: snippet,
    });
  }, [handleSessionSelect, selectedSession]);

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
        className={`fixed right-0 top-0 z-[9999] h-full w-64 transform border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} ${isMobile ? 'h-screen' : ''}`}
      >
        <div className="flex h-full flex-col">
          <QuickSettingsPanelHeader />
          <div className="flex gap-1 border-b border-border px-3 py-2">
            <button type="button" onClick={() => setActiveTab('settings')} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${activeTab === 'settings' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              {t('quickSettings.tabs.settings')}
            </button>
            <button type="button" onClick={() => setActiveTab('outline')} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${activeTab === 'outline' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              {t('quickSettings.tabs.outline')}
            </button>
          </div>
          {activeTab === 'settings' ? (
            <QuickSettingsContent
              preferences={quickSettingsPreferences}
              onPreferenceChange={handlePreferenceChange}
              messages={chatMessages}
              sessionTitle={selectedSession?.title}
              provider={selectedSession?.__provider ?? selectedSession?.provider ?? 'claude'}
              selectedProject={selectedProject}
              exportExpanded={exportExpanded}
              onExportToggle={() => setExportExpanded((previous) => !previous)}
              isLoading={isLoading}
            />
          ) : (
            <QuickSettingsOutline items={outlineItems} isLoading={isLoading} onJumpToMessage={handleJumpToMessage} />
          )}
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[9998] bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

export default memo(QuickSettingsPanelView);
