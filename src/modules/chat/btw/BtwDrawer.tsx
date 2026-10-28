import { useTranslation } from 'react-i18next';
import { MessageSquareDashed, PanelRightClose, X } from 'lucide-react';

import type {
  ChatMessage,
  DiffLine,
  LLMProvider,
  PendingPermissionRequest,
  Project,
} from '@/shared/types';
import { Button } from '@/shared/ui';
import { isImeKeyEvent } from '@/shared/utils';
import type { BtwController } from '@/modules/chat/hooks/useBtwSession';
import type { SideAskPlacement } from '@/modules/chat/hooks/useSideAskPlacement';
import { btwFailureMessageKey } from '@/modules/chat/utils/btwFailureMessage';
import BtwComposer from '@/modules/chat/btw/BtwComposer';
import BtwMessageList from '@/modules/chat/btw/BtwMessageList';

type BtwDrawerProps = {
  open: boolean;
  btw: BtwController;
  /** Whether the drawer sits beside the transcript, floats over it, or fills it. */
  placement: SideAskPlacement;
  /** True while the reader has tucked the panel away to use the main conversation. */
  minimized: boolean;
  /** Collapses the panel into the edge tab, whichever layout it is in. */
  onMinimize: () => void;
  /** Brings a collapsed panel back. */
  onRestore: () => void;
  /** Title of the conversation this branch came from, for the header. */
  sourceTitle: string;
  provider: LLMProvider;
  selectedProject: Project | null;
  messages: ChatMessage[];
  isProcessing: boolean;
  canAbort: boolean;
  /** True while the conversation being asked about is mid-turn. */
  sourceIsProcessing: boolean;
  /** Human-readable cut point, e.g. "Context up to message 3". */
  anchorLabel: string | null;
  /** Provider-specific clarification for a degraded anchor, if any. */
  anchorNotice: string | null;
  permissionModeLabel: string;
  permissionRequests: PendingPermissionRequest[];
  onPermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  onSend: (text: string) => Promise<boolean>;
  onClose: () => void;
  onRefork: () => void;
  onPromote: () => void;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
};

/**
 * The side-question drawer: a hidden branch of the open conversation, shown on
 * its own so a question asked here never enters the main transcript.
 *
 * Rendered by ChatInterface. On a wide enough chat column it is docked beside
 * the transcript and the transcript shrinks, so neither side covers the other;
 * on a narrower one it floats over the transcript; on a phone it takes the
 * whole column and shrinks by `--keyboard-height`, the offset the workspace
 * shell already maintains for the virtual keyboard.
 *
 * Any of the three can be collapsed into an edge tab. That matters most on a
 * phone, where the sheet would otherwise put the main composer out of reach for
 * as long as the branch lives, and on a laptop where the reader wants the
 * transcript at full width without discarding the branch.
 *
 * The floating and sheet layouts are positioned inside the chat column rather
 * than against the viewport: the column already carries the shell's safe-area
 * padding, and anchoring to the viewport would let the panel slide over the
 * editor sidebar when that is open.
 */
