/**
 * The single server-side implementation of "is this session unread for a user".
 *
 * Unread is the server's answer now, not the client's: the project-list
 * projection and the `session_upserted` delta both call this, so the sidebar can
 * never show a flag the project list would have cleared. Two rules keep a
 * session from being flagged: a provider that cannot supply a content timestamp
 * (`contentUpdatedAt` is null), and a user with no watermark yet (they never
 * opened it — the feature must not greet an upgrade with a wall of flags). The
 * comparison is a strict `>` so a watermark equal to the content timestamp means
 * "read", matching what the client computed before the decision moved here.
 */
export function isSessionContentUnread(
  contentUpdatedAt: string | null | undefined,
  lastSeenAt: string | null | undefined,
): boolean {
  if (!contentUpdatedAt || !lastSeenAt) {
    return false;
  }

  const contentMs = Date.parse(contentUpdatedAt);
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(contentMs) || Number.isNaN(seenMs)) {
    return false;
  }

  return contentMs > seenMs;
}
