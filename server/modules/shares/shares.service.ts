import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { sharedTranscriptsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/** Every published link stops working after this many days. */
const SHARE_TTL_DAYS = 7;

/** The largest export we accept; the JSON body limit is 50 MB. */
const MAX_HTML_BYTES = 32 * 1024 * 1024;

/** A 32-byte base64url token, i.e. what `randomBytes(32)` produces. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type SharedTranscriptsStore = Pick<
  typeof sharedTranscriptsDb,
  'insert' | 'findByTokenHash' | 'list' | 'revoke' | 'remove'
>;

type SharesServiceDependencies = {
  store: SharedTranscriptsStore;
  /** Overridable in tests; defaults to `~/.cloudcli/shares`, resolved per call. */
  directory?: string;
};

type CreateShareInput = {
  html: string;
  title: string;
  sessionId?: string | null;
  messageCount?: number;
};

type CreatedShare = {
  shareId: string;
  token: string;
  urlPath: string;
  expiresAt: string;
  title: string;
  messageCount: number;
};

type ResolvedShare =
  | { status: 'ok'; filePath: string; title: string; messageCount: number }
  | { status: 'missing' | 'expired' | 'revoked' };

/** One row of the settings list; a revoked share keeps its row but no link. */
type ListedShare = {
  shareId: string;
  /** Null when revoked, or for shares created before the token was kept. */
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

function sharesDirectory(dependencies: SharesServiceDependencies): string {
  return dependencies.directory ?? path.join(os.homedir(), '.cloudcli', 'shares');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Publishes, resolves and revokes fixed transcript snapshots.
 *
 * A share is an uploaded HTML file plus a row holding its token hash, expiry
 * and revocation mark. Nothing is rendered here: the caller already built the
 * same self-contained document the export produces, so a link and a downloaded
 * file show identical content. Used by the Shares routes.
 */
export function createSharesService(dependencies: SharesServiceDependencies) {
  const { store } = dependencies;

  async function removeShareFile(fileName: string): Promise<void> {
    await fs.rm(path.join(sharesDirectory(dependencies), fileName), { force: true });
  }

  /**
   * Deletes every expired row and its file.
   *
   * `resolveShare` can only clean the link it was asked for, so a share nobody
   * opens would keep its HTML for ever and the stated expiry would be a lie.
   * Runs on boot and before every listing; callers must not let a failure
   * escape — an uncleaned file is better than a server that will not start.
   */
  async function sweepExpired(): Promise<void> {
    for (const record of store.list()) {
      if (Date.parse(record.expiresAt) > Date.now()) continue;
      await removeShareFile(record.fileName);
      store.remove(record.shareId);
    }
  }

  return {
    /**
     * Writes the snapshot first and the row second: a row with no file would
     * be a link that resolves to nothing, while an orphan file is invisible.
     */
    async createShare(input: CreateShareInput): Promise<CreatedShare> {
      const html = input.html;
      if (typeof html !== 'string' || html.trim().length === 0) {
        throw new AppError('The transcript is empty', { code: 'EMPTY_TRANSCRIPT', statusCode: 400 });
      }
      if (!/^\s*<!DOCTYPE html/i.test(html) || !/<html[\s>]/i.test(html)) {
        throw new AppError('The transcript is not an HTML document', {
          code: 'INVALID_TRANSCRIPT',
          statusCode: 400,
        });
      }
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        throw new AppError('The transcript is too large to share', {
          code: 'TRANSCRIPT_TOO_LARGE',
          statusCode: 413,
        });
      }

      const directory = sharesDirectory(dependencies);
      await fs.mkdir(directory, { recursive: true });

      const shareId = randomUUID();
      const token = randomBytes(32).toString('base64url');
      const fileName = `${shareId}.html`;
      const filePath = path.join(directory, fileName);
      const temporaryPath = `${filePath}.tmp`;
      const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const title = input.title.trim().slice(0, 200);
      const messageCount = Number.isFinite(input.messageCount) ? Math.max(0, Math.trunc(input.messageCount as number)) : 0;

      await fs.writeFile(temporaryPath, html, 'utf8');
      await fs.rename(temporaryPath, filePath);

      try {
        store.insert({
          shareId,
          tokenHash: hashToken(token),
          token,
          sessionId: input.sessionId ?? null,
          title,
          fileName,
          byteSize: Buffer.byteLength(html, 'utf8'),
          messageCount,
          expiresAt,
        });
      } catch (error) {
        await removeShareFile(fileName);
        throw error;
      }

      return { shareId, token, urlPath: `/s/${token}`, expiresAt, title, messageCount };
    },

    /**
     * Turns a URL token into the file to serve.
     *
     * Expired rows are deleted on sight along with their file; the link was
     * going to stop working anyway, and leaving the snapshot on disk after its
     * stated expiry would make the expiry a lie.
     */
    async resolveShare(token: string): Promise<ResolvedShare> {
      if (!TOKEN_PATTERN.test(token)) {
        return { status: 'missing' };
      }

      const record = store.findByTokenHash(hashToken(token));
      if (!record) {
        return { status: 'missing' };
      }
      if (record.revokedAt) {
        return { status: 'revoked' };
      }
      if (Date.parse(record.expiresAt) <= Date.now()) {
        await removeShareFile(record.fileName);
        store.remove(record.shareId);
        return { status: 'expired' };
      }

      const filePath = path.join(sharesDirectory(dependencies), record.fileName);
      try {
        await fs.access(filePath);
      } catch {
        // The row outlived its file (manual cleanup, restored database). Treat
        // it as gone instead of serving a 500 to whoever holds the link.
        store.remove(record.shareId);
        return { status: 'missing' };
      }

      return {
        status: 'ok',
        filePath,
        title: record.title,
        messageCount: record.messageCount,
      };
    },

    /**
     * Lists publishable shares, newest first, dropping the ones that expired.
     *
     * Expired rows are removed rather than shown as "expired", because there is
     * nothing left to manage — the link already stopped working and its file is
     * gone. The sweep lives in `sweepExpired` so the boot path runs the same
     * cleanup for links nobody ever opens or lists.
     */
    async listShares(): Promise<ListedShare[]> {
      await sweepExpired();

      return store.list().map((record) => ({
        shareId: record.shareId,
        urlPath: record.revokedAt || !record.token ? null : `/s/${record.token}`,
        title: record.title,
        sessionId: record.sessionId,
        messageCount: record.messageCount,
        byteSize: record.byteSize,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
        status: record.revokedAt ? 'revoked' : 'active',
      }));
    },

    /** Exposed for the boot-time cleanup; see `sweepExpired`. */
    sweepExpired,

    /** Returns false when the share was already revoked or never existed. */
    async revokeShare(shareId: string): Promise<boolean> {
      const record = store.revoke(shareId);
      if (!record) {
        return false;
      }

      // The row keeps the timestamp; the readable copy must not stay on disk.
      await removeShareFile(record.fileName);
      return true;
    },
  };
}
