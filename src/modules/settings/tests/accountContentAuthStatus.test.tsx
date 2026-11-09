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

async function renderAccount(status: ProviderAuthStatus, agent: AgentProvider = 'opencode') {
  const { default: AccountContent } = await import(
    '@/modules/settings/tabs/agents-settings/sections/content/AccountContent'
  );

  return render(<AccountContent agent={agent} authStatus={status} onLogin={() => {}} />);
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

/**
 * WorkBuddy's desktop app owns the sign-in, and a running engine only proves
 * the CLI is installed. Calling that "connected" would claim an account state
 * CloudCLI cannot see, and the re-login button would open a shell that only
 * prints where to sign in, so both are replaced by the external-management copy.
 */
test('defers WorkBuddy sign-in to the desktop app instead of offering a login', async () => {
  const { container, queryByRole } = await renderAccount(
    buildStatus({
      provider: 'workbuddy',
      authVerified: false,
      method: 'workbuddy_desktop',
    }),
    'workbuddy',
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.externalAuth\.available/);
  assert.match(text, /agents\.externalAuth\.managedByDesktop/);
  assert.doesNotMatch(text, /agents\.authStatus\.connected/);
  assert.doesNotMatch(text, /agents\.login\.reAuthenticate/);
  assert.equal(queryByRole('button'), null);
});
