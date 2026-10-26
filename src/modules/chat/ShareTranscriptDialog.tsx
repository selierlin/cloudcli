import { CheckIcon, CopyIcon, Loader2Icon, Share2Icon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildTranscriptExport,
  publishTranscriptHtml,
  type SharedTranscriptLink,
  type TranscriptExportInput,
} from '@/modules/chat/utils/chatExport';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';
import { api } from '@/shared/api';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/Dialog';

type ShareTranscriptDialogProps = {
  /** Called by the close button, Escape, or a click on the backdrop. */
  onClose: () => void;
  /**
   * Called once the snapshot is published.
   *
   * The dialog stays open so the link can be copied, but the picking that
   * produced it is finished: the caller uses this to leave that mode instead
   * of leaving the reader in it after the dialog closes.
   */
  onShared?: () => void;
  /** The rows to publish: the whole transcript, or exactly the ones the reader picked. */
  messages: TranscriptExportInput['messages'];
  sessionTitle: string;
  provider: TranscriptExportInput['provider'];
  selectedProject?: TranscriptExportInput['selectedProject'];
  sessionId?: string | null;
  /** Whole conversation, when `messages` is only the selected subset. */
  totalMessages?: TranscriptExportInput['messages'];
  /** True when `messages` is a picked subset, even if the total is unknown. */
  isExcerpt?: boolean;
  /**
   * Stacking class for the modal layer.
   *
   * The default outranks the quick settings panel, because both entries into
   * this dialog — the chat's selection bar and that panel's export section —
   * can open it while the panel is on screen, and a dialog tucked under a
   * drawer is unusable. Set once here rather than per call site so a third
   * entry cannot forget it.
   */
  wrapperClassName?: string;
};

type SharePhase = 'building' | 'ready' | 'creating' | 'shared' | 'error';

type ShareSnapshot = TranscriptExportInput & { sessionId?: string | null };

/**
 * Publishes a fixed snapshot of the transcript at `/s/<token>`.
 *
 * Rendered by chat's selection bar (for picked rows) and by the quick-settings
 * export section (for the whole conversation). Mounted only while open, so each
 * opening starts from a clean slate and captures the transcript as it was at
 * that moment — a turn that keeps streaming must not change what gets published.
 * Building and uploading are separate steps on purpose: nothing becomes
 * publicly reachable before the reader presses "create".
 */
