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

export type BarkPushPayload = {
  title: string;
  body: string;
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
  const body = {
    device_key: endpoint.endpoint_id,
    title: payload.title,
    body: payload.body,
    group,
    subtitle: readText(metadata.subtitle) || undefined,
    sound: readText(metadata.sound) || undefined,
    level: readText(metadata.level) || undefined,
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
  const endpoints = requested
    ? [notificationChannelEndpointsDb.getEndpoint(userId, BARK_CHANNEL, requested)]
      .filter((endpoint): endpoint is BarkEndpointRow => endpoint !== null)
    : notificationChannelEndpointsDb.getEnabledEndpoints(userId, BARK_CHANNEL);

  return Promise.all(endpoints.map((endpoint) => deliver(endpoint, {
    title: BARK_TEST_TITLE,
    body: BARK_TEST_BODY,
  })));
}
