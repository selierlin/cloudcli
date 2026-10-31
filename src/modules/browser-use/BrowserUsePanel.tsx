import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Clock3,
  Download,
  Expand,
  ExternalLink,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { TFunction } from 'i18next';

import { cn } from '@/shared/utils';
import { Badge, Button, Input } from '@/shared/ui';
import { api, readApiJson, ApiRequestError } from '@/shared/api';
import type { SettingsMainTab } from '@/shared/types';

type BrowserUseStatus = {
  available: boolean;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  installInProgress: boolean;
  sessionCount: number;
  message: string;
};

type BrowserUseSession = {
  id: string;
  status: 'ready' | 'stopped' | 'unavailable';
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  createdBy: 'agent';
  profileName: string | null;
  viewport: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent';
  } | null;
};

type BrowserUsePanelProps = {
  isVisible: boolean;
  onShowSettings?: (tab?: SettingsMainTab) => void;
};

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const BROWSER_USE_PANEL_ERROR_KEYS: Record<string, string> = {
  BROWSER_USE_STATUS_LOAD_FAILED: 'error.load',
  BROWSER_USE_SESSIONS_LOAD_FAILED: 'error.load',
  BROWSER_USE_SESSION_STOP_FAILED: 'error.action',
  BROWSER_USE_SESSION_DELETE_FAILED: 'error.action',
  BROWSER_USE_SESSION_INPUT_FAILED: 'error.action',
  BROWSER_USE_RUNTIME_INSTALL_FAILED: 'error.installFailed',
};

function localizeApiError(err: unknown, fallbackKey: string, t: TranslateFn): string {
  if (err instanceof ApiRequestError && err.code && BROWSER_USE_PANEL_ERROR_KEYS[err.code]) {
    return t(BROWSER_USE_PANEL_ERROR_KEYS[err.code]);
  }
  return t(fallbackKey);
}

function formatRelativeTime(t: TFunction, value: string | null): string {
  if (!value) return t('time.never');

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return t('time.unknown');

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 10) return t('time.justNow');
  if (elapsedSeconds < 60) return t('time.secondsAgo', { count: elapsedSeconds });
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return t('time.minutesAgo', { count: elapsedMinutes });
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return t('time.hoursAgo', { count: elapsedHours });
  return t('time.daysAgo', { count: Math.round(elapsedHours / 24) });
}

