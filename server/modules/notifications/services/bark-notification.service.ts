import os from 'node:os';

import { notificationChannelEndpointsDb } from '@/modules/database/index.js';

/**
 * Bark is a self-hosted iOS push relay. This channel exists because the mobile
 * client is a developer-signed WKWebView shell without an APNs entitlement: it
 * cannot receive Web Push, and iOS suspends its WebSocket as soon as the app is
 * backgrounded. Delivery goes through the user's own Bark server, whose `POST
 * /push` API accepts one device key per request.
 */

const BARK_CHANNEL = 'bark';
const BARK_TIMEOUT_MS = 5000;
const BARK_TEST_TITLE = 'CloudCLI';
const BARK_TEST_BODY = 'Bark 测试通知';

/**
 * The payload behind the Settings test button. The icon is part of the test: a
 * mark showing up (or not) is the only way to confirm the phone can actually
 * fetch it.
 */
const BARK_TEST_PAYLOAD: BarkPushPayload = {
  title: BARK_TEST_TITLE,
  body: BARK_TEST_BODY,
  iconKind: 'complete',
};

/**
 * The three status marks Bark can show instead of its own app icon. They mirror
 * the favicon's completion/failure/approval states so a glance at the lock screen
 * reads the same as a glance at the tab.
 */
export type BarkIconKind = 'complete' | 'failed' | 'approval';

export type BarkPushPayload = {
  title: string;
  body: string;
  /** Omitted for events with no meaningful mark (e.g. an aborted run). */
  iconKind?: BarkIconKind;
  /** The app session the notification is about; drives the tap-through link. */
  sessionId?: string | null;
};

export type BarkDeliveryResult = {
  endpointId: string;
  ok: boolean;
  message: string;
};

type BarkEndpointRow = NonNullable<ReturnType<typeof notificationChannelEndpointsDb.getEndpoint>>;

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Accepts `http(s)://host[:port][/prefix]` and drops a trailing slash so
 * `/push` can be appended without producing a double slash. Credentials in the
 * URL are rejected: the Bark device key is the only secret this channel needs,
 * and a URL embedded password would end up in logs and error messages.
 */
function normalizeBaseUrl(value: unknown): string | null {
  const raw = readText(value);
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

/**
 * The address the phone uses to reach CloudCLI. It cannot be derived from the
 * request that created the endpoint (the phone may use a LAN address, a domain,
 * or a reverse-proxy prefix), so it is configured per endpoint. `iconBaseUrl` is
 * the pre-rename key and is still read so an existing row keeps working.
 *
 * A loopback base can never work from a phone, so it is dropped rather than left
 * to time out on the device.
 */
function resolvePublicBaseUrl(metadata: Record<string, unknown>): string | null {
  const raw = readText(metadata.publicBaseUrl) || readText(metadata.iconBaseUrl);
  const baseUrl = normalizeBaseUrl(raw);
  if (!baseUrl) {
    return null;
  }

  const host = new URL(baseUrl).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return null;
  }

  return baseUrl;
}

/**
 * The filename is the device's cache key: replacing the artwork behind an
 * existing name never reaches devices that already cached it. Give a new
 * drawing a new filename instead.
 */
function resolveIconUrl(publicBaseUrl: string | null, kind: BarkIconKind | undefined): string | null {
  if (!publicBaseUrl || !kind) {
    return null;
  }
  return `${publicBaseUrl}/icons/bark/${kind}.png`;
}

/**
 * Bark opens `url` with `UIApplication` on tap, so only a custom scheme lands in
 * the app instead of Safari. The web URL travels as a parameter because the
 * shell knows how to load a URL but not how to rebuild one from a session id
 * (that depends on the deployment's path prefix).
 */
function resolveTapUrl(publicBaseUrl: string | null, sessionId: string): string | null {
  if (!publicBaseUrl || !sessionId) {
    return null;
  }

  const webUrl = `${publicBaseUrl}/session/${encodeURIComponent(sessionId)}`;
  return `cloudcli://open?url=${encodeURIComponent(webUrl)}`;
}

