import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test, vi } from 'vitest';

import type { AgentProvider, ProviderAuthStatus } from '@/shared/types';

/**
 * The account card picks its sentence from whether the provider reported an
 * account: an email means a sign-in, a null email means the credential came
 * from local configuration and must not be dressed up as a user. The fake `t`
 * echoes keys and interpolation values, which keeps these assertions
 * independent of the locale files.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'en' },
  }),
}));

const buildStatus = (overrides: Partial<ProviderAuthStatus>): ProviderAuthStatus => ({
  installed: true,
  provider: 'opencode',
  authenticated: true,
  email: null,
  method: null,
  error: null,
  loading: false,
  ...overrides,
});

async function renderAccount(
  status: ProviderAuthStatus,
  agent: AgentProvider = 'opencode',
) {
  const { default: AccountContent } = await import(
    '@/modules/settings/tabs/agents-settings/sections/content/AccountContent'
  );

  return render(
    <AccountContent agent={agent} authStatus={status} onLogin={() => {}} onRecheck={() => {}} />,
  );
}

test('names the account when the provider reported one', async () => {
  const { container } = await renderAccount(
    buildStatus({ email: 'dev@example.com', method: 'credentials_file' }),
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.authStatus\.loggedInAs/);
  assert.match(text, /dev@example\.com/);
});

test('reports the local configuration instead of inventing an account', async () => {
  const { container } = await renderAccount(
    buildStatus({ email: null, method: 'opencode_config' }),
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.authStatus\.connectedViaLocalConfig/);
  assert.doesNotMatch(text, /agents\.authStatus\.loggedInAs/);
});

test('keeps reporting a missing connection when unauthenticated', async () => {
  const { container } = await renderAccount(
    buildStatus({ authenticated: false }),
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.authStatus\.notConnected/);
  assert.doesNotMatch(text, /agents\.authStatus\.connectedViaLocalConfig/);
});

test('reports a missing CLI as not installed instead of offering a login', async () => {
  const { container } = await renderAccount(
    buildStatus({
      installed: false,
      authenticated: false,
      error: 'omp CLI not found (install oh-my-pi or add omp to PATH)',
    }),
    'omp',
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.authStatus\.notInstalled/);
  assert.match(text, /agents\.install\.description/);
  assert.match(text, /agents\.install\.recheck/);
  assert.doesNotMatch(text, /agents\.login\./);
  // The server's install-path diagnostics are for the operator, not the dialog.
  assert.doesNotMatch(text, /oh-my-pi/);
});

test('points at the out-of-band login instead of a dead login button', async () => {
  const { container } = await renderAccount(
    buildStatus({ installed: true, authenticated: false }),
    'zcode',
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.externalAuth\.description/);
  assert.doesNotMatch(text, /agents\.login\.button/);
});

test('keeps the login button for providers that have an in-app login', async () => {
  const { container } = await renderAccount(
    buildStatus({ installed: true, authenticated: false }),
    'claude',
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.login\.button/);
  assert.doesNotMatch(text, /agents\.externalAuth\.description/);
});
