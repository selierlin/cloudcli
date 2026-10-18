import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/** Why the last web-push subscribe/unsubscribe attempt failed; rendered by NotificationsSettingsTab. */
export type WebPushError = 'timeout' | 'failed';

type WebPushState = {
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  error: WebPushError | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
};

// Chrome contacts its push service (FCM) inside pushManager.subscribe, and
// navigator.serviceWorker.ready never settles when no worker registers. When
// that connection is unreachable the promise stays pending forever with no
// error, leaving the settings button spinning — race these browser-internal
// steps with a timeout so the UI can fail fast with a visible message.
const BROWSER_STEP_TIMEOUT_MS = 20_000;

function withBrowserStepTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const error = new Error('Web push browser step timed out');
      error.name = 'TimeoutError';
      reject(error);
    }, BROWSER_STEP_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        window.clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPush(): WebPushState {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (
      typeof window === 'undefined'
      || Boolean((window as any).cloudcliDesktopNotifications)
      || !('Notification' in window)
      || !('serviceWorker' in navigator)
    ) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Carries why the last subscribe/unsubscribe failed so the settings tab can
  // show a visible reason instead of an endless spinner.
  const [error, setError] = useState<WebPushError | null>(null);

  // Check existing subscription on mount
  useEffect(() => {
    if (permission === 'unsupported') return;

    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(sub !== null);
      });
    }).catch(() => {
      // SW not ready yet
    });
  }, [permission]);

  const subscribe = useCallback(async () => {
    if (permission === 'unsupported') return;
    setIsLoading(true);
    setError(null);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const keyRes = await api.settings.push.vapidPublicKey();
      const { publicKey } = await keyRes.json();

      const registration = await withBrowserStepTimeout(navigator.serviceWorker.ready);
      const subscription = await withBrowserStepTimeout(registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      }));

      const subJson = subscription.toJSON();
      await api.settings.push.subscribe({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      });

      setIsSubscribed(true);
    } catch (err) {
      console.error('Push subscribe failed:', err);
      setError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'failed');
    } finally {
      setIsLoading(false);
    }
  }, [permission]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const registration = await withBrowserStepTimeout(navigator.serviceWorker.ready);
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await api.settings.push.unsubscribe(endpoint);
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error('Push unsubscribe failed:', err);
      setError(err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { permission, isSubscribed, isLoading, error, subscribe, unsubscribe };
}
