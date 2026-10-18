import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/** The server-side metadata Bark needs for one endpoint; every field is optional on the wire. */
export type BarkEndpointMetadata = {
  serverUrl: string;
  group: string;
  subtitle: string;
  sound: string;
  level: string;
  /** Address the phone uses to reach CloudCLI; icons and tap-through links are built from it. */
  publicBaseUrl: string;
};

/** One saved Bark device, as returned by the generic notification endpoint API. */
export type BarkEndpoint = {
  id: number;
  endpointId: string;
  label: string;
  enabled: boolean;
  metadata: BarkEndpointMetadata;
};

/** Bark's own reply to a test push; `message` is surfaced verbatim so a bad key is actionable. */
export type BarkDeliveryResult = {
  endpointId: string;
  ok: boolean;
  message: string;
};

/** The form fields the settings card submits; empty strings mean "leave unset". */
export type BarkEndpointInput = {
  endpointId: string;
  label: string;
  serverUrl: string;
  group: string;
  subtitle: string;
  sound: string;
  level: string;
  publicBaseUrl: string;
};

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toBarkEndpoint(raw: unknown): BarkEndpoint | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const endpointId = readString(value.endpointId);
  if (!endpointId) {
    return null;
  }

  const metadata = value.metadata && typeof value.metadata === 'object'
    ? value.metadata as Record<string, unknown>
    : {};

  return {
    id: typeof value.id === 'number' ? value.id : 0,
    endpointId,
    label: readString(value.label),
    enabled: value.enabled === true,
    metadata: {
      serverUrl: readString(metadata.serverUrl),
      group: readString(metadata.group),
      subtitle: readString(metadata.subtitle),
      sound: readString(metadata.sound),
      level: readString(metadata.level),
      // `iconBaseUrl` is the pre-rename key; keep reading it so a row saved
      // before the rename still resolves its icons and links.
      publicBaseUrl: readString(metadata.publicBaseUrl) || readString(metadata.iconBaseUrl),
    },
  };
}

function toDeliveryResult(raw: unknown): BarkDeliveryResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;
  return {
    endpointId: readString(value.endpointId),
    ok: value.ok === true,
    message: readString(value.message),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

/**
 * Used by the Settings notifications tab to manage this server's Bark
 * endpoints. The endpoint rows are the source of truth for whether Bark is
 * active, so this hook never touches the separate channels.bark preference.
 */
export function useBarkNotifications() {
  // Endpoint rows are server state: the settings card renders them and uses
  // their presence to decide whether to show the empty state.
  const [endpoints, setEndpoints] = useState<BarkEndpoint[]>([]);
  // A request is in flight; disables the card's buttons so a double click
  // cannot create two rows for the same device key.
  const [busy, setBusy] = useState(false);
  // Transport or validation failure from loading/saving/deleting, shown under
  // the form. Bark's own rejection is kept separately so it is not mixed up
  // with "the request never reached the server".
  const [error, setError] = useState<string | null>(null);
  // The last test push's outcome, rendered next to the form until the next test.
  const [testResult, setTestResult] = useState<BarkDeliveryResult | null>(null);

  const reload = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.notifications.endpoints('bark');
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(readString(data.error) || `HTTP ${response.status}`);
      }
      const rows = Array.isArray(data.endpoints) ? data.endpoints : [];
      setEndpoints(rows.map(toBarkEndpoint).filter((row): row is BarkEndpoint => row !== null));
      return true;
    } catch (loadError) {
      setError(errorMessage(loadError));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (input: BarkEndpointInput): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await api.notifications.upsertEndpoint({
        channel: 'bark',
        endpointId: input.endpointId,
        label: input.label,
        metadata: {
          serverUrl: input.serverUrl,
          group: input.group,
          subtitle: input.subtitle,
          sound: input.sound,
          level: input.level,
          publicBaseUrl: input.publicBaseUrl,
        },
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(readString(data.error) || `HTTP ${response.status}`);
      }
      return await reload();
    } catch (saveError) {
      setError(errorMessage(saveError));
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const remove = useCallback(async (endpointId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await api.notifications.removeEndpoint('bark', endpointId);
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(readString(data.error) || `HTTP ${response.status}`);
      }
      await reload();
    } catch (removeError) {
      setError(errorMessage(removeError));
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const setEnabled = useCallback(async (endpointId: string, enabled: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.notifications.setEndpointEnabled('bark', endpointId, enabled);
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(readString(data.error) || `HTTP ${response.status}`);
      }
      await reload();
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const test = useCallback(async (endpointId?: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await api.notifications.test({ channel: 'bark', endpointId });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(readString(data.error) || `HTTP ${response.status}`);
      }
      const results = Array.isArray(data.results) ? data.results : [];
      setTestResult(toDeliveryResult(results[0]));
    } catch (testError) {
      setError(errorMessage(testError));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    endpoints,
    busy,
    error,
    testResult,
    reload,
    save,
    remove,
    setEnabled,
    test,
  };
}
