import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useProjectSlashCommands } from '@/shared/hooks/useProjectSlashCommands';
import { useSelectedProvider } from '@/shared/hooks/useSelectedProvider';
import { useQuickSettingsDrag } from '@/modules/quick-settings-panel/hooks/useQuickSettingsDrag';
import { useQuickSettingsPanelState } from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState';
import { useQuickSettingsPanelWidth } from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelWidth';
import { useSessionOutlineData } from '@/modules/quick-settings-panel/hooks/useSessionOutlineData';
import { useProjectMainState } from '@/modules/project-workspace';
import type { Project, SlashCommand } from '@/shared/types';
import { getQuickSettingsTabId, getQuickSettingsTabPanelId, isImeKeyEvent } from '@/shared/utils';
import QuickSettingsCommandsTab from '@/modules/quick-settings-panel/QuickSettingsCommandsTab';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import QuickSettingsHandle from '@/modules/quick-settings-panel/QuickSettingsHandle';
import QuickSettingsOutline from '@/modules/quick-settings-panel/QuickSettingsOutline';
import QuickSettingsPanelHeader from '@/modules/quick-settings-panel/QuickSettingsPanelHeader';
import QuickSettingsTabs from '@/modules/quick-settings-panel/QuickSettingsTabs';

type QuickSettingsPanelViewProps = {
  selectedProject: Project | null;
  // Receives a command picked on the Commands tab; the caller decides where
  // it goes (the project workspace hands it to the chat composer).
  onInsertCommand?: (command: SlashCommand) => void;
};

/** Matches the `w-80` class on the mobile overlay, whose width never reads the stored desktop width. */
const MOBILE_PANEL_WIDTH = 320;

/**
 * Whether a click landed in a modal dialog rendered above the panel.
 *
 * Dialogs portal to `document.body` (`DialogContent`), so nothing inside one is
 * a descendant of `panelRef`; without this the panel treats every click in its
 * own share dialog as an outside click. The hook sits on the portal root rather
 * than on `[role="dialog"]` because the overlay is a sibling of the card.
 */
const isInDialogLayer = (target: EventTarget | null): boolean => (
  target instanceof Element && target.closest('[data-dialog-layer]') !== null
);

