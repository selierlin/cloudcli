import { AppError } from '@/shared/utils.js';

import {
  requestWorkbuddySwitch,
  resolveWorkbuddySwitchBaseUrl,
  WORKBUDDY_SWITCH_CREDITS_TIMEOUT_MS,
  WORKBUDDY_SWITCH_TIMEOUT_MS,
  WorkbuddySwitchUnavailableError,
} from '@/modules/workbuddy-switch/workbuddy-switch.client.js';

/**
 * One WorkBuddy account the companion can sign CloudCLI in as.
 *
 * The companion reports no tokens here — only display metadata — so this shape
 * is safe to forward to the browser unchanged.
 */
export type WorkbuddySwitchAccount = {
  /** Companion record id; the value `switchWorkbuddyAccount` takes. */
  id: string;
  /** WorkBuddy user id; compared with `currentUid` to mark the signed-in row. */
  uid: string | null;
  nickname: string | null;
  /** Already masked by the companion (e.g. `153****6231`). */
  phoneNumber: string | null;
  email: string | null;
  /** Session expiry in epoch milliseconds, or null when the companion has none. */
  expiresAt: number | null;
  /** True when the stored session can no longer be used without signing in again. */
  needsRelogin: boolean;
  isEnterprise: boolean;
};

/**
 * Everything the settings card needs in one read: whether the companion is
 * there, which WorkBuddy build it targets, whether the desktop app is running
 * and which accounts are available.
 *
 * `available: false` is a normal answer, not an error: the companion is an
 * optional local service, and the card degrades to an install hint instead of
 * failing the settings page.
 */
export type WorkbuddySwitchStatus = {
  available: boolean;
  /** Companion version, used only for display and mismatch hints. */
  version: string | null;
  /** Whether the WorkBuddy desktop app is running, which decides the restart mode. */
  running: boolean;
  /** UID of the account WorkBuddy is signed in as, or null when signed out. */
  currentUid: string | null;
  accounts: WorkbuddySwitchAccount[];
};

/** Result of a completed switch, plus the freshly read status so the card can update in one round trip. */
export type WorkbuddySwitchOutcome = {
  /** Display name the companion reports for the account just signed in. */
  account: string | null;
  /** Whether the companion restarted the desktop app (only when it was already running). */
  restarted: boolean;
  status: WorkbuddySwitchStatus;
};

/** Live progress of an in-flight switch, as the companion reports it. */
export type WorkbuddySwitchProgress = {
  running: boolean;
  progress: string | null;
};

/** Credits one account has left, as its own plan reports them. */
export type WorkbuddySwitchCredit = {
  accountId: string;
  /** Credits still usable, or null when the balance could not be read. */
  remaining: number | null;
  /** Credits the current cycle granted in total, or null when unreadable. */
  total: number | null;
  /** Why no balance came back; null on success. */
  error: string | null;
};

/** Balances for every usable account, with the same availability contract as the status read. */
export type WorkbuddySwitchCredits = {
  /** False when the companion itself is unreachable, not when one account failed. */
  available: boolean;
  credits: WorkbuddySwitchCredit[];
};

/**
 * The only WorkBuddy variant CloudCLI can use.
 *
 * CloudCLI resolves the domestic app bundle and `workbuddy-desktop.info`; the
 * international (`ai`) build stores an encrypted token envelope that only the
 * Electron native layer can open, so an account switched to would not
 * authenticate a CloudCLI session. Rows for other variants are therefore
 * dropped rather than shown as working switches.
 */
const SUPPORTED_VARIANT = 'cn';

/** Reads a non-blank string field, or null when absent or of another type. */
function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Reads a finite number field, or null when absent or of another type. */
function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Narrows an unknown value to a plain object, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Maps one companion account record, dropping rows for unsupported variants. */
function toAccount(value: unknown): WorkbuddySwitchAccount | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const variant = asString(record.variant);
  if (variant !== null && variant !== SUPPORTED_VARIANT) {
    return null;
  }

  const id = asString(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    uid: asString(record.uid),
    nickname: asString(record.nickname),
    phoneNumber: asString(record.phoneNumber),
    email: asString(record.email),
    expiresAt: asNumber(record.expiresAt),
    needsRelogin: record.needsRelogin === true,
    isEnterprise: record.isEnterprise === true,
  };
}

