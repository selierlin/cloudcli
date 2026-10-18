import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import BarkSettingsCard from '@/modules/settings/tabs/notifications-settings/BarkSettingsCard';

const notificationMocks = vi.hoisted(() => ({
  endpoints: vi.fn(),
  upsertEndpoint: vi.fn(),
  setEndpointEnabled: vi.fn(),
  removeEndpoint: vi.fn(),
  test: vi.fn(),
}));

vi.mock('@/shared/api', () => ({
  api: { notifications: notificationMocks },
}));

// The card only needs the default copy; initializing the whole i18n bundle per
// test would make this a locale test instead of a form test.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

const emptyEndpoints = () => new Response(JSON.stringify({ success: true, endpoints: [] }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('a full Bark push URL fills both server and device key, then saves and tests', async () => {
  notificationMocks.endpoints.mockImplementation(() => Promise.resolve(emptyEndpoints()));
  notificationMocks.upsertEndpoint.mockResolvedValue(new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  notificationMocks.test.mockResolvedValue(new Response(JSON.stringify({
    success: true,
    results: [{ endpointId: 'abc123', ok: true, message: 'success' }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  render(<BarkSettingsCard />);

  await screen.findByText('No Bark device configured yet.');

  fireEvent.change(screen.getByLabelText('Bark server URL'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Device key'), {
    target: { value: 'https://bark.example.com/abc123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

  await waitFor(() => {
    assert.equal(notificationMocks.upsertEndpoint.mock.calls.length, 1);
  });

  assert.deepEqual(notificationMocks.upsertEndpoint.mock.calls[0][0], {
    channel: 'bark',
    endpointId: 'abc123',
    label: '',
    metadata: {
      serverUrl: 'https://bark.example.com',
      group: '',
      subtitle: '',
      sound: '',
      level: 'active',
    },
  });

  await waitFor(() => {
    assert.equal(notificationMocks.test.mock.calls.length, 1);
  });
  assert.deepEqual(notificationMocks.test.mock.calls[0][0], {
    channel: 'bark',
    endpointId: 'abc123',
  });

  await screen.findByText('Bark accepted the test notification.');
});