/** Exported as QuickSettingsPanel and rendered by the project-workspace module as its quick settings drawer — an overlay by default, docked into the workspace row when pinned. */
function QuickSettingsPanelView({ selectedProject, onInsertCommand }: QuickSettingsPanelViewProps) {
  const { t } = useTranslation('settings');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const canPin = !isMobile;
  const {
    isOpen,
    isPinned,
    activeTab,
    close,
    toggle,
    selectTab,
    togglePin,
  } = useQuickSettingsPanelState({ canPin });
  // One width for both states: the panel keeps its footprint when it is pinned,
  // and only the drag handle on the docked column's edge changes it.
  const { width: panelWidth, minWidth, maxWidth, separatorProps } = useQuickSettingsPanelWidth({
    resizable: canPin,
  });
  const provider = useSelectedProvider();
  const {
    commands,
    isLoading: isLoadingCommands,
    error: commandsError,
  } = useProjectSlashCommands(selectedProject, provider, {
    // The composer already loads this list on every project switch; only pay
    // for a second request while the Commands tab is actually showing.
    enabled: isOpen && activeTab === 'commands',
  });
  const { selectedSession, handleSessionSelect } = useProjectMainState();
  const [exportExpanded, setExportExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const {
    isDragging,
    handleStyle,
    startDrag,
    handlePointerMove,
    endDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      toggle();
    },
    [consumeSuppressedClick, toggle],
  );

  const handleInsertCommand = useCallback(
    (command: SlashCommand) => {
      onInsertCommand?.(command);
      // An overlay is in the way of the composer it just filled; a docked panel
      // is part of the layout and stays.
      if (!isPinned) {
        close();
      }
    },
    [close, isPinned, onInsertCommand],
  );

  // Escape dismisses an open overlay. The overlay is the topmost layer, so it
  // must see the key before the handlers underneath it — the chat's
  // capture-phase abort-on-Escape and the editor's close-on-Escape — and
  // consume it; window capture runs ahead of both. Keys another layer already
  // consumed (e.g. the composer's own `/` menu closing) are left alone.
  useEffect(() => {
    if (!isOpen || isPinned) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape also cancels an IME candidate; closing the panel on that press
      // would drop the user out of what they were typing.
      if (event.key !== 'Escape' || event.defaultPrevented || isImeKeyEvent(event)) {
        return;
      }
      // A dialog opened from the panel is the topmost layer and owns Escape.
      // Asking the document (not the event target) matters: the portal focuses
      // its first field on the next frame, so for that frame focus is still on
      // the panel while the dialog is already on screen.
      if (document.querySelector('[data-dialog-layer]')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [close, isOpen, isPinned]);

  // The panel intentionally has no full-screen overlay masking the chat (the
  // feature branch dropped it so the conversation stays visible and usable
  // while the drawer is open). Close on an outside click instead; Escape is
  // handled above, ahead of the layers underneath.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (handleRef.current?.contains(target)) return;
      // A dialog opened from the panel is above it, not away from it. Treating
      // its clicks as outside ones closes the panel underneath — in docked mode
      // that unmounts the dialog mid-gesture, so the button the user pressed
      // never runs its handler.
      if (isInDialogLayer(target)) return;
      close();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [close, isOpen]);

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

  const panelBody = (
    <div className="flex h-full flex-col">
      <QuickSettingsPanelHeader
        isPinned={isPinned}
        canPin={canPin}
        onTogglePin={togglePin}
        onClose={close}
      />
      <QuickSettingsTabs activeTab={activeTab} onSelectTab={selectTab} />
      <div
        role="tabpanel"
        id={getQuickSettingsTabPanelId(activeTab)}
        aria-labelledby={getQuickSettingsTabId(activeTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === 'settings' ? (
          <QuickSettingsContent
            messages={chatMessages}
            sessionTitle={selectedSession?.title}
            sessionId={selectedSession?.id ?? null}
            provider={selectedSession?.__provider ?? selectedSession?.provider ?? 'claude'}
            selectedProject={selectedProject}
            exportExpanded={exportExpanded}
            onExportToggle={() => setExportExpanded((previous) => !previous)}
            isLoading={isLoading}
          />
        ) : activeTab === 'outline' ? (
          <QuickSettingsOutline items={outlineItems} isLoading={isLoading} onJumpToMessage={handleJumpToMessage} />
        ) : (
          <QuickSettingsCommandsTab
            hasProject={selectedProject !== null}
            commands={commands}
            isLoading={isLoadingCommands}
            hasError={commandsError}
            onInsertCommand={handleInsertCommand}
          />
        )}
      </div>
    </div>
  );

  return (
    <>
      <div ref={handleRef} style={{ display: 'contents' }}>
        <QuickSettingsHandle
          isOpen={isOpen}
          isDragging={isDragging}
          openOffset={isMobile ? MOBILE_PANEL_WIDTH : panelWidth}
          style={handleStyle}
          onClick={handleToggleFromHandle}
          onPointerDown={startDrag}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        />
      </div>

      {/* Docked: a layout column while open, gone while collapsed via the handle (the pin is kept). */}
      {isPinned ? (
        isOpen && (
          <div
            className="relative h-full flex-shrink-0 border-l border-border bg-background"
            style={{ width: panelWidth }}
          >
            {panelBody}
            {/* Desktop only, mirrored from the sidebar: 4px of grab area on the column's outer edge. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('quickSettings.resizePanel')}
              aria-valuenow={panelWidth}
              aria-valuemin={minWidth}
              aria-valuemax={maxWidth}
              tabIndex={0}
              className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
              {...separatorProps}
            />
          </div>
        )
      ) : (
        // Overlay: the same width as the docked column and without a backdrop,
        // so pinning does not change the panel's footprint and the conversation
        // stays visible and usable while the drawer is open. Mobile keeps its
        // fixed width: the stored desktop width would not fit a phone.
        <div
          ref={panelRef}
          className={`fixed right-0 top-0 z-[9999] h-full transform border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} ${isMobile ? 'h-screen w-80' : ''}`}
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            ...(isMobile ? undefined : { width: panelWidth }),
          }}
        >
          {panelBody}
        </div>
      )}
    </>
  );
}

export default memo(QuickSettingsPanelView);
