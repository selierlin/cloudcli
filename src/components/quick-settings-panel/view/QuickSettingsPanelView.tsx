import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useQuickSettingsDrag } from '../hooks/useQuickSettingsDrag';
import { useSessionOutlineData } from '../hooks/useSessionOutlineData';
import type {
  PreferenceToggleKey,
  QuickSettingsPanelProps,
  QuickSettingsPreferences,
  QuickSettingsTab,
} from '../types';

import QuickSettingsContent from './QuickSettingsContent';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { preferences, setPreference } = useUiPreferences();
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const [exportExpanded, setExportExpanded] = useState(false);

  const { outlineItems, chatMessages, isLoading } = useSessionOutlineData({
    isOpen,
    selectedSession,
    activeTab,
    exportExpanded,
  });

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

  // Collapse the panel when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (handleRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const tabButtonClass = (tab: QuickSettingsTab) =>
    `flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
      activeTab === tab
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;

  return (
    <>
      <div ref={handleRef} style={{ display: 'contents' }}>
        <QuickSettingsHandle
          isOpen={isOpen}
          isDragging={isDragging}
          style={handleStyle}
          onClick={handleToggleFromHandle}
          onMouseDown={startDrag}
          onTouchStart={startDrag}
        />
      </div>

      <div
        ref={panelRef}
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
            preferences={quickSettingsPreferences}
            onPreferenceChange={handlePreferenceChange}
            messages={chatMessages}
            sessionTitle={selectedSession?.title}
            exportExpanded={exportExpanded}
            onExportToggle={() => setExportExpanded((previous) => !previous)}
            isLoading={isLoading}
          />
        ) : (
          <QuickSettingsOutline
            items={outlineItems}
            isLoading={isLoading}
            onJumpToMessage={onJumpToMessage}
          />
        )}
      </div>
    </>
  );
}
