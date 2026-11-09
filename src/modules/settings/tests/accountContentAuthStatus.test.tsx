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

test('keeps the install card on screen while a recheck is in flight', async () => {
  const { default: AccountContent } = await import(
    '@/modules/settings/tabs/agents-settings/sections/content/AccountContent'
  );
  const notInstalled = buildStatus({ installed: false, authenticated: false });
  const renderCard = (status: ProviderAuthStatus) => (
    <AccountContent agent="omp" authStatus={status} onLogin={() => {}} onRecheck={() => {}} />
  );

  const { container, rerender } = render(renderCard(notInstalled));
  assert.match(container.textContent ?? '', /agents\.install\.recheck/);

  // A recheck flips `loading` on the existing entry; the card must survive the
  // round trip instead of flashing the login / external-auth sections.
  rerender(renderCard({ ...notInstalled, loading: true }));

  const text = container.textContent ?? '';
  assert.match(text, /agents\.install\.recheck/);
  assert.doesNotMatch(text, /agents\.externalAuth\.description/);
  assert.doesNotMatch(text, /agents\.login\.button/);
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

test('leaves the sign-in requirement to the login section instead of echoing the server error', async () => {
  const { container } = await renderAccount(
    buildStatus({
      installed: true,
      authenticated: false,
      error: 'Codex not configured',
    }),
    'codex',
  );

  const text = container.textContent ?? '';
  assert.match(text, /agents\.authStatus\.notConnected/);
  assert.match(text, /agents\.login\.button/);
  assert.doesNotMatch(text, /Codex not configured/);
  assert.doesNotMatch(text, /agents\.error/);
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