function getDomain(t: TFunction, url: string | null): string {
  if (!url) return t('sessions.noPageLoaded');

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatAction(t: TFunction, action: string | null): string {
  if (!action) return t('sessions.waiting');
  return action.replace(/_/g, ' ').replace(/:/g, ': ');
}

function getStatusTone(status: BrowserUseSession['status']): string {
  if (status === 'ready') {
    return 'border-primary/30 bg-primary/5 text-foreground';
  }
  if (status === 'stopped') {
    return 'border-border bg-muted text-muted-foreground';
  }
  return 'border-border bg-background text-muted-foreground';
}

function getRuntimeTone(status: BrowserUseStatus | null, installing: boolean): string {
  if (status?.available || status?.installInProgress || installing) {
    return 'border-primary/30 bg-primary/5 text-foreground';
  }
  return 'border-border bg-background text-muted-foreground';
}

function getStatusLabel(status: BrowserUseSession['status'] | undefined, t: TFunction): string {
  if (!status) return t('sessions.noneStatus');
  if (status === 'ready') return t('sessions.statusReady');
  if (status === 'stopped') return t('sessions.statusStopped');
  if (status === 'unavailable') return t('sessions.statusUnavailable');
  return status;
}

function getStatusDot(status: BrowserUseSession['status']): string {
  if (status === 'ready') return 'bg-primary';
  if (status === 'stopped') return 'bg-muted-foreground/50';
  return 'bg-border';
}

/** Minimum interval between automatic session refreshes when the panel becomes visible again. */
const REFRESH_THROTTLE_MS = 3000;

/** Used by the project-workspace module to render the Browser tab's session list and live preview. */
export default function BrowserUsePanel({ isVisible, onShowSettings }: BrowserUsePanelProps) {
  const { t } = useTranslation('browser');
  const lastRefreshAtRef = useRef(0);

  const [status, setStatus] = useState<BrowserUseStatus | null>(null);
  const [sessions, setSessions] = useState<BrowserUseSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  // Shared by refresh and browser input so a refresh cannot overwrite a newer input result (or the reverse).
  const sessionOperationLockRef = useRef(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || sessions[0] || null,
    [selectedSessionId, sessions],
  );

  const activeSessions = sessions.filter((session) => session.status === 'ready');
  const needsBrowserBinaries = Boolean(status && (!status.playwrightInstalled || !status.chromiumInstalled));
  const runtimeLabel = status?.available
    ? t('runtime.ready')
    : status?.installInProgress || isInstalling
      ? t('runtime.installing')
      : t('runtime.setupRequired');

  const cursorStyle = selectedSession?.cursor && selectedSession.viewport
    ? {
      left: `${(selectedSession.cursor.x / selectedSession.viewport.width) * 100}%`,
      top: `${(selectedSession.cursor.y / selectedSession.viewport.height) * 100}%`,
    }
    : null;

  const refresh = useCallback(async () => {
    if (sessionOperationLockRef.current) return;
    sessionOperationLockRef.current = true;
    setIsRefreshing(true);
    try {
      const [statusResponse, sessionsResponse] = await Promise.all([
        api.browserUse.status(),
        api.browserUse.sessions(),
      ]);
      const statusData = await readApiJson<{ data: BrowserUseStatus }>(statusResponse);
      const sessionsData = await readApiJson<{ data: { sessions: BrowserUseSession[] } }>(sessionsResponse);
      const nextSessions = sessionsData.data.sessions;
      setStatus(statusData.data);
      setSessions(nextSessions);
      setSelectedSessionId((current) => (
        current && nextSessions.some((session) => session.id === current)
          ? current
          : nextSessions[0]?.id || null
      ));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.load'));
    } finally {
      sessionOperationLockRef.current = false;
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isVisible) return;
    if (Date.now() - lastRefreshAtRef.current < REFRESH_THROTTLE_MS) return;
    lastRefreshAtRef.current = Date.now();
    void refresh();
  }, [isVisible, refresh]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.action'));
    } finally {
      setIsBusy(false);
    }
  }, [refresh, t]);

  const stopSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await api.browserUse.stopSession(selectedSession.id);
    await readApiJson(response);
  });

  const deleteSession = () => runAction(async () => {
    if (!selectedSession) return;
    const response = await api.browserUse.deleteSession(selectedSession.id);
    await readApiJson(response);
    setIsFullscreen(false);
  });

  const [inputText, setInputText] = useState('');
  const [isInputPending, setIsInputPending] = useState(false);
  const [keyboardPoint, setKeyboardPoint] = useState<{ x: number; y: number } | null>(null);

  type BrowserInput = { type: 'click'; x: number; y: number } | { type: 'text'; text: string } | { type: 'key'; key: string };

  // Runs the inputs one after the other under a single lock so that overlapping
  // requests cannot act on a different focus state or apply screenshots out of order.
  // Resolves to true only when every input succeeded.
  const sendInputs = useCallback(async (inputs: BrowserInput[]) => {
    if (!selectedSession || selectedSession.status !== 'ready' || sessionOperationLockRef.current) return false;
    sessionOperationLockRef.current = true;
    setIsInputPending(true);
    setError(null);
    try {
      for (const input of inputs) {
        const response = await api.browserUse.sendInput(selectedSession.id, input);
        const data = await readApiJson<{ data: { session: BrowserUseSession } }>(response);
        setSessions((current) => current.map((session) => (session.id === data.data.session.id ? data.data.session : session)));
      }
      return true;
    } catch (err) {
      setError(localizeApiError(err, 'error.action', t));
      return false;
    } finally {
      sessionOperationLockRef.current = false;
      setIsInputPending(false);
    }
  }, [selectedSession, t]);

  const sendInput = useCallback((input: BrowserInput) => sendInputs([input]), [sendInputs]);

  const clickAtFraction = (fractionX: number, fractionY: number) => {
    const viewport = selectedSession?.viewport;
    if (!viewport) return;
    void sendInput({ type: 'click', x: fractionX * viewport.width, y: fractionY * viewport.height });
  };

  const handleSurfaceClick = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    clickAtFraction((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  };

  // Keyboard path to the same click action: arrows move a marker, Enter/Space clicks it.
  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[event.key];
    if (move) {
      event.preventDefault();
      setKeyboardPoint((point) => {
        const current = point ?? { x: 0.5, y: 0.5 };
        return {
          x: Math.min(1, Math.max(0, current.x + move[0])),
          y: Math.min(1, Math.max(0, current.y + move[1])),
        };
      });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const point = keyboardPoint ?? { x: 0.5, y: 0.5 };
      setKeyboardPoint(point);
      clickAtFraction(point.x, point.y);
    }
  };

  const submitInputText = async () => {
    if (!inputText || isInputPending || isRefreshing) return;
    const text = inputText;
    // Enter is only sent once the text went through; on failure the draft stays for a retry.
    const sent = await sendInputs([{ type: 'text', text }, { type: 'key', key: 'Enter' }]);
    if (sent) setInputText('');
  };

  const installBrowserBinaries = () => runAction(async () => {
    setIsInstalling(true);
    try {
      const response = await api.browserUse.installRuntime();
      await readApiJson(response);
      window.dispatchEvent(new Event('browserRuntimeChanged'));
    } finally {
      setIsInstalling(false);
    }
  });

  const renderSessionItem = (session: BrowserUseSession) => {
    const isSelected = selectedSession?.id === session.id;
    return (
      <button
        key={session.id}
        type="button"
        onClick={() => setSelectedSessionId(session.id)}
        className={cn(
          'group w-full rounded-md border px-3 py-2.5 text-left transition-colors',
          isSelected
            ? 'border-primary/50 bg-primary/10 text-foreground'
            : 'border-border/60 bg-card/30 text-muted-foreground hover:bg-muted/50',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', getStatusDot(session.status))} />
              <div className="truncate text-sm font-medium">{session.title || getDomain(t, session.url)}</div>
            </div>
            <div className="mt-1 truncate pl-3.5 text-xs text-muted-foreground">{getDomain(t, session.url)}</div>
          </div>
          <Badge variant="outline" className="shrink-0 border-border bg-background text-[10px] text-muted-foreground">
            {getStatusLabel(session.status, t)}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          <span>{formatRelativeTime(t, session.updatedAt)}</span>
          <span className="truncate">- {formatAction(t, session.lastAction)}</span>
        </div>
      </button>
    );
  };

  const renderEmptyState = () => (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-md border border-border bg-card/40 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <MonitorPlay className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">
              {status?.available ? t('empty.title') : t('empty.disabledTitle')}
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {status?.available
                ? t('empty.agentDescription')
                : t('empty.disabledDescription')}
            </p>
          </div>
        </div>

        {needsBrowserBinaries && (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="text-sm font-medium text-foreground">{t('install.required')}</div>
            <p className="mt-1 text-sm text-muted-foreground">{status?.message}</p>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              onClick={installBrowserBinaries}
              disabled={isBusy || isInstalling || status?.installInProgress}
            >
              {isInstalling || status?.installInProgress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isInstalling || status?.installInProgress ? t('install.installing') : t('install.button')}
            </Button>
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {[t('prompts.inspect'), t('prompts.openInteract')].map((prompt) => (
            <div key={prompt} className="rounded-md border border-border/70 bg-background/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                {t('prompts.heading')}
              </div>
              <p className="text-sm leading-6 text-foreground">{prompt}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderBrowserScreen = (fullscreen = false) => (
    <div className={cn('flex flex-1 items-center justify-center bg-n-neutral-950', fullscreen ? 'min-h-[80vh]' : 'min-h-[420px]')}>
      {selectedSession?.screenshotDataUrl ? (
        <div
          className={cn(
            'relative inline-block max-h-full',
            selectedSession.status === 'ready' && 'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary',
          )}
          {...(selectedSession.status === 'ready' && {
            tabIndex: 0,
            role: 'button',
            'aria-label': t('surface.ariaLabel'),
            onKeyDown: handleSurfaceKeyDown,
            onBlur: () => setKeyboardPoint(null),
          })}
        >
          <img
            src={selectedSession.screenshotDataUrl}
            alt={t('sessions.screenshotAlt')}
            onClick={handleSurfaceClick}
            className={cn(
              fullscreen ? 'block max-h-[80vh] w-auto max-w-full object-contain' : 'block max-h-[72vh] w-auto max-w-full object-contain',
              selectedSession.status === 'ready' && !isInputPending && 'cursor-pointer',
            )}
          />
          {keyboardPoint && (
            <div
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-n-white bg-primary/70"
              style={{ left: `${keyboardPoint.x * 100}%`, top: `${keyboardPoint.y * 100}%` }}
            />
          )}
          {cursorStyle && (
            <div
              className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-n-white/90 bg-primary/80 shadow-[0_0_0_6px_hsl(var(--primary)/0.18)]"
              style={cursorStyle}
            >
              <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-n-white" />
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 text-center">
          <MonitorPlay className="mx-auto h-9 w-9 text-n-neutral-500" />
          <div className="mt-3 text-sm font-medium text-n-neutral-100">{selectedSession?.message || t('screenshot.waiting')}</div>
          <p className="mt-1 text-xs text-n-neutral-400">{t('screenshot.nextSnapshot')}</p>
        </div>
      )}
    </div>
  );

  const renderBrowserSurface = (fullscreen = false) => (
    <div className="flex flex-1 flex-col">
      {renderBrowserScreen(fullscreen)}
      {selectedSession?.status === 'ready' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 bg-background px-3 py-2">
          <Input
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitInputText();
              }
            }}
            disabled={isInputPending || isRefreshing}
            placeholder={t('input.placeholder')}
            aria-label={t('input.placeholder')}
            className="min-w-[200px] flex-1"
          />
          <Button variant="outline" size="sm" onClick={() => void submitInputText()} disabled={!inputText || isInputPending || isRefreshing}>{t('input.send')}</Button>
          <Button variant="outline" size="sm" onClick={() => void sendInput({ type: 'key', key: 'Backspace' })} disabled={isInputPending || isRefreshing}>{t('input.backspace')}</Button>
          <Button variant="outline" size="sm" onClick={() => void sendInput({ type: 'key', key: 'Tab' })} disabled={isInputPending || isRefreshing}>{t('input.tab')}</Button>
          <Button variant="outline" size="sm" onClick={() => void sendInput({ type: 'key', key: 'Enter' })} disabled={isInputPending || isRefreshing}>{t('input.enter')}</Button>
          <span className="w-full text-xs text-muted-foreground">{t('input.hint')}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
            <Badge variant="outline" className={cn('text-[10px]', getRuntimeTone(status, isInstalling))}>
              {runtimeLabel}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {onShowSettings && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onShowSettings('browser')}
              title={t('openSettings')}
              aria-label={t('openSettings')}
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => void refresh()}
            disabled={isRefreshing || isBusy || isInputPending}
            title={t('refresh')}
            aria-label={t('refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="border-b border-border/60 bg-muted/20 px-3 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedSessionId(session.id)}
                className={cn(
                  'flex min-w-[180px] items-center gap-2 rounded-md border px-2.5 py-2 text-left',
                  selectedSession?.id === session.id
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-background',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', getStatusDot(session.status))} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {session.title || getDomain(t, session.url)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
            <div className="min-w-0 truncate">
              {t('sessions.active', { count: activeSessions.length })}
              <span className="px-1.5">/</span>
              {t('sessions.total', { count: sessions.length })}
            </div>
            <div className="min-w-0 truncate">
              {t('sessions.updated', { time: formatRelativeTime(t, selectedSession?.updatedAt || null) })}
            </div>
          </div>

          {sessions.length === 0 ? (
            renderEmptyState()
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
              <div className="mx-auto flex min-h-[500px] max-w-7xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Badge variant="outline" className={selectedSession ? cn('text-[10px]', getStatusTone(selectedSession.status)) : 'text-[10px]'}>
                    {selectedSession ? getStatusLabel(selectedSession.status, t) : t('sessions.emptyBadge')}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {selectedSession?.title || getDomain(t, selectedSession?.url || null)}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{selectedSession?.url || t('sessions.noPageLoaded')}</span>
                    </div>
                  </div>
                  <div className="hidden text-xs text-muted-foreground md:block">
                    {formatAction(t, selectedSession?.lastAction || null)}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setIsFullscreen(true)} disabled={!selectedSession?.screenshotDataUrl} title={t('sessions.fullscreen')} aria-label={t('sessions.fullscreen')}>
                    <Expand className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'} title={t('sessions.stopSession')} aria-label={t('sessions.stopSession')}>
                    <Square className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={deleteSession} disabled={isBusy || !selectedSession} title={t('sessions.deleteSession')} aria-label={t('sessions.deleteSession')}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {renderBrowserSurface()}
              </div>
            </div>
          )}
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-border/60 bg-background lg:flex">
          <div className="border-b border-border/60 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-foreground">{t('sessions.title')}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t('sessions.total', { count: sessions.length })}</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{t('sessions.active', { count: activeSessions.length })}</Badge>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {sessions.length > 0 ? (
              <div className="space-y-2">{sessions.map(renderSessionItem)}</div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-xs text-muted-foreground">
                {t('sessions.none')}
              </div>
            )}
          </div>

          <div className="border-t border-border/60 p-3">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                {t('sessions.selected')}
              </div>
              <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center justify-between gap-3">
                  <span>{t('sessions.status')}</span>
                  <span className="font-medium text-foreground">{getStatusLabel(selectedSession?.status, t)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>{t('sessions.lastAction')}</span>
                  <span className="truncate font-medium text-foreground">{formatAction(t, selectedSession?.lastAction || null)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>{t('sessions.profile')}</span>
                  <span className="truncate font-medium text-foreground">{selectedSession?.profileName || t('sessions.temporary')}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={stopSession} disabled={isBusy || !selectedSession || selectedSession.status !== 'ready'}>
                  <Square className="h-4 w-4" />
                  {t('sessions.stop')}
                </Button>
                <Button variant="outline" size="sm" onClick={deleteSession} disabled={isBusy || !selectedSession}>
                  <Trash2 className="h-4 w-4" />
                  {t('sessions.delete')}
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {isFullscreen && selectedSession && (
        <div className="fixed inset-0 z-50 bg-overlay/90 p-6">
          <div className="flex h-full flex-col rounded-md border border-n-white/10 bg-n-black">
            <div className="flex items-center justify-between border-b border-n-white/10 px-4 py-3 text-sm text-n-white/80">
              <div className="min-w-0 truncate">{selectedSession.title || selectedSession.url || t('sessions.fullscreenTitle')}</div>
              <Button variant="outline" size="sm" onClick={() => setIsFullscreen(false)}>
                <X className="h-4 w-4" />
                {t('sessions.close')}
              </Button>
            </div>
            {renderBrowserSurface(true)}
          </div>
        </div>
      )}
    </div>
  );
}