export default function BtwDrawer({
  open,
  btw,
  placement,
  minimized,
  onMinimize,
  onRestore,
  sourceTitle,
  provider,
  selectedProject,
  messages,
  isProcessing,
  canAbort,
  sourceIsProcessing,
  anchorLabel,
  anchorNotice,
  permissionModeLabel,
  permissionRequests,
  onPermissionDecision,
  onGrantToolPermission,
  onSend,
  onClose,
  onRefork,
  onPromote,
  createDiff,
  onFileOpen,
  showRawParameters,
  showThinking,
}: BtwDrawerProps) {
  const { t } = useTranslation('chat');

  if (!open) {
    return null;
  }

  if (minimized) {
    // The branch is still alive — only its panel is gone — so the tab stays in
    // the transcript's own corner and carries the run indicator: a copy left
    // working behind a hidden panel would otherwise be invisible.
    return (
      <button
        type="button"
        onClick={onRestore}
        title={t('sideAsk.restore')}
        aria-label={t('sideAsk.restore')}
        className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-md border border-r-0 border-border bg-background px-1 py-2 text-[11px] text-muted-foreground shadow-sm hover:text-foreground"
      >
        <MessageSquareDashed className="h-3.5 w-3.5" />
        <span style={{ writingMode: 'vertical-rl' }}>{t('sideAsk.title')}</span>
        {isProcessing && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
        )}
      </button>
    );
  }

  const hasSession = Boolean(btw.sessionId);
  const busy = btw.creating || btw.closing;
  const closeFailure = btw.closeFailure;
  const docked = placement === 'docked';

  return (
    // `data-slot` is how ChatInterface's global Escape handler tells a press
    // inside this drawer from one in the conversation behind it; the selector
    // has no other guard, so renaming the slot silently re-arms both handlers.
    <aside
      role="complementary"
      aria-label={t('sideAsk.title')}
      data-slot="btw-drawer"
      onKeyDown={(event) => {
        // A pinyin candidate is cancelled with Escape. Without this check that
        // press closes the drawer and discards the branch the user was writing
        // into.
        if (event.key === 'Escape' && !event.defaultPrevented && !isImeKeyEvent(event)) {
          event.stopPropagation();
          onClose();
        }
      }}
      style={docked ? undefined : {
        height: 'calc(100% - var(--keyboard-height, 0px))',
      }}
      className={docked
        ? 'relative flex h-full w-[420px] flex-shrink-0 flex-col border-l border-border bg-background'
        : placement === 'overlay'
          ? 'absolute right-0 top-0 z-40 flex w-[420px] flex-col border-l border-border bg-background shadow-xl'
          : 'absolute right-0 top-0 z-40 flex w-full flex-col border-l border-border bg-background shadow-xl'}
    >
      <header className="flex-shrink-0 border-b border-border/70 px-3 py-2">
        <div className="flex items-start gap-2">
          <MessageSquareDashed className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">{t('sideAsk.title')}</h2>
              <span className="flex-shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground">
                {t('sideAsk.badge')}
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground" title={sourceTitle}>
              {anchorLabel ?? t('sideAsk.anchorDefault')}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 flex-shrink-0"
            title={t('sideAsk.minimize')}
            aria-label={t('sideAsk.minimize')}
            onClick={onMinimize}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 flex-shrink-0"
            title={t('sideAsk.close')}
            aria-label={t('sideAsk.close')}
            onClick={onClose}
            disabled={btw.closing}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onPromote}
            disabled={!hasSession || busy}
          >
            {t('sideAsk.saveAsSession')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onRefork}
            disabled={busy || isProcessing}
          >
            {t('sideAsk.refork')}
          </Button>
        </div>

        {btw.closing && (
          <p className="mt-1 text-[11px] text-muted-foreground">{t('sideAsk.closing')}</p>
        )}

        {closeFailure && (
          <div className="mt-1 flex items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-2 py-1">
            <p className="min-w-0 flex-1 text-[11px] text-foreground">
              {closeFailure === 'still-running' ? t('sideAsk.stillRunning') : t('sideAsk.closeFailed')}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={onClose}
              disabled={btw.closing}
            >
              {t('sideAsk.retry')}
            </Button>
          </div>
        )}

        {sourceIsProcessing && (
          <p className="mt-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            {t('sideAsk.sourceBusy')}
          </p>
        )}

        {anchorNotice && (
          <p className="mt-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            {anchorNotice}
          </p>
        )}

        {btw.createError && (
          <p className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-foreground">
            {t(btwFailureMessageKey(btw.createError))}
          </p>
        )}
      </header>

      <BtwMessageList
        messages={messages}
        provider={provider}
        selectedProject={selectedProject}
        createDiff={createDiff}
        onFileOpen={onFileOpen}
        showRawParameters={showRawParameters}
        showThinking={showThinking}
        isProcessing={isProcessing}
        emptyState={(
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            {btw.creating ? (
              <p className="text-sm text-muted-foreground">{t('sideAsk.creating')}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">{t('sideAsk.emptyTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('sideAsk.emptyBody')}</p>
              </>
            )}
          </div>
        )}
      />

      <BtwComposer
        disabled={btw.creating || btw.closing || isProcessing}
        isProcessing={isProcessing}
        canAbort={canAbort}
        permissionModeLabel={permissionModeLabel}
        permissionRequests={permissionRequests}
        onPermissionDecision={onPermissionDecision}
        onGrantToolPermission={onGrantToolPermission}
        onSend={onSend}
        onAbort={btw.abort}
      />
    </aside>
  );
}
