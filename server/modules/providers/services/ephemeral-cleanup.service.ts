import { sweepExpiredEphemeralForks } from '@/modules/database/index.js';
import { btwService } from '@/modules/providers/services/btw.service.js';

/**
 * Reclaims btw copies that outlived their drawer.
 *
 * A drawer deletes its copy when it closes, but the request can be lost (a
 * refresh, a crash, a dropped connection) and then nothing would ever remove
 * the row or the transcript. Two passes cover it:
 *
 * - **startup**, which reclaims everything: no drawer survives a restart;
 * - **a slow timer**, for copies a long-running server still holds — one left by
 *   a browser tab that was closed months ago.
 *
 * A third pass used to reclaim a copy once no chat socket watched it for two
 * minutes. It was removed: a lost socket is not proof the drawer is gone. A
 * laptop lid, a suspended phone or a network switch takes the subscription down
 * while the branch stays on screen, and the sweep then deleted a conversation
 * the reader was still looking at (the tab reconnected six minutes later to a
 * session that no longer existed, and every action on it answered 404). Leaving
 * the row until the next restart costs one hidden row and one transcript on
 * disk, which the timer below still collects.
 *
 * Consumers: `server/index.ts` (start on boot, stop on shutdown) and the
 * Providers module barrel.
 */

/** How often the slow timer looks for copies nobody has touched in hours. */
const SWEEP_INTERVAL_MS = 30 * 60 * 1_000;

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Reclaims leftovers once, then keeps sweeping in the background.
 *
 * Never throws: a stuck copy (a background task that refuses to stop) must not
 * prevent the server from starting, and the next sweep retries it.
 */
export async function initializeEphemeralCleanup(): Promise<void> {
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
  if (!sweepTimer) {
    return;
  }

  clearInterval(sweepTimer);
  sweepTimer = null;
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