export default function ShareTranscriptDialog({
  onClose,
  onShared,
  messages,
  sessionTitle,
  provider,
  selectedProject,
  sessionId,
  totalMessages,
  isExcerpt,
  wrapperClassName = 'z-[10000]',
}: ShareTranscriptDialogProps) {
  const { t, i18n } = useTranslation('chat');
  const createDiff = useMemo(() => createCachedDiffCalculator(), []);
  // Frozen at mount. `useState`'s initializer runs once, which is exactly the
  // lifetime of one dialog opening.
  const [snapshot] = useState<ShareSnapshot>(() => ({
    messages,
    sessionTitle,
    provider,
    selectedProject,
    createDiff,
    totalMessages,
    isExcerpt,
    sessionId,
    // The published page is served under a CSP without `script-src`, so it must
    // not ship the theme toggle or the two inline scripts: they would render as
    // dead controls. Kept out of the props because it is a property of
    // publishing, not of the transcript.
    interactive: false,
  }));

  const [phase, setPhase] = useState<SharePhase>('building');
  // Incremented by "retry"; it re-runs the build effect below.
  const [attempt, setAttempt] = useState(0);
  // The built document is held so "create" uploads exactly what was measured;
  // building again at click time could publish a longer transcript.
  const [html, setHtml] = useState<string | null>(null);
  const [link, setLink] = useState<SharedTranscriptLink | null>(null);
  // Feedback for the copy button only; the link stays selectable when the
  // clipboard API is unavailable (insecure origins).
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const count = snapshot.messages.length;

  useEffect(() => {
    let cancelled = false;
    void buildTranscriptExport('html', snapshot, new Date())
      .then((built) => {
        if (cancelled) return;
        setHtml(built);
        setPhase('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[Chat] Failed to build the shared transcript:', error);
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot, attempt]);

  const retry = useCallback(() => {
    setHtml(null);
    setLink(null);
    setCopied(false);
    setRevoked(false);
    setPhase('building');
    setAttempt((previous) => previous + 1);
  }, []);

  const handleCreate = async () => {
    if (!html || phase === 'creating') return;
    setPhase('creating');
    try {
      const published = await publishTranscriptHtml(html, {
        title: snapshot.sessionTitle,
        sessionId: snapshot.sessionId,
        messageCount: count,
      });
      setLink(published);
      setPhase('shared');
      // The snapshot is public and frozen now, so the picking that led here
      // has done its job; the dialog itself stays open for copying the link.
      onShared?.();
    } catch (error) {
      console.error('[Chat] Failed to publish the transcript:', error);
      setPhase('error');
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // Selecting the input is the fallback; a wrong "copied" badge would be
      // worse than no feedback at all.
      setCopied(false);
    }
  };

  const handleRevoke = async () => {
    if (!link || revoking) return;
    setRevoking(true);
    try {
      const response = await api.shares.revoke(link.shareId);
      if (!response.ok && response.status !== 404) {
        throw new Error(`Revoke failed (${response.status})`);
      }
      setRevoked(true);
    } catch (error) {
      console.error('[Chat] Failed to revoke the shared transcript:', error);
    } finally {
      setRevoking(false);
    }
  };

  const expiresAt = link
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(link.expiresAt))
    : '';

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md p-5" wrapperClassName={wrapperClassName}>
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <Share2Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('transcript.share.title')}
        </DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('transcript.share.description', { count })}
        </p>

        {phase === 'building' && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('transcript.share.building')}
          </div>
        )}

        {phase === 'ready' && (
          <>
            <p className="mt-3 text-xs text-muted-foreground">{t('transcript.share.warning')}</p>
            <button
              type="button"
              onClick={() => { void handleCreate(); }}
              className="mt-4 w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('transcript.share.create')}
            </button>
          </>
        )}

        {phase === 'creating' && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('transcript.share.creating')}
          </div>
        )}

        {phase === 'shared' && link && (
          <div className="mt-4 space-y-3">
            <label htmlFor="share-transcript-link" className="text-xs font-medium text-muted-foreground">
              {t('transcript.share.linkLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="share-transcript-link"
                readOnly
                value={link.url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-input bg-card px-2 py-1.5 text-xs text-foreground"
              />
              <button
                type="button"
                onClick={() => { void handleCopy(); }}
                title={copied ? t('transcript.share.copied') : t('transcript.share.copy')}
                aria-label={copied ? t('transcript.share.copied') : t('transcript.share.copy')}
                className="shrink-0 rounded-lg border border-input px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {copied
                  ? <CheckIcon className="h-4 w-4 text-primary" aria-hidden="true" />
                  : <CopyIcon className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {revoked
                ? t('transcript.share.revoked')
                : t('transcript.share.expires', { date: expiresAt })}
            </p>
            {!revoked && (
              <p className="text-xs text-muted-foreground">{t('transcript.share.manageHint')}</p>
            )}
            {!revoked && (
              <button
                type="button"
                onClick={() => { void handleRevoke(); }}
                disabled={revoking}
                className="text-xs text-destructive transition-colors hover:underline disabled:cursor-default disabled:opacity-60"
              >
                {revoking ? t('transcript.share.revoking') : t('transcript.share.revoke')}
              </button>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-4 space-y-3">
            <p role="alert" className="text-xs text-destructive">{t('transcript.share.error')}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-lg border border-input px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
            >
              {t('transcript.share.retry')}
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('transcript.share.close')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
