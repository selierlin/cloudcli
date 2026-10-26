import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { useSharedTranscripts, type SharedTranscriptSummary } from '@/modules/settings/hooks/useSharedTranscripts';
import { formatFileSize } from '@/modules/file-tree';

/** How long the copy button stays on its check icon after a successful copy. */
const COPIED_FEEDBACK_MS = 2000;

function shareUrl(share: SharedTranscriptSummary): string | null {
  return share.urlPath ? `${window.location.origin}${share.urlPath}` : null;
}

/**
 * Used by the Settings dialog's Shared Links tab.
 *
 * Every link published from the export panel or the selection bar lands here,
 * with the URL it was published under, its expiry, and the way to take it down.
 * Revoking is the only destructive action, so it asks first.
 */
export default function SharedTranscriptsSettingsTab() {
  const { t, i18n } = useTranslation('settings');
  const { shares, loading, revokingId, error, revoke, reload } = useSharedTranscripts();
  // Share id whose copy just succeeded; drives the check icon.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const handleCopy = useCallback(async (share: SharedTranscriptSummary) => {
    const url = shareUrl(share);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(share.shareId);
    } catch (copyError) {
      // The link is printed in the row, so a clipboard failure is not fatal.
      console.error('[Settings] Failed to copy a shared transcript link:', copyError);
    }
  }, []);

  const handleRevoke = useCallback(
    (share: SharedTranscriptSummary) => {
      if (!window.confirm(t('shares.confirmRevoke'))) return;
      void revoke(share.shareId);
    },
    [revoke, t],
  );

  return (
    <SettingsSection title={t('mainTabs.shares')} description={t('shares.description')}>
      <SettingsCard divided>
        {loading && (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t('shares.loading')}
          </p>
        )}

        {!loading && error && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">{t('shares.loadFailed')}</p>
            <button
              type="button"
              onClick={() => { void reload(); }}
              className="rounded-lg px-2.5 py-1 text-sm text-foreground transition-colors hover:bg-accent"
            >
              {t('shares.retry')}
            </button>
          </div>
        )}

        {!loading && !error && shares.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('shares.empty')}</p>
        )}

        {!loading && !error && shares.map((share) => {
          const url = shareUrl(share);
          const revoked = share.status === 'revoked';
          const meta = [
            t('shares.messageCount', { count: share.messageCount }),
            formatFileSize(share.byteSize),
            revoked
              ? t('shares.revokedAt', { time: new Date(share.revokedAt as string).toLocaleString(i18n.language) })
              : t('shares.expiresAt', { time: new Date(share.expiresAt).toLocaleString(i18n.language) }),
          ].join(' · ');

          return (
            <div key={share.shareId} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate text-sm ${revoked ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {share.title || t('shares.untitled')}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      revoked ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                    }`}
                  >
                    {revoked ? t('shares.statusRevoked') : t('shares.statusActive')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
                {url ? (
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{url}</p>
                ) : (
                  !revoked && <p className="mt-1 text-xs text-muted-foreground">{t('shares.linkUnavailable')}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {url && (
                  <>
                    <button
                      type="button"
                      onClick={() => { void handleCopy(share); }}
                      title={t('shares.copy')}
                      aria-label={t('shares.copy')}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {copiedId === share.shareId ? (
                        <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {copiedId === share.shareId ? t('shares.copied') : t('shares.copy')}
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={t('shares.open')}
                      aria-label={t('shares.open')}
                      className="inline-flex items-center rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </>
                )}
                {!revoked && (
                  <button
                    type="button"
                    onClick={() => handleRevoke(share)}
                    disabled={revokingId === share.shareId}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-default disabled:opacity-60"
                  >
                    {revokingId === share.shareId ? t('shares.revoking') : t('shares.revoke')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}