/**
 * Reads the companion's current state.
 *
 * Never throws: any failure — service down, another service on the port, an
 * older version without `/api/accounts` — is reported as `available: false` so
 * the settings page keeps rendering.
 */
export async function getWorkbuddySwitchStatus(): Promise<WorkbuddySwitchStatus> {
  try {
    const [statusResponse, accountsResponse] = await Promise.all([
      requestWorkbuddySwitch(`/api/status?variant=${SUPPORTED_VARIANT}`),
      requestWorkbuddySwitch(`/api/accounts?variant=${SUPPORTED_VARIANT}`),
    ]);

    // Shape check, not a truthiness check: an unrelated service on the same
    // port can answer 200 with JSON too, and treating that as a live companion
    // would render an empty card that claims to be connected.
    const rawAccounts = accountsResponse.body.accounts;
    if (!Array.isArray(rawAccounts)) {
      return unavailableStatus();
    }

    return {
      available: true,
      version: asString(statusResponse.body.version),
      running: statusResponse.body.running === true,
      currentUid: asString(accountsResponse.body.current),
      accounts: rawAccounts
        .map(toAccount)
        .filter((account): account is WorkbuddySwitchAccount => account !== null),
    };
  } catch (error) {
    if (error instanceof WorkbuddySwitchUnavailableError) {
      return unavailableStatus();
    }
    throw error;
  }
}

/** The degraded answer used whenever the companion cannot be read. */
function unavailableStatus(): WorkbuddySwitchStatus {
  return { available: false, version: null, running: false, currentUid: null, accounts: [] };
}

/**
 * Signs WorkBuddy in as one of the stored accounts, restarting the desktop app
 * only when it is actually running.
 *
 * The restart is not cosmetic: WorkBuddy keeps its session in memory and
 * rewrites the auth file from it, so writing a new account under a live app
 * would be overwritten within seconds. When the app is not running there is
 * nothing to close, and asking the companion to restart would launch a desktop
 * app the user did not ask for.
 */
export async function switchWorkbuddyAccount(accountId: string): Promise<WorkbuddySwitchOutcome> {
  const status = await getWorkbuddySwitchStatus();
  if (!status.available) {
    throw new AppError(
      'workbuddy-switch is not running, so WorkBuddy accounts cannot be switched.',
      { code: 'WORKBUDDY_SWITCH_UNAVAILABLE', statusCode: 503 },
    );
  }

  const account = status.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    throw new AppError('Unknown WorkBuddy account for this companion.', {
      code: 'WORKBUDDY_SWITCH_UNKNOWN_ACCOUNT',
      statusCode: 400,
    });
  }

  // Switching to the account that is already signed in would quit and relaunch
  // WorkBuddy for no change, which is visible and disruptive; answer with the
  // current state instead.
  if (account.uid !== null && account.uid === status.currentUid) {
    return { account: account.nickname, restarted: false, status };
  }

  // Unlike the reads, this call cannot degrade to a calm default: the reader
  // asked for an action. It still must not escape as an anonymous 500, and a
  // lost answer is not a failed switch - the companion may have finished the
  // restart after its reply was cut off - so the outcome is reported as
  // unconfirmed rather than as a refusal.
  let response: { status: number; body: Record<string, unknown> };
  try {
    response = await requestWorkbuddySwitch('/api/switch', {
      method: 'POST',
      body: { accountId, restart: status.running },
      timeoutMs: WORKBUDDY_SWITCH_TIMEOUT_MS,
    });
  } catch (error) {
    if (!(error instanceof WorkbuddySwitchUnavailableError)) {
      throw error;
    }
    throw new AppError(
      'workbuddy-switch did not answer the switch request, so CloudCLI could not confirm it. Check which account is now in use.',
      { code: 'WORKBUDDY_SWITCH_UNAVAILABLE', statusCode: 503 },
    );
  }

  if (response.body.ok !== true) {
    const message = asString(response.body.error) ?? 'workbuddy-switch refused the switch.';
    throw new AppError(message, {
      code: response.status === 409
        ? 'WORKBUDDY_SWITCH_BUSY'
        : 'WORKBUDDY_SWITCH_FAILED',
      statusCode: response.status === 409 ? 409 : 400,
    });
  }

  return {
    account: asString(response.body.account),
    restarted: status.running,
    status: await getWorkbuddySwitchStatus(),
  };
}

