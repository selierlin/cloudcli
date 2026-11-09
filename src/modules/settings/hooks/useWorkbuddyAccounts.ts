import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type {
  WorkbuddySwitchCredits,
  WorkbuddySwitchOutcome,
  WorkbuddySwitchProgress,
  WorkbuddySwitchStatus,
} from '@/shared/types';

type WorkbuddyAccountsResult = {
  /** Last state read from the companion, or null until the first read settles. */
  status: WorkbuddySwitchStatus | null;
  /** Credits left per account, or null while unread or when the read failed. */
  credits: WorkbuddySwitchCredits | null;
  /** True only for the first read, so a refresh never blanks a populated card. */
  loading: boolean;
  /** True while a switch is in flight; every row's button is disabled for its duration. */
  switching: boolean;
  /** Latest step the companion reported for the running switch, or null between steps. */
  progress: string | null;
  /** Message of the last failed read or switch, or null when the last action succeeded. */
  error: string | null;
  /** Whether CloudCLI itself has a workbuddy turn in flight, which a restart kills. */
  hasActiveSessions: boolean;
  /** Re-reads the companion state without blanking the card. */
  refresh: () => void;
  /** Signs WorkBuddy in as one stored account; resolves true when the companion reports success. */
  switchTo: (accountId: string) => Promise<boolean>;
};

/** How often the card asks the companion what its in-flight switch is doing. */
const PROGRESS_POLL_INTERVAL_MS = 800;

/** Reads the running-session list and reports whether any of them is workbuddy. */
async function hasRunningWorkbuddySession(): Promise<boolean> {
  const body = await readApiJson<{ data?: { sessions?: Array<{ provider?: string }> } }>(
    await api.runningSessions(),
  );
  return (body.data?.sessions ?? []).some((session) => session.provider === 'workbuddy');
}

/**
 * Loads and switches the WorkBuddy accounts stored by the local
 * workbuddy-switch companion.
 *
 * Reads never throw: an absent companion is a normal state the card renders as
 * an install hint, so a machine without it keeps every other provider setting
 * usable. Only a switch reports a message, because that is the action the
 * reader just asked for.
 */
export function useWorkbuddyAccounts(): WorkbuddyAccountsResult {
  const [status, setStatus] = useState<WorkbuddySwitchStatus | null>(null);
  const [credits, setCredits] = useState<WorkbuddySwitchCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Last switch failure. Only a new attempt clears it: a state re-read never
  // touches it, because a failed switch triggers that same re-read to recover
  // the real state, which would erase the message before it is read.
  const [error, setError] = useState<string | null>(null);
  // Kept beside the status because a restart kills the workbuddy child process
  // the session runs on: the row has to warn before the click, not after.
  const [hasActiveSessions, setHasActiveSessions] = useState(false);
  // Bumped by refresh() to re-run the read effect without duplicating its body.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [statusBody, sessionsRunning] = await Promise.all([
          readApiJson<{ data: WorkbuddySwitchStatus }>(await api.workbuddySwitch.status()),
          // A failure here says nothing about the companion: falling into the
          // catch would turn a broken session list into an "install the
          // companion" hint. Only the warning is lost.
          hasRunningWorkbuddySession().catch(() => false),
        ]);
        if (cancelled) {
          return;
        }
        setStatus(statusBody.data);
        setHasActiveSessions(sessionsRunning);
      } catch (caughtError) {
        if (cancelled) {
          return;
        }
        console.error('Error loading WorkBuddy accounts:', caughtError);
        // A failed read still means "nothing to show": the card falls back to
        // its unavailable state rather than an error the reader cannot act on.
        setStatus({ available: false, version: null, running: false, currentUid: null, accounts: [] });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Balances come from a separate, slower read (the companion asks the billing
  // gateway, once per account). The rows render as soon as the status lands and
  // gain their balance when it arrives, so a slow read never delays a switch.
  const companionAvailable = status?.available ?? false;
  const accountKey = status?.accounts.map((account) => account.id).join(',') ?? '';

  useEffect(() => {
    if (!companionAvailable || !accountKey) {
      setCredits(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const body = await readApiJson<{ data: WorkbuddySwitchCredits }>(
          await api.workbuddySwitch.credits(),
        );
        if (!cancelled) {
          setCredits(body.data);
        }
      } catch (caughtError) {
        // A balance is an extra on the row: a failed read leaves it blank
        // rather than turning the account list into an error the reader
        // cannot act on.
        if (!cancelled) {
          console.error('Error loading WorkBuddy credits:', caughtError);
          setCredits(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `reloadToken` is a dependency on purpose: a reader who retries after a
    // failed load expects the balances to be re-asked for too.
  }, [accountKey, companionAvailable, reloadToken]);

  // Polling lives with the flag it serves, so unmounting or finishing the
  // switch always stops it without a second cleanup path.
  useEffect(() => {
    if (!switching) {
      return;
    }

    const timer = setInterval(() => {
      void (async () => {
        try {
          const body = await readApiJson<{ data: WorkbuddySwitchProgress }>(
            await api.workbuddySwitch.progress(),
          );
          setProgress(body.data.progress);
        } catch {
          // Progress is advisory: a failed poll must not replace the real
          // outcome of the switch with a polling error.
        }
      })();
    }, PROGRESS_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [switching]);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const switchTo = useCallback(async (accountId: string): Promise<boolean> => {
    setSwitching(true);
    setProgress(null);
    setError(null);
    try {
      const body = await readApiJson<{ data: WorkbuddySwitchOutcome }>(
        await api.workbuddySwitch.switchAccount(accountId),
      );
      setStatus(body.data.status);
      setHasActiveSessions(false);
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      // The account may have changed even when the request failed mid-way (for
      // example a session write blocked the launch), so re-read rather than
      // assume the previous row is still the signed-in one.
      refresh();
      return false;
    } finally {
      setSwitching(false);
      setProgress(null);
    }
  }, [refresh]);

  return { status, credits, loading, switching, progress, error, hasActiveSessions, refresh, switchTo };
}
