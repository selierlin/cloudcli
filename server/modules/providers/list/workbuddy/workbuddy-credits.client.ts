import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ProviderQuota } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Console endpoint that aggregates the account's credit capacity: it answers
 * the total, remaining and used credits summed per package, plus the paid/most
 * recent package code. It takes no business parameters and reading it consumes
 * no credits, which is why the settings panel can call it on every visit.
 */
const CREDIT_SUMMARY_PATH = '/billing/meter/get-user-resource-summary';

/**
 * Console hosts the desktop auth file can legitimately point at.
 *
 * The stored token is signed for one console domain, and the billing gateway
 * rejects a request whose host disagrees with it, so the host is chosen from
 * this fixed pair. Account data never reaches the request as a raw hostname.
 */
const WORKBUDDY_CONSOLE_HOST = 'https://www.workbuddy.cn';
const CODEBUDDY_CONSOLE_HOST = 'https://www.codebuddy.cn';

/**
 * User-Agent sent with credit reads.
 *
 * The billing gateway answers a bare `code: 10085 请求不合法` to requests
 * carrying a script-style User-Agent, and that code is a client-fingerprint
 * rejection rather than an expired session, so no amount of token refreshing
 * would recover it. A desktop browser User-Agent is the only header that
 * changed the outcome in testing, so it is sent verbatim.
 */
const CREDIT_READ_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** Bounds the read so a hung console cannot hold the settings request open. */
const CREDIT_READ_TIMEOUT_MS = 10_000;

/**
 * The subset of the WorkBuddy desktop auth file a credit read needs.
 *
 * `expiresAt` is kept only so a stale session is reported as such instead of
 * being sent to the gateway as an anonymous request.
 */
type WorkbuddyDesktopAuth = {
  accessToken: string;
  domain: string | null;
  expiresAt: number | null;
};

/** One credit package as the summary endpoint reports it; capacities arrive as decimal strings. */
type WorkbuddyCreditPackage = {
  CycleTotalCapacity?: unknown;
  CycleRemainCapacity?: unknown;
  CapacityUnit?: unknown;
};

/**
 * Path of the auth file the WorkBuddy desktop app and its IDE extension share.
 *
 * The desktop app is the owner of this file and refreshes it on its own; this
 * reader only ever reads it. `WORKBUDDY_DESKTOP_AUTH_FILE` overrides the
 * location for tests and non-standard installs, mirroring the other WorkBuddy
 * path overrides in `workbuddy-storage.provider.ts`.
 */
function resolveWorkbuddyDesktopAuthFile(): string {
  const override = process.env.WORKBUDDY_DESKTOP_AUTH_FILE?.trim();
  if (override) {
    return override;
  }

  const relativePath = path.join('CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop.info');
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, relativePath);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', relativePath);
  }
  return path.join(os.homedir(), '.local', 'share', relativePath);
}

