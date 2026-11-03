import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/modules/auth';
import { IS_PLATFORM } from '@/shared/utils';
import { expireAuthSession, isAuthTokenExpired } from '@/shared/authToken';
import type { ServerEvent } from '@/shared/types';


type ServerEventListener = (event: ServerEvent) => void;

/**
 * Where the chat socket stands. `connecting` covers a handshake the provider
 * started on purpose (after sign-in, or with a refreshed token) and the time
 * signed out; `disconnected` a socket that closed on its own (it dropped, or an
 * attempt failed) until a reconnect opens again.
 */
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames cannot be coalesced or
   * dropped. Frames are deliberately not copied into React state; each
   * listener updates only the state owned by the feature that handles it.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  isConnected: boolean;
  /**
   * Lets the UI tell a lost connection (`disconnected`, reconnecting every few
   * seconds) apart from the first handshake (`connecting`), so it can show the
   * former without flashing on every page load. A socket the provider replaces
   * on purpose, such as on a token refresh, reports `connecting` until the new
   * one opens, never `disconnected`.
   */
  connectionStatus: ConnectionStatus;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

/** First wait before retrying a socket that closed on its own; doubles per consecutive failure. */
const RECONNECT_BASE_DELAY_MS = 3000;
/** Ceiling for that doubling, so a client that is offline still retries twice a minute. */
const RECONNECT_MAX_DELAY_MS = 30_000;
/**
 * A close delivered this soon after the page became visible was queued while the
 * page was suspended (iOS freezes the JS and hands over the socket's close only
 * on resume), so the connection was already lost - retrying instantly is free.
 */
const RESUME_CLOSE_WINDOW_MS = 2000;
/**
 * The server pings every 30s and terminates a socket that misses two pings, so a
 * page hidden longer than this returns to a socket the server has already killed,
 * even when the WebView still reports it as `OPEN`.
 */
