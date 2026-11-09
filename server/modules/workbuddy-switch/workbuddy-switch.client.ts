/**
 * HTTP transport for the optional local `workbuddy-switch` companion service.
 *
 * That service (npm `workbuddy-switch`, `wb-switch serve`) owns the WorkBuddy
 * account store, the auth-file writer and the desktop-app restart, so CloudCLI
 * only ever talks to it instead of touching that state itself: a second writer
 * on the same accounts file and auth file would corrupt both.
 *
 * The companion binds 127.0.0.1, has no authentication and sends no CORS
 * headers, which is why the browser never calls it directly — every request
 * goes through this module.
 */

/** Loopback port the companion listens on when started without `--port`. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:57890';

/** Bounds a status read so a hung companion cannot hold a settings request open. */
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Switching legitimately takes longer than any other call: the companion
 * gracefully quits WorkBuddy (up to 20s), restores pending session writes and
 * relaunches the app. The bound only exists so a wedged companion cannot pin a
 * request forever; the UI shows live progress while it waits.
 */
export const WORKBUDDY_SWITCH_TIMEOUT_MS = 90_000;

/**
 * Bounds a balance read. The companion answers those from the billing gateway
 * rather than local state, so it is the slowest read here (about half a second
 * per account when healthy) and it may retry once after refreshing a token.
 */
export const WORKBUDDY_SWITCH_CREDITS_TIMEOUT_MS = 20_000;

/**
 * Raised when the companion cannot be reached or does not answer JSON.
 *
 * Callers treat this as "the optional service is not running" and degrade
 * instead of surfacing an error, because workbuddy-switch is not a dependency
 * of CloudCLI — it is a companion the user may or may not have started.
 */
export class WorkbuddySwitchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbuddySwitchUnavailableError';
  }
}

/**
 * Base URL of the companion. `WORKBUDDY_SWITCH_URL` covers a non-default port
 * or a test double; the trailing slash is stripped so paths append verbatim.
 */
export function resolveWorkbuddySwitchBaseUrl(): string {
  const override = process.env.WORKBUDDY_SWITCH_URL?.trim();
  return (override || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * Calls one companion endpoint and returns its HTTP status with the decoded
 * JSON body.
 *
 * The content type is checked before parsing: the companion serves its SPA
 * with an `index.html` fallback, so an unknown path (an older version without
 * that route) answers 200 with HTML. Accepting that as success would turn a
 * version mismatch into a malformed payload reaching the UI.
 */
export async function requestWorkbuddySwitch(
  path: string,
  { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS }: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${resolveWorkbuddySwitchBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkbuddySwitchUnavailableError(
      `workbuddy-switch is unreachable at ${url} (${reason}).`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new WorkbuddySwitchUnavailableError(
      `workbuddy-switch at ${url} answered ${contentType || 'no content type'} instead of JSON.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorkbuddySwitchUnavailableError(
      `workbuddy-switch at ${url} returned malformed JSON (${reason}).`,
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new WorkbuddySwitchUnavailableError(
      `workbuddy-switch at ${url} returned a non-object payload.`,
    );
  }

  return { status: response.status, body: payload as Record<string, unknown> };
}
