/**
 * Global network proxy configuration.
 *
 * One machine-level setting decides whether CloudCLI and every agent CLI it
 * spawns reach the network through an HTTP proxy. Because each provider runtime
 * starts its child process with `{ ...process.env }`, writing the decision onto
 * this process's environment once covers every harness — no runtime needs to
 * know the setting exists.
 *
 * A blank URL means "go direct". That is enforced by deleting the proxy
 * variables rather than by skipping the write, so a `HTTPS_PROXY` exported by
 * the shell that launched CloudCLI cannot silently win over the user's choice.
 */

import { appConfigDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/** Key holding the configured proxy URL in the global `app_config` KV. */
const PROXY_URL_KEY = 'network.proxyUrl';

/**
 * Hosts that must bypass the proxy. Written together with the proxy variables
 * so loopback traffic (local plugin servers, auth redirects) never detours
 * through the proxy while it is on.
 */
const NO_PROXY_HOSTS = 'localhost,127.0.0.1,::1';

/**
 * The proxy variables this service owns, in both cases. The harnesses disagree
 * on which form they read (Bun's native HTTP stack honors both, undici honors
 * both, some wrappers only look at the lowercase form), so all of them are
 * written and cleared together.
 */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

/**
 * Node only reads the proxy variables above when this flag is set. Bun-based
 * CLIs (claude, opencode) read them natively and ignore the flag, so setting it
 * is harmless there and required for the Node-based harnesses (DSH's ACP
 * server).
 */
const NODE_ENV_PROXY_FLAG = 'NODE_USE_ENV_PROXY';

/** The globally configured proxy; `proxyUrl: null` means sessions must go direct. */
export type NetworkProxyConfig = {
  proxyUrl: string | null;
};

/** Reads the stored proxy URL, treating blank as "not configured". */
function readProxyUrl(): string | null {
  const value = appConfigDb.get(PROXY_URL_KEY)?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Writes the stored decision onto this process's environment. Called by the
 * server entrypoint once the database is ready, and again by
 * `networkProxyService.updateConfig` after every save — which is what makes a
 * change take effect on the next spawned session without a server restart.
 * Every provider runtime picks the result up through `{ ...process.env }`.
 */
export function applyProxyToProcessEnv(): void {
  const proxyUrl = readProxyUrl();

  if (!proxyUrl) {
    // Deliberately delete inherited values too: a blank setting means "go
    // direct", not "keep whatever the launching shell happened to export".
    for (const key of PROXY_ENV_KEYS) {
      delete process.env[key];
    }
    delete process.env[NODE_ENV_PROXY_FLAG];
    return;
  }

  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.https_proxy = proxyUrl;
  process.env.NO_PROXY = NO_PROXY_HOSTS;
  process.env.no_proxy = NO_PROXY_HOSTS;
  process.env[NODE_ENV_PROXY_FLAG] = '1';
}

/** Used by the network routes and their settings UI to read and update the global proxy. */
export const networkProxyService = {
  /** Current setting as the settings screen should render it. */
  getConfig(): NetworkProxyConfig {
    return { proxyUrl: readProxyUrl() };
  },

  /**
   * Persists the proxy URL and applies it to the running process immediately.
   * `undefined` keeps the stored value; an empty string means "go direct".
   */
  updateConfig(input: { proxyUrl?: string }): NetworkProxyConfig {
    if (input.proxyUrl !== undefined) {
      const proxyUrl = input.proxyUrl.trim();
      // Reject anything that is not an HTTP(S) proxy up front: a typo here
      // would only surface later as an unexplained failure inside a harness.
      if (proxyUrl.length > 0 && !/^https?:\/\//i.test(proxyUrl)) {
        throw new AppError('Proxy URL must start with http:// or https://.', {
          code: 'NETWORK_PROXY_URL_INVALID',
          statusCode: 400,
        });
      }
      appConfigDb.set(PROXY_URL_KEY, proxyUrl);
    }

    applyProxyToProcessEnv();
    return { proxyUrl: readProxyUrl() };
  },
};
