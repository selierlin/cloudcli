import assert from 'node:assert/strict';

import { afterEach, test, vi } from 'vitest';

import { triggerNotificationHaptic } from '@/shared/utils';

type NotificationHapticStub = (options: { type: string }) => Promise<void>;

type CapacitorStub = {
  isNativePlatform: () => boolean;
  registerPlugin: (name: string) => unknown;
};

const windowWithOptionalCapacitor = window as unknown as { Capacitor?: CapacitorStub };

/** Installs a fake Capacitor global whose `registerPlugin` exposes the native haptics stub. */
const installCapacitor = (isNativePlatform: boolean, notification: NotificationHapticStub) => {
  const registerPlugin = vi.fn(() => ({ notification }));
  windowWithOptionalCapacitor.Capacitor = { isNativePlatform: () => isNativePlatform, registerPlugin };
  return registerPlugin;
};

afterEach(() => {
  delete windowWithOptionalCapacitor.Capacitor;
  localStorage.clear();
});

test('does not reach for the native plugin outside the Capacitor shell', async () => {
  const registerPlugin = installCapacitor(false, vi.fn(async () => {}));

  await triggerNotificationHaptic();

  assert.equal(registerPlugin.mock.calls.length, 0);
});

test('plays the success haptic by default inside the native shell', async () => {
  const notification = vi.fn<NotificationHapticStub>(async () => {});
  installCapacitor(true, notification);

  await triggerNotificationHaptic();

  assert.deepEqual(notification.mock.calls, [[{ type: 'success' }]]);
});

test('plays the warning haptic for a request that needs attention', async () => {
  const notification = vi.fn<NotificationHapticStub>(async () => {});
  installCapacitor(true, notification);

  await triggerNotificationHaptic({ type: 'warning' });

  assert.deepEqual(notification.mock.calls, [[{ type: 'warning' }]]);
});

test('honours the stored preference and lets a preview force the haptic', async () => {
  const notification = vi.fn<NotificationHapticStub>(async () => {});
  installCapacitor(true, notification);
  localStorage.setItem('notificationVibrationEnabled', 'false');

  await triggerNotificationHaptic();
  assert.equal(notification.mock.calls.length, 0);

  await triggerNotificationHaptic({ force: true });
  assert.equal(notification.mock.calls.length, 1);
});

test('swallows a rejected haptic so the completion flow keeps running', async () => {
  const notification = vi.fn<NotificationHapticStub>(async () => {
    throw new Error('Taptic Engine unavailable');
  });
  installCapacitor(true, notification);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  await triggerNotificationHaptic();

  assert.equal(warn.mock.calls.length, 1);
});
