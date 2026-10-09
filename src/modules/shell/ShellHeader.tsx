import { RotateCcw, Shield, ShieldOff, SquareTerminal, X } from 'lucide-react';

type ShellHeaderProps = {
  isConnected: boolean;
  isInitialized: boolean;
  isRestarting: boolean;
  hasSession: boolean;
  sessionDisplayNameShort: string | null;
  onDisconnect: () => void;
  onRestart: () => void;
  statusNewSessionText: string;
  statusInitializingText: string;
  statusRestartingText: string;
  disconnectLabel: string;
  disconnectTitle: string;
  restartLabel: string;
  restartTitle: string;
  disableRestart: boolean;
  showBypassToggle: boolean;
  bypassEnabled: boolean;
  onToggleBypass: () => void;
  bypassLabel: string;
  bypassTitle: string;
  showBashToggle: boolean;
  bashModeEnabled: boolean;
  onToggleBashMode: () => void;
  bashModeLabel: string;
  bashModeTitle: string;
};

/** Rendered by Shell above the terminal to show connection status and the restart/disconnect actions. */
export default function ShellHeader({
  isConnected,
  isInitialized,
  isRestarting,
  hasSession,
  sessionDisplayNameShort,
  onDisconnect,
  onRestart,
  statusNewSessionText,
  statusInitializingText,
  statusRestartingText,
  disconnectLabel,
  disconnectTitle,
  restartLabel,
  restartTitle,
  disableRestart,
  showBypassToggle,
  bypassEnabled,
  onToggleBypass,
  bypassLabel,
  bypassTitle,
  showBashToggle,
  bashModeEnabled,
  onToggleBashMode,
  bashModeLabel,
  bashModeTitle,
}: ShellHeaderProps) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-muted px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />

          {hasSession && sessionDisplayNameShort && (
            <span className="text-xs text-blue-600 dark:text-blue-300">({sessionDisplayNameShort}...)</span>
          )}

          {!hasSession && <span className="text-xs text-muted-foreground">{statusNewSessionText}</span>}

          {!isInitialized && <span className="text-xs text-yellow-600 dark:text-yellow-400">{statusInitializingText}</span>}

          {isRestarting && <span className="text-xs text-blue-600 dark:text-blue-400">{statusRestartingText}</span>}
        </div>

        <div className="flex items-center gap-2">
          {showBypassToggle && (
            <button
              type="button"
              onClick={onToggleBypass}
              aria-pressed={bypassEnabled}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-muted ${
                bypassEnabled
                  ? 'border-orange-500/70 bg-orange-600/80 text-n-white hover:bg-orange-700 focus:ring-orange-400/70'
                  : 'border-input/80 bg-sunken/70 text-n-gray-700 hover:border-orange-400/70 hover:bg-orange-600/60 hover:text-n-white focus:ring-orange-400/70 dark:text-n-gray-100'
              }`}
              title={bypassTitle}
            >
              {bypassEnabled ? (
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{bypassLabel}</span>
            </button>
          )}

          {showBashToggle && (
            <button
              type="button"
              onClick={onToggleBashMode}
              aria-pressed={bashModeEnabled}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-muted max-md:px-2 ${
                bashModeEnabled
                  ? 'border-blue-500/70 bg-blue-600/80 text-n-white hover:bg-blue-700 focus:ring-blue-400/70'
                  : 'border-input/80 bg-sunken/70 text-n-gray-700 hover:border-blue-400/70 hover:bg-blue-600/60 hover:text-n-white focus:ring-blue-400/70 dark:text-n-gray-100'
              }`}
              title={bashModeTitle}
            >
              <SquareTerminal className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="max-md:hidden">{bashModeLabel}</span>
            </button>
          )}

          {isConnected && (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-xs font-medium text-n-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400/70 focus:ring-offset-2 focus:ring-offset-muted"
              title={disconnectTitle}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{disconnectLabel}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            disabled={disableRestart}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input/80 bg-sunken/70 px-3 text-xs font-medium text-n-gray-700 transition-colors hover:border-blue-400/70 hover:bg-blue-600/80 hover:text-n-white focus:outline-none focus:ring-2 focus:ring-blue-400/70 focus:ring-offset-2 focus:ring-offset-muted disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-n-gray-400 disabled:opacity-60 dark:text-n-gray-100 dark:disabled:text-n-gray-500"
            title={restartTitle}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRestarting ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{restartLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
