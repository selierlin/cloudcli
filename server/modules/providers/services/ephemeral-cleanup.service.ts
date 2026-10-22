import { sessionsDb, sweepExpiredEphemeralForks } from '@/modules/database/index.js';
import { btwService } from '@/modules/providers/services/btw.service.js';
import { configureSessionPresence } from '@/modules/websocket/index.js';

/**
 * Reclaims btw copies that outlived their drawer.
 *
 * A drawer deletes its copy when it closes, but the request can be lost (a
 * refresh, a crash, a dropped connection) and then nothing would ever remove
 * the row or the transcript. Three passes cover it:
 *
 * - **the socket**, which is the fast path: a copy nobody subscribes to any
 *   more is reclaimed after `IDLE_GRACE_MS`, which is short enough that a
 *   refreshed page does not leave a hidden transcript around and long enough
 *   that a reconnecting tab can cancel it;
 * - **startup**, which reclaims everything (no drawer can still be open across
 *   a restart);
 * - **a slow timer**, for copies that never got as far as a subscription — a
 *   server that runs for days while one browser tab was closed months ago.
 *
 * Consumers: `server/index.ts` (start on boot, stop on shutdown) and the
 * Providers module barrel.
 */

/** How long a copy may sit unwatched before the socket pass reclaims it. */
const IDLE_GRACE_MS = 2 * 60 * 1_000;

/** Only copies older than this are swept while the server is running. */
const SWEEP_INTERVAL_MS = 30 * 60 * 1_000;

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Reclaims leftovers once, then keeps sweeping in the background.
 *
 * Never throws: a stuck copy (a background task that refuses to stop) must not
 * prevent the server from starting, and the next sweep retries it.
 */
export async function initializeEphemeralCleanup(): Promise<void> {
  // The socket pass only arms once the server can answer a subscription: an
  // idle notification that arrives before the chat gateway is up would fire
  // against copies a reconnecting tab is about to reclaim anyway.
  configureSessionPresence({
    graceMs: IDLE_GRACE_MS,
    onIdle: (sessionId) => {
      void reclaimIdleSession(sessionId);
    },
  });

  // Registrations whose fork never reported back can still have marked a row
  // hidden; dropping them first means the sweep below sees a truthful state.
  sweepExpiredEphemeralForks();

  try {
    const reclaimed = await btwService.reclaimEphemeralSessions({ staleOnly: false });
    if (reclaimed > 0) {
      console.log(`[btw] Reclaimed ${reclaimed} leftover aside session(s) on startup`);
    }
  } catch (error) {
    console.error('[btw] Startup aside cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (sweepTimer) {
    return;
  }

  sweepTimer = setInterval(() => {
    void runPeriodicSweep();
  }, SWEEP_INTERVAL_MS);
  // A cleanup timer must never be the reason the process stays alive.
  sweepTimer.unref();
}

/** Stops the periodic sweep. Consumers: the server's shutdown path. */
export function closeEphemeralCleanup(): void {
  configureSessionPresence(null);

  if (!sweepTimer) {
    return;
  }
  clearInterval(sweepTimer);
  sweepTimer = null;
}

/**
 * Reclaims one copy whose drawer's socket went away and never came back.
 *
 * Re-read the row first: a normal close, a promotion or an earlier sweep may
 * have settled it already, and neither case should report an error. A copy that
 * is still unwinding throws 409 from the delete and is left for the periodic
 * sweep, exactly like a close that failed.
 */
async function reclaimIdleSession(sessionId: string): Promise<void> {
  const session = sessionsDb.getSessionById(sessionId);
  if (!session?.is_ephemeral) {
    return;
  }

  try {
    await btwService.destroyBtwSession(sessionId);
    console.log(`[btw] Reclaimed aside session ${sessionId} after its drawer disconnected`);
  } catch (error) {
    console.error('[btw] Failed to reclaim an idle aside session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** One periodic pass: expire registrations, then reclaim long-idle copies. */
async function runPeriodicSweep(): Promise<void> {
  try {
    sweepExpiredEphemeralForks();
    await btwService.reclaimEphemeralSessions({ staleOnly: true });
  } catch (error) {
    console.error('[btw] Periodic aside cleanup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
