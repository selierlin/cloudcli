/**
 * How long a session row keeps its "recently had new content" tint after the
 * last content change.
 *
 * This is the navigation half of the two unread channels: the blue dot answers
 * "is something waiting on me?" and clears the moment you open the session,
 * while this faint tint answers "which session did I just glance at?" and
 * survives the open, so a session you looked at but did not answer stays
 * findable. It decays on its own — nothing the user does clears it early.
 */
export const RECENT_ACTIVITY_TTL_MS = 10 * 60 * 1000;

/**
 * True while the session's newest content is within the tint window.
 *
 * Uses `contentUpdatedAt` (the content-level timestamp), never `lastActivity`,
 * so a bare file `touch` that changes nothing does not light the row — the same
 * distinction the unread comparison relies on.
 */
export const isRecentlyActive = (
  contentUpdatedAt: string | null | undefined,
  currentTime: Date,
): boolean => {
  if (!contentUpdatedAt) {
    return false;
  }

  const contentMs = Date.parse(contentUpdatedAt);
  if (Number.isNaN(contentMs)) {
    return false;
  }

  return currentTime.getTime() - contentMs < RECENT_ACTIVITY_TTL_MS;
};
