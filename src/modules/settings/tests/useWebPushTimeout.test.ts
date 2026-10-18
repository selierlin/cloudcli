import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useWebPush } from '@/modules/settings/hooks/useWebPush';

const apiMocks = vi.hoisted(() => ({
  vapidPublicKey: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

/**
 * The bug: pushManager.subscribe (and navigator.serviceWorker.ready) can stay
 * pending forever — Chrome waits on its push service (FCM) inside subscribe,
 * and when that connection is unreachable there is no error at all. The
 * settings button then spun indefinitely. These tests drive the hook through
 * the hang and assert it fails fast with a visible `timeout` error instead.
 */

vi.mock('@/shared/api', () => ({
  api: {
    settings: {
      push: {
        vapidPublicKey: apiMocks.vapidPublicKey,
        subscribe: apiMocks.subscribe,
        unsubscribe: apiMocks.unsubscribe,
      },
    },
  },
}));

const TEST_VAPID_KEY = 'BPk2pSG8p5GhVY9_example_public_key_value_-xxxxx';

/**
 * Installs the browser APIs the hook needs (Notification, serviceWorker) and
 * returns a resolver for `serviceWorker.ready`. Tests can leave it pending
 * (the hang) or settle it (the success path); it never rejects, so a test that
 * ends while it is pending cannot raise an unhandled rejection.
 */
const installBrowserApis = () => {
  let resolveReady!: (registration: ServiceWorkerRegistration) => void;
  const readyPromise = new Promise<ServiceWorkerRegistration>((resolve) => {
    resolveReady = resolve;
  });
  // The hook reads pushManager off the registration `ready` settles with, so
  // the registration carries the mocks. getSubscription mirrors a real
  // browser: null until a subscription is created, then the subscription —
  // the hook's [permission]-keyed effect re-runs after grant and would
  // otherwise clobber isSubscribed back to false.
  let currentSubscription: { toJSON: () => unknown } | null = null;
  const registration = {
    pushManager: {
      subscribe: vi.fn(async () => {
        currentSubscription = {
          toJSON: () => ({ endpoint: 'https://push.example/endpoint', keys: { p256dh: 'k', auth: 'a' } }),
        };
        return currentSubscription;
      }),
      getSubscription: vi.fn(async () => currentSubscription),
    },
  } as unknown as ServiceWorkerRegistration;

  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: {
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted'),
    },
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: readyPromise,
    },
  });

  return { resolveReady, registration };
};

beforeEach(() => {
  vi.useFakeTimers();
  apiMocks.vapidPublicKey.mockResolvedValue(new Response(JSON.stringify({ publicKey: TEST_VAPID_KEY }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  apiMocks.subscribe.mockResolvedValue(new Response('{}', { status: 200 }));
  apiMocks.unsubscribe.mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('subscribe fails fast with a timeout error when serviceWorker.ready never settles', async () => {
  installBrowserApis();
  const { result } = renderHook(() => useWebPush());

  // The hook catches internally, so subscribe() never rejects and need not be
  // awaited; act flushes the state updates its rejection produces.
  await act(async () => {
    void result.current.subscribe();
    await vi.advanceTimersByTimeAsync(20_000);
  });

  assert.equal(result.current.isLoading, false);
  assert.equal(result.current.error, 'timeout');
  assert.equal(result.current.isSubscribed, false);
});

test('subscribe fails fast with a timeout error when pushManager.subscribe never settles', async () => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          subscribe: () => new Promise(() => {}),
          getSubscription: vi.fn(async () => null),
        },
      } as unknown as ServiceWorkerRegistration),
    },
  });
  const { result } = renderHook(() => useWebPush());

  await act(async () => {
    void result.current.subscribe();
    await vi.advanceTimersByTimeAsync(20_000);
  });

  assert.equal(result.current.error, 'timeout');
  assert.equal(result.current.isSubscribed, false);
});

test('subscribe succeeds through the normal path without setting an error', async () => {
  // Fake timers are unnecessary here and they make the effect/settle ordering
  // below fragile; real timers let the mount effect drain before subscribing.
  vi.useRealTimers();
  const { resolveReady, registration } = installBrowserApis();
  const { result } = renderHook(() => useWebPush());

  // Settle `ready` and let the mount effect's subscription check finish before
  // subscribing: in the real app that check has long completed by the time the
  // user clicks, and squeezing both into one flush would let the effect's
  // `setIsSubscribed(false)` land after subscribe's `true`.
  await act(async () => {
    resolveReady(registration);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  await act(async () => {
    await result.current.subscribe();
  });

  assert.equal(result.current.error, null);
  assert.equal(result.current.isSubscribed, true);
  assert.equal(result.current.isLoading, false);
  assert.equal(apiMocks.subscribe.mock.calls.length, 1);
});
