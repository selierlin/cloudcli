import { useCallback, useEffect, useRef } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import CommandPalette from '../command-palette/CommandPalette';
import { QuickSettingsPanel } from '../quick-settings-panel';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { PaletteOpsProvider, usePaletteOpsRegister } from '../../contexts/PaletteOpsContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useQueuedMessageAutoSend } from '../../hooks/useQueuedMessageAutoSend';
import { api } from '../../utils/api';

type RunningSessionApiItem = {
  sessionId?: unknown;
  startedAt?: unknown;
  statusText?: unknown;
  canInterrupt?: unknown;
};

type RunningSessionsApiPayload = {
  data?: {
    sessions?: RunningSessionApiItem[];
  };
};

const parseStartedAt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export default function AppContent() {
  return (
    <PaletteOpsProvider>
      <AppContentInner />
    </PaletteOpsProvider>
  );
}

function AppContentInner() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();

  const {
    processingSessions,
    markSessionProcessing,
    markSessionIdle,
    syncProcessingSessions,
  } = useSessionProtection();

  const {
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    newSessionTrigger,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    openSettings,
    refreshProjectsSilently,
    registerOptimisticSession,
    sidebarSharedProps,
    handleNewSession,
    handleProjectSelect,
  } = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    activeSessions: processingSessions,
  });

  // Queued messages for sessions that finish while another session (or none)
  // is being viewed are sent from here; the viewed session's composer handles
  // its own queue.
  useQueuedMessageAutoSend({
    processingSessions,
    activeSessionId: selectedSession?.id ?? sessionId ?? null,
    ws,
    sendMessage,
    markSessionProcessing,
  });

  const refreshRunningSessions = useCallback(async () => {
    try {
      const response = await api.runningSessions();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as RunningSessionsApiPayload;
      const sessions = Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];

      syncProcessingSessions(
        sessions
          .map((session) => {
            if (typeof session.sessionId !== 'string' || !session.sessionId) {
              return null;
            }

            return {
              sessionId: session.sessionId,
              startedAt: parseStartedAt(session.startedAt),
              statusText: typeof session.statusText === 'string' ? session.statusText : undefined,
              canInterrupt: typeof session.canInterrupt === 'boolean' ? session.canInterrupt : undefined,
            };
          })
          .filter((session): session is NonNullable<typeof session> => Boolean(session)),
      );
    } catch (error) {
      console.error('[AppContent] Failed to sync running sessions:', error);
    }
  }, [syncProcessingSessions]);

  useEffect(() => {
    void refreshRunningSessions();
  }, [refreshRunningSessions]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRunningSessions();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [refreshRunningSessions]);

  usePaletteOpsRegister({
    openSettings,
    refreshProjects: refreshProjectsSilently,
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  // Pending tool permissions are recovered through the `chat.subscribe` flow:
  // the `chat_subscribed` ack carries them on session open and on reconnect,
  // so no separate permission-recovery message is needed here.

  // Adjust the app container to stay above the virtual keyboard.
  // - In the Capacitor native shell, the @capacitor/keyboard plugin's
  //   keyboardWillShow/Hide events fire synchronously with the keyboard and
  //   carry the exact height, so we drive --keyboard-height from those.
  // - In a plain browser / PWA we use the Visual Viewport API instead.
  const isCapacitorShell = Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
  );

  useEffect(() => {
    if (!isCapacitorShell) {
      return;
    }
    const applyHeight = (px: number) => {
      document.documentElement.style.setProperty('--keyboard-height', `${px}px`);
    };
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    void Keyboard.addListener('keyboardWillShow', (info) => applyHeight(info.keyboardHeight)).then((h) => {
      if (disposed) { void h.remove(); } else { handles.push(h); }
    });
    void Keyboard.addListener('keyboardWillHide', () => applyHeight(0)).then((h) => {
      if (disposed) { void h.remove(); } else { handles.push(h); }
    });
    return () => {
      disposed = true;
      handles.forEach((h) => void h.remove());
      applyHeight(0);
    };
  }, [isCapacitorShell]);

  useEffect(() => {
    if (isCapacitorShell) {
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, [isCapacitorShell]);

  // Edge-swipe to open the mobile sidebar drawer: a touch starting within the
  // left edge and dragging rightward past a threshold opens the menu, mirroring
  // the native drawer gesture. Only active on mobile, and ignored once the
  // drawer is already open (its backdrop handles closing).
  const edgeSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const EDGE_ZONE_PX = 32;
  const OPEN_THRESHOLD_PX = 60;

  const handleEdgeSwipeStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isMobile || sidebarOpen) {
        edgeSwipeStart.current = null;
        return;
      }
      const touch = event.touches[0];
      if (touch && touch.clientX <= EDGE_ZONE_PX) {
        edgeSwipeStart.current = { x: touch.clientX, y: touch.clientY };
      } else {
        edgeSwipeStart.current = null;
      }
    },
    [isMobile, sidebarOpen],
  );

  const handleEdgeSwipeMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isMobile || sidebarOpen || !edgeSwipeStart.current) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const dx = touch.clientX - edgeSwipeStart.current.x;
      const dy = touch.clientY - edgeSwipeStart.current.y;
      // Only a clearly horizontal rightward drag should open the drawer, so
      // vertical scrolling from the edge keeps working normally.
      if (dx > OPEN_THRESHOLD_PX && Math.abs(dy) < Math.abs(dx)) {
        setSidebarOpen(true);
        edgeSwipeStart.current = null;
      }
    },
    [isMobile, sidebarOpen, setSidebarOpen],
  );

  const handleEdgeSwipeEnd = useCallback(() => {
    edgeSwipeStart.current = null;
  }, []);

  return (
    <div
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
      onTouchStart={handleEdgeSwipeStart}
      onTouchMove={handleEdgeSwipeMove}
      onTouchEnd={handleEdgeSwipeEnd}
      onTouchCancel={handleEdgeSwipeEnd}
    >
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar {...sidebarSharedProps} />
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionProcessing={markSessionProcessing}
          onSessionIdle={markSessionIdle}
          processingSessions={processingSessions}
          onNavigateToSession={(targetSessionId: string, options) =>
            navigate(`/session/${targetSessionId}`, { replace: Boolean(options?.replace) })
          }
          onSessionEstablished={(targetSessionId, context) =>
            registerOptimisticSession({ sessionId: targetSessionId, ...context })
          }
          onShowSettings={openSettings}
          externalMessageUpdate={externalMessageUpdate}
          newSessionTrigger={newSessionTrigger}
          onProjectSelect={handleProjectSelect}
          onProjectsRefresh={() => void refreshProjectsSilently()}
        />
      </div>

      <CommandPalette
        selectedProject={selectedProject}
        onStartNewChat={handleNewSession}
        onOpenSettings={() => openSettings()}
        onShowTab={setActiveTab}
      />

      <QuickSettingsPanel />
    </div>
  );
}