/** Sends one payload to one endpoint and normalizes Bark's own response shape. */
async function deliver(
  endpoint: BarkEndpointRow,
  payload: BarkPushPayload,
): Promise<BarkDeliveryResult> {
  const metadata = notificationChannelEndpointsDb.parseMetadata(endpoint.metadata_json);
  const baseUrl = normalizeBaseUrl(metadata.serverUrl);
  if (!baseUrl) {
    return {
      endpointId: endpoint.endpoint_id,
      ok: false,
      message: 'Bark server URL is missing',
    };
  }

  // Bark groups notifications in Notification Center and lets the user mute a
  // group, so the group doubles as the per-server identity when several
  // CloudCLI instances push to the same phone.
  const group = readText(metadata.group) || `CloudCLI · ${os.hostname()}`;
  const publicBaseUrl = resolvePublicBaseUrl(metadata);
  const icon = resolveIconUrl(publicBaseUrl, payload.iconKind);
  const tapUrl = resolveTapUrl(publicBaseUrl, readText(payload.sessionId));
  const body = {
    device_key: endpoint.endpoint_id,
    title: payload.title,
    body: payload.body,
    group,
    subtitle: readText(metadata.subtitle) || undefined,
    sound: readText(metadata.sound) || undefined,
    level: readText(metadata.level) || undefined,
    icon: icon || undefined,
    url: tapUrl || undefined,
  };

  try {
    const response = await fetch(`${baseUrl}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BARK_TIMEOUT_MS),
    });

    // Bark answers HTTP 200 with its own code in the body, so the HTTP status
    // alone is not enough to call this a success.
    const text = await response.text();
    let parsed: { code?: unknown; message?: unknown } | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const code = typeof parsed?.code === 'number' ? parsed.code : null;
    const message = typeof parsed?.message === 'string' && parsed.message
      ? parsed.message
      : `HTTP ${response.status}`;

    return {
      endpointId: endpoint.endpoint_id,
      ok: response.ok && code === 200,
      message,
    };
  } catch (error) {
    return {
      endpointId: endpoint.endpoint_id,
      ok: false,
      message: errorMessage(error),
    };
  }
}

/**
 * Used by the notification orchestrator's Bark channel. A configured but
 * disabled endpoint is skipped; failures are logged by row id (never by device
 * key) and never thrown, because notification delivery must not affect a run's
 * terminal event.
 */
export async function sendBarkNotification(
  userId: number,
  payload: BarkPushPayload,
): Promise<void> {
  const endpoints = notificationChannelEndpointsDb.getEnabledEndpoints(userId, BARK_CHANNEL);
  if (endpoints.length === 0) {
    return;
  }

  const results = await Promise.all(endpoints.map((endpoint) => deliver(endpoint, payload)));
  results.forEach((result, index) => {
    if (!result.ok) {
      console.error(`[bark] endpoint row ${endpoints[index].id} failed: ${result.message}`);
    }
  });
}

/**
 * Used by the Settings test button. It deliberately bypasses event preferences
 * and the in-memory dedupe window so a user can verify connectivity right after
 * saving, and returns Bark's own message instead of swallowing it.
 */
export async function sendBarkTestNotification(
  userId: number,
  endpointId?: string,
): Promise<BarkDeliveryResult[]> {
  const requested = readText(endpointId);
  if (!requested) {
    const endpoints = notificationChannelEndpointsDb.getEnabledEndpoints(userId, BARK_CHANNEL);
    return Promise.all(endpoints.map((endpoint) => deliver(endpoint, BARK_TEST_PAYLOAD)));
  }

  const endpoint = notificationChannelEndpointsDb.getEndpoint(userId, BARK_CHANNEL, requested);
  if (!endpoint) {
    // An empty result would reach Settings as "nothing happened" (the card has no
    // other feedback path), so report the missing row like any other failure.
    return [{
      endpointId: requested,
      ok: false,
      message: 'Bark endpoint not found',
    }];
  }

  // Disabled endpoints are tested on purpose: the button verifies connectivity,
  // which is useful before switching the device back on.
  return [await deliver(endpoint, BARK_TEST_PAYLOAD)];
}
