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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const emptyEndpoints = () => jsonResponse({ success: true, endpoints: [] });

const savedEndpoint = () => jsonResponse({
  success: true,
  endpoints: [{
    id: 1,
    channel: 'bark',
    endpointId: 'abc123',
    label: '',
    metadata: {
      serverUrl: 'https://bark.example.com',
      group: '',
      subtitle: '',
      sound: '',
      level: 'active',
      publicBaseUrl: '',
    },
    enabled: true,
  }],
});

test('a full Bark push URL fills both server and device key, and saving does not send a push', async () => {
  notificationMocks.endpoints.mockImplementation(() => Promise.resolve(emptyEndpoints()));
  notificationMocks.upsertEndpoint.mockResolvedValue(jsonResponse({ success: true }));

  render(<BarkSettingsCard />);

  await screen.findByText('No Bark device configured yet.');

  fireEvent.change(screen.getByLabelText('Bark server URL'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Device key'), {
    target: { value: 'https://bark.example.com/abc123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

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
      publicBaseUrl: '',
    },
  });

  // Adding a device is a single action: the only test entry is the row button,
  // so saving must not push anything the user did not ask for.
  assert.equal(notificationMocks.test.mock.calls.length, 0);
});

test('pasting an already saved device key loads its settings so a re-save keeps them', async () => {
  notificationMocks.endpoints.mockImplementation(() => Promise.resolve(jsonResponse({
    success: true,
    endpoints: [{
      id: 1,
      channel: 'bark',
      endpointId: 'abc123',
      label: 'iPhone',
      metadata: {
        serverUrl: 'https://bark.example.com',
        group: 'CloudCLI · A',
        subtitle: '',
        sound: 'minuet',
        level: 'passive',
        publicBaseUrl: 'http://192.168.1.5:3001',
      },
      enabled: false,
    }],
  })));
  notificationMocks.upsertEndpoint.mockResolvedValue(jsonResponse({ success: true }));

  render(<BarkSettingsCard />);

  await screen.findByText('https://bark.example.com · ••••');

  fireEvent.change(screen.getByLabelText('Device key'), { target: { value: 'abc123' } });

  assert.equal(
    (screen.getByLabelText('Device name (optional)') as HTMLInputElement).value,
    'iPhone',
  );
  assert.equal(
    (screen.getByLabelText('Notification group (optional)') as HTMLInputElement).value,
    'CloudCLI · A',
  );
  assert.equal(
    (screen.getByLabelText('Sound (optional)') as HTMLInputElement).value,
    'minuet',
  );
  assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value, 'passive');
  assert.equal(
    (screen.getByPlaceholderText('http://192.168.1.5:3001') as HTMLInputElement).value,
    'http://192.168.1.5:3001',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

  await waitFor(() => {
    assert.equal(notificationMocks.upsertEndpoint.mock.calls.length, 1);
  });

  assert.deepEqual(notificationMocks.upsertEndpoint.mock.calls[0][0], {
    channel: 'bark',
    endpointId: 'abc123',
    label: 'iPhone',
    metadata: {
      serverUrl: 'https://bark.example.com',
      group: 'CloudCLI · A',
      subtitle: '',
      sound: 'minuet',
      level: 'passive',
      publicBaseUrl: 'http://192.168.1.5:3001',
    },
  });
});

test('the row test button sends a push to that endpoint and shows the result', async () => {
  notificationMocks.endpoints.mockImplementation(() => Promise.resolve(savedEndpoint()));
  notificationMocks.test.mockResolvedValue(jsonResponse({
    success: true,
    results: [{ endpointId: 'abc123', ok: true, message: 'success' }],
  }));

  render(<BarkSettingsCard />);

  await screen.findByText('https://bark.example.com · ••••');

  fireEvent.click(screen.getByRole('button', { name: 'Test' }));

  await waitFor(() => {
    assert.equal(notificationMocks.test.mock.calls.length, 1);
  });
  assert.deepEqual(notificationMocks.test.mock.calls[0][0], {
    channel: 'bark',
    endpointId: 'abc123',
  });

  await screen.findByText('Bark accepted the test notification.');
});