const STALE_HIDDEN_MS = 60_000;

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (IS_PLATFORM) return `${protocol}//${window.location.host}/ws`; // Platform mode: Use same domain as the page (goes through proxy)
  if (!token) return null;
  if (isAuthTokenExpired(token)) {
    expireAuthSession();
    return null;
  }
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`; // OSS mode: Use same host:port that served the page
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false); // Track if component is unmounted
  const hasConnectedRef = useRef(false); // Track if we've ever connected (to detect reconnects)
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside `onmessage` and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  // Drives `isConnected` and the workspace header's "Reconnecting" indicator.
  // Three values rather than a boolean: a first handshake still in flight must
  // not read as a lost connection, or every page load would flash the indicator.
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  /** Consecutive failed attempts, used only to grow the retry delay; a successful handshake resets it. */
  const failedAttemptsRef = useRef(0);
  /** When the page was last hidden, so resume can tell a tab switch from a suspended app. */
  const hiddenAtRef = useRef<number | null>(null);
  /** When the page last became visible, so a close delivered on resume retries without the delay. */
  const resumedAtRef = useRef(0);
  const { isLoading: isAuthLoading, token, user } = useAuth();

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
  }, []);

  /** Drops a pending retry so a resume or a recovered network can connect now instead of later. */
  const cancelPendingReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  /**
   * Closes a socket the provider replaces on purpose. The handlers are detached
   * first: the close they would report is not a lost connection, and letting
   * `onclose` run would schedule a second reconnect alongside the new one.
   */
  const discardSocket = useCallback((socket: WebSocket) => {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
    if (wsRef.current === socket) {
      wsRef.current = null;
    }
  }, []);

  // Named function expression so the reconnect timer below can call itself
  // without reading the `connect` binding while it is still initializing.
  const connect = useCallback(function connect() {
    if (unmountedRef.current) return; // Prevent connection if unmounted
    if (!IS_PLATFORM && (isAuthLoading || !user)) return;

    /** Schedules the next attempt, backing off while the failures keep coming. */
    function scheduleRetry(immediately: boolean) {
      cancelPendingReconnect();
      const delay = immediately
        ? 0
        : Math.min(RECONNECT_BASE_DELAY_MS * 2 ** failedAttemptsRef.current, RECONNECT_MAX_DELAY_MS);
      failedAttemptsRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (unmountedRef.current) return; // Prevent reconnection if unmounted
        connect();
      }, delay);
    }

    try {
      // Construct WebSocket URL
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');

      const websocket = new WebSocket(wsUrl);
      // Store connecting sockets too, so a token refresh can close them before
      // their handshake completes with stale credentials.
      wsRef.current = websocket;

      websocket.onopen = () => {
        failedAttemptsRef.current = 0;
        setConnectionStatus('connected');
        if (hasConnectedRef.current) {
          // This is a reconnect — signal so components can catch up on missed messages
          dispatch({ kind: 'websocket_reconnected', timestamp: Date.now() });
        }
        hasConnectedRef.current = true;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          dispatch(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        if (wsRef.current !== websocket) {
          return;
        }
        // Also reached when the very first attempt fails, which is a lost
        // connection too. The effect cleanup detaches this handler before
        // closing a socket on purpose, so a token refresh never gets here.
        setConnectionStatus('disconnected');
        wsRef.current = null;

        // A close queued while the page was suspended arrives right after the
        // resume handler, which has already reconnected; retrying at once either
        // matches that intent or replaces the attempt it just started.
        scheduleRetry(Date.now() - resumedAtRef.current < RESUME_CLOSE_WINDOW_MS);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      // The constructor throws on a URL it cannot use, which can outlast a
      // transient cause; freezing the status here would leave the UI stuck on
      // "disconnected" with no attempt ever scheduled again.
      wsRef.current = null;
      scheduleRetry(false);
    }
  }, [cancelPendingReconnect, dispatch, isAuthLoading, token, user]); // reconnect with current authentication state

  // Declared after `connect` so the effect body does not reference it before
  // initialization. `connect` is memoized on [dispatch, isAuthLoading, token,
  // user] and `dispatch` is stable, so depending on it reconnects on exactly
  // the same transitions as the previous [isAuthLoading, token, user] list.
  useEffect(() => {
    // The cleanup below sets unmountedRef = true. Without this reset, every
    // re-run of the effect (e.g. on token refresh) would short-circuit connect()
    // at its unmounted guard and leave the socket permanently disconnected.
    unmountedRef.current = false;
    if (!IS_PLATFORM && (isAuthLoading || !user)) {
      return undefined;
    }
    connect();

    return () => {
      unmountedRef.current = true;
      cancelPendingReconnect();
      const activeSocket = wsRef.current;
      if (activeSocket) {
        // Prevent the intentionally closed, old-token socket from scheduling
        // a reconnect after the refreshed-token effect has already started.
        discardSocket(activeSocket);
      }
      failedAttemptsRef.current = 0;
      // What comes next is a socket with a refreshed token, or none after a
      // sign-out or session expiry. Either way it starts from a fresh
      // handshake: the socket closed here is no longer live, and a drop seen
      // before must not show as "Reconnecting" after the next sign-in.
      setConnectionStatus('connecting');
    };
  }, [cancelPendingReconnect, connect, discardSocket, isAuthLoading, user]); // reconnect after authentication or token refresh

  // iOS suspends the page and its socket when the app goes to the background,
  // and desktop browsers freeze background tabs the same way. On return the
  // socket is usually dead already, and its close only becomes observable now,
  // so reconnecting here - rather than waiting for the retry timer or for a
  // close that may arrive late - is what keeps "Reconnecting" from showing.
  useEffect(() => {
    const handleResume = () => {
      if (unmountedRef.current) return;
      const hiddenFor = hiddenAtRef.current === null ? 0 : Date.now() - hiddenAtRef.current;
      hiddenAtRef.current = null;
      resumedAtRef.current = Date.now();

      const socket = wsRef.current;
      const isOpen = socket !== null && socket.readyState === WebSocket.OPEN;
      // A short switch leaves the socket healthy; replacing it would force a
      // resubscribe and a history tail sync for nothing.
      if (isOpen && hiddenFor < STALE_HIDDEN_MS) {
        return;
      }

      if (socket) {
        discardSocket(socket);
      }
      cancelPendingReconnect();
      // The provider starts this handshake on purpose, which is what
      // `connecting` means: the drop is being handled, not left unattended.
      setConnectionStatus('connecting');
      connect();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        handleResume();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Connectivity can return while the page stays in the foreground (Wi-Fi
    // rejoin, airplane mode off); waiting for the next retry timer would waste
    // up to RECONNECT_MAX_DELAY_MS of an otherwise healthy connection.
    window.addEventListener('online', handleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleResume);
    };
  }, [cancelPendingReconnect, connect, discardSocket]);

  const sendMessage = useCallback((message: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    subscribe,
    isConnected: connectionStatus === 'connected',
    connectionStatus,
  }), [sendMessage, subscribe, connectionStatus]);

  return value;
};

/** Mounted once by App; owns the single chat websocket that the chat, project-workspace and task-master modules subscribe to. */
export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
