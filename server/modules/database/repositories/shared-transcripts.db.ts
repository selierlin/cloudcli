import { getConnection } from '@/modules/database/connection.js';

/**
 * One published transcript snapshot.
 *
 * `tokenHash` is the SHA-256 of the public link token and is what the public
 * route looks up; `token` keeps the plaintext so the settings list can show and
 * re-copy the link after the creation dialog is gone (NULL for rows created
 * before that column existed). Timestamps are ISO-8601 UTC strings so the
 * service can compare them without SQLite's ambiguous `YYYY-MM-DD HH:MM:SS`
 * parsing (which JavaScript treats as local time).
 */
type SharedTranscriptRecord = {
  shareId: string;
  tokenHash: string;
  token: string | null;
  sessionId: string | null;
  title: string;
  fileName: string;
  byteSize: number;
  messageCount: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

type SharedTranscriptRow = {
  share_id: string;
  token_hash: string;
  token: string | null;
  session_id: string | null;
  title: string;
  file_name: string;
  byte_size: number;
  message_count: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

type InsertSharedTranscriptInput = {
  shareId: string;
  tokenHash: string;
  token: string;
  sessionId: string | null;
  title: string;
  fileName: string;
  byteSize: number;
  messageCount: number;
  expiresAt: string;
};

function toRecord(row: SharedTranscriptRow): SharedTranscriptRecord {
  return {
    shareId: row.share_id,
    tokenHash: row.token_hash,
    token: row.token,
    sessionId: row.session_id,
    title: row.title,
    fileName: row.file_name,
    byteSize: row.byte_size,
    messageCount: row.message_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Persistence for published transcript snapshots; used by the Shares module.
 *
 * There is deliberately no foreign key to `sessions`: the published HTML is a
 * copy, and deleting or renaming the conversation must not break a link that
 * someone already has.
 */
export const sharedTranscriptsDb = {
  /** Inserts one snapshot row after its HTML file has been written. */
  insert(input: InsertSharedTranscriptInput): void {
    getConnection()
      .prepare(
        `INSERT INTO shared_transcripts
           (share_id, token_hash, token, session_id, title, file_name, byte_size, message_count, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.shareId,
        input.tokenHash,
        input.token,
        input.sessionId,
        input.title,
        input.fileName,
        input.byteSize,
        input.messageCount,
        input.expiresAt
      );
  },

  /**
   * Every share, newest first, for the settings list.
   *
   * Unbounded on purpose: publishing is a manual act by a single user, so the
   * table stays small, and a hidden cap would silently make older links
   * unmanageable — exactly the problem the list exists to solve.
   */
  list(): SharedTranscriptRecord[] {
    const rows = getConnection()
      .prepare('SELECT * FROM shared_transcripts ORDER BY created_at DESC')
      .all() as SharedTranscriptRow[];

    return rows.map(toRecord);
  },

  /** Looks up a share by the hash of the token in the URL; null when unknown. */
  findByTokenHash(tokenHash: string): SharedTranscriptRecord | null {
    const row = getConnection()
      .prepare('SELECT * FROM shared_transcripts WHERE token_hash = ? LIMIT 1')
      .get(tokenHash) as SharedTranscriptRow | undefined;

    return row ? toRecord(row) : null;
  },

  /**
   * Marks a share revoked and returns the row that changed, or null when it was
   * already revoked or never existed.
   *
   * The row is kept: a second revoke should answer "already revoked", and the
   * timestamp is the only record of when the link stopped working. The caller
   * needs `fileName` to delete the readable copy.
   */
  revoke(shareId: string): SharedTranscriptRecord | null {
    const row = getConnection()
      .prepare('SELECT * FROM shared_transcripts WHERE share_id = ? LIMIT 1')
      .get(shareId) as SharedTranscriptRow | undefined;
    if (!row || row.revoked_at) {
      return null;
    }

    const revokedAt = new Date().toISOString();
    getConnection()
      .prepare('UPDATE shared_transcripts SET revoked_at = ? WHERE share_id = ?')
      .run(revokedAt, shareId);

    return toRecord({ ...row, revoked_at: revokedAt });
  },

  /** Removes a row whose HTML has been (or is about to be) deleted. */
  remove(shareId: string): void {
    getConnection()
      .prepare('DELETE FROM shared_transcripts WHERE share_id = ?')
      .run(shareId);
  },
};
