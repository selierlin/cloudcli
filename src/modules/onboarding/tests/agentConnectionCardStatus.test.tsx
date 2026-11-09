import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { LLMProvider, ProviderAuthStatus } from '@/shared/types';

/**
 * The card picks one sentence from the auth status, and the order of those
 * checks is the whole point: a missing CLI must win over the external-auth
 * copy, otherwise the onboarding screen sends a user without the CLI looking
 * for a config file that only exists once it is installed. The fake `t` echoes
 * keys and interpolation values, so these assertions do not depend on locales.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

const buildStatus = (overrides: Partial<ProviderAuthStatus>): ProviderAuthStatus => ({
  installed: true,
  provider: 'zcode',
  authenticated: true,
  email: null,
  method: null,
  error: null,
  loading: false,
  ...overrides,
});

async function renderCard(
  provider: LLMProvider,
  status: ProviderAuthStatus,
  title = 'ZCode',
) {
  const { default: AgentConnectionCard } = await import(
    '@/modules/onboarding/AgentConnectionCard'
  );

  return render(
    <AgentConnectionCard
      provider={provider}
      title={title}
      status={status}
      connectedClassName="connected"
      iconContainerClassName="icon"
      loginButtonClassName="login"
      onLogin={() => {}}
    />,
  );
}

describe('AgentConnectionCard status text', () => {
  it('reports a missing CLI instead of pointing at an out-of-band login', async () => {
    const { container, queryByRole } = await renderCard(
      'zcode',
      buildStatus({ provider: 'zcode', installed: false, authenticated: false }),
    );

    const text = container.textContent ?? '';
    expect(text).toMatch(/agents\.authStatus\.notInstalled/);
    expect(text).not.toMatch(/agents\.externalAuth\.description/);
    expect(queryByRole('button')).toBeNull();
  });

  it('points an installed but unauthenticated out-of-band provider at its own login', async () => {
    const { container, queryByRole } = await renderCard(
      'zcode',
      buildStatus({ provider: 'zcode', installed: true, authenticated: false }),
    );

    const text = container.textContent ?? '';
    expect(text).toMatch(/agents\.externalAuth\.description/);
    expect(text).not.toMatch(/agents\.login\.button/);
    expect(queryByRole('button')).toBeNull();
  });

  it('defers WorkBuddy sign-in to the desktop app without offering a login', async () => {
    const { container, queryByRole } = await renderCard(
      'workbuddy',
      buildStatus({
        provider: 'workbuddy',
        installed: true,
        authenticated: false,
        authVerified: false,
        method: 'workbuddy_desktop',
      }),
      'WorkBuddy',
    );

    const text = container.textContent ?? '';
    expect(text).toMatch(/agents\.externalAuth\.available/);
    expect(text).toMatch(/agents\.externalAuth\.managedByDesktop/);
    expect(queryByRole('button')).toBeNull();
  });

  it('keeps the login button for a provider with an in-app login', async () => {
    const { container, queryByRole } = await renderCard(
      'claude',
      buildStatus({ provider: 'claude', installed: true, authenticated: false }),
      'Claude Code',
    );

    expect(container.textContent ?? '').toMatch(/agents\.login\.button/);
    expect(queryByRole('button')).not.toBeNull();
  });
});