/**
 * Reads the companion's live switch progress so the card can show what the
 * restart is doing. Never throws: a missing companion simply has nothing to
 * report.
 */
export async function getWorkbuddySwitchProgress(): Promise<WorkbuddySwitchProgress> {
  try {
    const { body } = await requestWorkbuddySwitch('/api/switch/progress');
    return { running: body.running === true, progress: asString(body.progress) };
  } catch (error) {
    if (error instanceof WorkbuddySwitchUnavailableError) {
      return { running: false, progress: null };
    }
    throw error;
  }
}

/**
 * How long one balance read is reused.
 *
 * Unlike the status read this one leaves the machine: the companion forwards it
 * to the billing gateway, so asking once per account on every settings mount
 * would turn flipping between tabs into a burst of live billing calls. Balances
 * move slowly enough that a minute-old answer is still useful.
 */
const CREDITS_CACHE_TTL_MS = 60_000;

/** Balances read at once; a long account list must not open one connection per row. */
const CREDITS_BATCH_SIZE = 4;

type CreditsCache = { baseUrl: string; readAt: number; value: WorkbuddySwitchCredits };

// Keyed by base URL so pointing the module at another companion (or a test
// double on a fresh port) never serves the previous instance's balances.
let creditsCache: CreditsCache | null = null;
let creditsInFlight: { baseUrl: string; promise: Promise<WorkbuddySwitchCredits> } | null = null;

/** Reads one account's balance, answering a per-account failure in the row instead of failing the list. */
async function readAccountCredit(account: WorkbuddySwitchAccount): Promise<WorkbuddySwitchCredit> {
  // An expired session cannot be read and the companion would only retry a
  // refresh that is known to fail, so the row is answered without a request.
  if (account.needsRelogin) {
    return {
      accountId: account.id,
      remaining: null,
      total: null,
      error: 'The stored session needs a new sign-in.',
    };
  }

  try {
    const { body } = await requestWorkbuddySwitch('/api/credits', {
      method: 'POST',
      body: { accountId: account.id },
      timeoutMs: WORKBUDDY_SWITCH_CREDITS_TIMEOUT_MS,
    });

    if (body.ok !== true) {
      return {
        accountId: account.id,
        remaining: null,
        total: null,
        error: asString(body.error) ?? 'The companion could not read this balance.',
      };
    }

    return {
      accountId: account.id,
      remaining: asNumber(body.totalRemaining),
      total: asNumber(body.totalCapacity),
      error: null,
    };
  } catch (error) {
    return {
      accountId: account.id,
      remaining: null,
      total: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Reads every usable account's balance in small batches. */
async function readAllCredits(baseUrl: string): Promise<WorkbuddySwitchCredits> {
  const status = await getWorkbuddySwitchStatus();
  if (!status.available) {
    return { available: false, credits: [] };
  }

  const credits: WorkbuddySwitchCredit[] = [];
  for (let index = 0; index < status.accounts.length; index += CREDITS_BATCH_SIZE) {
    const batch = status.accounts.slice(index, index + CREDITS_BATCH_SIZE);
    credits.push(...(await Promise.all(batch.map((account) => readAccountCredit(account)))));
  }

  const value: WorkbuddySwitchCredits = { available: true, credits };
  creditsCache = { baseUrl, readAt: Date.now(), value };
  return value;
}

/**
 * Credits left per account.
 *
 * Never throws: an absent companion is reported as `available: false`, and a
 * single account that cannot be read carries its own `error`, so the card can
 * still list the rows and their switch buttons.
 */
export async function getWorkbuddyAccountCredits(): Promise<WorkbuddySwitchCredits> {
  const baseUrl = resolveWorkbuddySwitchBaseUrl();

  const cached = creditsCache;
  if (cached && cached.baseUrl === baseUrl && Date.now() - cached.readAt < CREDITS_CACHE_TTL_MS) {
    return cached.value;
  }

  // A second mount (or a remount during a slow read) shares the run in flight
  // instead of issuing the same batch twice.
  if (creditsInFlight && creditsInFlight.baseUrl === baseUrl) {
    return creditsInFlight.promise;
  }

  const promise = readAllCredits(baseUrl).finally(() => {
    if (creditsInFlight?.promise === promise) {
      creditsInFlight = null;
    }
  });
  creditsInFlight = { baseUrl, promise };
  return promise;
}