/** Reads and shapes the desktop auth file, or null when it is absent or unrecognizable. */
async function readWorkbuddyDesktopAuth(): Promise<WorkbuddyDesktopAuth | null> {
  let raw: string;
  try {
    raw = await fs.readFile(resolveWorkbuddyDesktopAuthFile(), 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const auth = (parsed as { auth?: unknown } | null)?.auth;
  if (typeof auth !== 'object' || auth === null) {
    return null;
  }

  const record = auth as Record<string, unknown>;
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : '';
  if (!accessToken) {
    return null;
  }

  const domain = typeof record.domain === 'string' && record.domain.trim() ? record.domain.trim() : null;
  const expiresAt = typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)
    ? record.expiresAt
    : null;

  return { accessToken, domain, expiresAt };
}

/** Picks the console host paired with the stored token; unknown domains fall back to the codebuddy console. */
function resolveConsoleHost(domain: string | null): string {
  const normalized = domain?.toLowerCase();
  return normalized === 'workbuddy.cn' || normalized === 'www.workbuddy.cn'
    ? WORKBUDDY_CONSOLE_HOST
    : CODEBUDDY_CONSOLE_HOST;
}

/** Narrows an unknown payload field to a finite number, accepting the decimal strings the summary endpoint uses. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The credit figures one summary payload reports, before they are formatted for display. */
type WorkbuddyCreditTotals = {
  remaining: number;
  used: number | null;
  total: number | null;
  isPaidAccount: boolean | null;
};

/**
 * Sums the credit capacities the summary endpoint reports.
 *
 * Returns null when the payload is not a successful summary or carries no
 * package list, which callers treat as "no balance to show" rather than zero:
 * an account that never had credits must not read as an exhausted one.
 *
 * Capacities are paired per package: a package counts toward the cycle total
 * only when it reports both ends, because a total summed over a different set
 * of packages than the balance would not reconcile with it. That keeps the
 * used figure this derives equal to total minus remaining, so the panel can
 * never show a breakdown that disagrees with its own balance.
 */
function summarizeCreditPackages(payload: unknown): WorkbuddyCreditTotals | null {
  const body = payload as { code?: unknown; data?: unknown } | null;
  if (toFiniteNumber(body?.code) !== 0) {
    return null;
  }

  const data = body?.data as { Packages?: unknown; IsPaidUser?: unknown } | null;
  const packages = data?.Packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    return null;
  }

  let remaining = 0;
  let total = 0;
  let reported = 0;
  let everyTotalReported = true;
  for (const item of packages as WorkbuddyCreditPackage[]) {
    const remain = toFiniteNumber(item?.CycleRemainCapacity);
    if (remain === null) {
      continue;
    }

    remaining += remain;
    reported += 1;

    const capacity = toFiniteNumber(item?.CycleTotalCapacity);
    if (capacity === null) {
      everyTotalReported = false;
      continue;
    }
    total += capacity;
  }

  if (reported === 0) {
    return null;
  }

  return {
    remaining,
    used: everyTotalReported ? total - remaining : null,
    total: everyTotalReported ? total : null,
    isPaidAccount: typeof data?.IsPaidUser === 'boolean' ? data.IsPaidUser : null,
  };
}

/**
 * Reads the signed-in WorkBuddy account's credit balance for the settings panel.
 *
 * Used by `providerQuotaService` as the `workbuddy` quota reader. The read is
 * deliberately read-only: when the desktop app's session has expired this
 * reports a failure instead of refreshing, because the desktop app owns the
 * auth file and a refresh here would rotate its refresh token behind its back
 * and could invalidate the user's WorkBuddy sign-in.
 */
export async function readWorkbuddyCredits(): Promise<ProviderQuota> {
  const auth = await readWorkbuddyDesktopAuth();
  if (!auth) {
    throw new AppError('WorkBuddy desktop auth file is missing or unreadable.', {
      code: 'WORKBUDDY_AUTH_FILE_UNAVAILABLE',
      statusCode: 404,
    });
  }

  // Reported rather than refreshed: see the contract above.
  if (auth.expiresAt !== null && auth.expiresAt <= Date.now()) {
    throw new AppError('WorkBuddy desktop session has expired; open WorkBuddy to refresh it.', {
      code: 'WORKBUDDY_SESSION_EXPIRED',
      statusCode: 401,
    });
  }

  const response = await fetch(`${resolveConsoleHost(auth.domain)}${CREDIT_SUMMARY_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': CREDIT_READ_USER_AGENT,
    },
    body: '{}',
    signal: AbortSignal.timeout(CREDIT_READ_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AppError(`WorkBuddy credit summary answered HTTP ${response.status}.`, {
      code: 'WORKBUDDY_CREDIT_SUMMARY_FAILED',
      statusCode: response.status,
    });
  }

  const totals = summarizeCreditPackages(await response.json());
  if (totals === null) {
    throw new AppError('WorkBuddy credit summary carried no package balances.', {
      code: 'WORKBUDDY_CREDIT_SUMMARY_EMPTY',
      statusCode: 502,
    });
  }

  return {
    provider: 'workbuddy',
    // WorkBuddy bills against prepaid credits and reports no rolling rate-limit
    // window, so the balance below is the whole snapshot.
    windows: [],
    planType: null,
    credits: totals.remaining.toFixed(2),
    creditsUsed: totals.used === null ? null : totals.used.toFixed(2),
    creditsTotal: totals.total === null ? null : totals.total.toFixed(2),
    isPaidAccount: totals.isPaidAccount,
    fetchedAt: Date.now(),
  };
}
