import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';

/**
 * One published transcript as the settings list sees it.
 *
 * `urlPath` is null once the link is revoked, and also for shares published
 * before the server started keeping the token — those can only be revoked.
 */
export type SharedTranscriptSummary = {
  shareId: string;
  urlPath: string | null;
  title: string;
  sessionId: string | null;
  messageCount: number;
  byteSize: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: 'active' | 'revoked';
};

/** Wire shape of `GET /api/shares`; only used here. */
type SharedTranscriptsResponse = {
  shares?: SharedTranscriptSummary[];
};

/**
 * Loads the published links for the Shared Links settings tab.
 *
 * The server is the only source of truth here: it drops expired shares while
 * listing, so the tab shows exactly what can still be revoked.
 */
export function useSharedTranscripts() {
  const [shares, setShares] = useState<SharedTranscriptSummary[]>([]);
  // True until the first response lands; the empty state must not flash first.
  const [loading, setLoading] = useState(true);
  // Share id being revoked, so only that row's button spins.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await readApiJson<SharedTranscriptsResponse>(await api.shares.list());
      setShares(payload.shares ?? []);
      setError(null);
    } catch (fetchError) {
      console.error('[Settings] Failed to load shared transcripts:', fetchError);
      setShares([]);
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  /**
   * Revokes one link and re-reads the list.
   *
   * Reloading instead of patching the row keeps "still active?" answered by the
   * server, which is also what decides whether the file is gone.
   */
  const revoke = useCallback(
    async (shareId: string) => {
      setRevokingId(shareId);
      try {
        const response = await api.shares.revoke(shareId);
        // 404 means there is nothing left to revoke: the link was already
        // revoked elsewhere, or the server swept it as expired. That is the
        // outcome the caller asked for, so reload instead of reporting a
        // failure the reader can do nothing about.
        if (!response.ok && response.status !== 404) {
          throw new Error(`Revoke failed (${response.status})`);
        }
        await fetchShares();
      } catch (revokeError) {
        console.error('[Settings] Failed to revoke a shared transcript:', revokeError);
        setError(revokeError instanceof Error ? revokeError.message : String(revokeError));
      } finally {
        setRevokingId(null);
      }
    },
    [fetchShares],
  );

  return { shares, loading, revokingId, error, revoke, reload: fetchShares };
}
