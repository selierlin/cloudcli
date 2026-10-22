/**
 * Tracks which chat sockets are watching which session.
 *
 * A socket that sent `chat.subscribe` is proof the session is on screen; the
 * last socket to go away is the only signal the server has that nobody is
 * looking at it any more. That matters for aside copies: their drawer deletes
 * them on close, but a refresh leaves the copy behind with nothing to reclaim
 * it until the six-hour sweep.
 *
 * The idle notification is deliberately delayed by a grace period, because a
 * socket also drops for reasons that do not close the drawer — a laptop lid, a
 * network blip, a reconnect. A client that comes back re-subscribes and cancels
 * the timer, so only a copy nobody came back for is reclaimed.
 *
 * This file imports nothing on purpose. The chat gateway calls it, and the
 * aside service already depends on that gateway, so importing the aside service
 * here would close a cycle.
 */

type Connection = object;

/** Sessions watched by each connection, so a close can find them. */
const watchedSessions = new Map<Connection, Set<string>>();

/** Connections watching each session, so a close can tell if anyone is left. */
const watchers = new Map<string, Set<Connection>>();

/** Pending "nobody is watching" notifications, one per idle session. */
const idleTimers = new Map<string, NodeJS.Timeout>();

let graceMs = 0;
let onIdle: ((sessionId: string) => void) | null = null;

/**
 * Sets what happens when a session loses its last watcher.
 *
 * Passing `null` disables the notification and forgets every watcher along with
 * the pending timers. Nothing can reclaim a copy once nobody is listening for
 * the notification, so keeping the state would only mislead the next caller;
 * shutdown uses this, and so does each test file, which must not inherit the
 * previous test's sockets.
 *
 * Consumers: `ephemeral-cleanup.service.ts` (reclaims aside copies) and the
 * websocket module's own tests.
 */
export function configureSessionPresence(
  options: { graceMs: number; onIdle: (sessionId: string) => void } | null,
): void {
  clearIdleTimers();
  watchedSessions.clear();
  watchers.clear();

  if (!options) {
    onIdle = null;
    graceMs = 0;
    return;
  }

  graceMs = Math.max(0, options.graceMs);
  onIdle = options.onIdle;
}

/** Records that `connection` is watching `sessionId`, cancelling any idle timer. */
export function watchSession(connection: Connection, sessionId: string): void {
  let sessions = watchedSessions.get(connection);
  if (!sessions) {
    sessions = new Set();
    watchedSessions.set(connection, sessions);
  }
  sessions.add(sessionId);

  let connections = watchers.get(sessionId);
  if (!connections) {
    connections = new Set();
    watchers.set(sessionId, connections);
  }
  connections.add(connection);

  const timer = idleTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    idleTimers.delete(sessionId);
  }
}

/**
 * Drops everything `connection` was watching and notifies the ones left with
 * no watcher, after the grace period.
 *
 * Safe to call twice: the second call finds no record and does nothing.
 */
export function forgetConnection(connection: Connection): void {
  const sessions = watchedSessions.get(connection);
  if (!sessions) {
    return;
  }
  watchedSessions.delete(connection);

  for (const sessionId of sessions) {
    const connections = watchers.get(sessionId);
    connections?.delete(connection);
    if (connections && connections.size > 0) {
      continue;
    }
    watchers.delete(sessionId);
    scheduleIdle(sessionId);
  }
}

/** Cancels every pending idle notification, without notifying anyone. */
function clearIdleTimers(): void {
  for (const timer of idleTimers.values()) {
    clearTimeout(timer);
  }
  idleTimers.clear();
}

/** Arms the grace timer for a session nothing is watching any more. */
function scheduleIdle(sessionId: string): void {
  if (!onIdle || idleTimers.has(sessionId)) {
    return;
  }

  const timer = setTimeout(() => {
    idleTimers.delete(sessionId);
    // A watcher can arrive without a `watchSession` call only through a bug;
    // checking here keeps a stale timer from reclaiming a session someone is
    // looking at, which would delete the transcript under them.
    if (watchers.has(sessionId)) {
      return;
    }
    onIdle?.(sessionId);
  }, graceMs);

  // A reclaim timer must never be the reason the process stays alive.
  timer.unref();
  idleTimers.set(sessionId, timer);
}
