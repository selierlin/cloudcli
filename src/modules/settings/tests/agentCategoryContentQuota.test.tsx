import assert from 'node:assert/strict';

import { render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { AgentContextByProvider, AgentProvider } from '@/shared/types';

/**
 * Which providers get the provider-level quota panel. WorkBuddy reports a
 * balance per stored account in its own list, so the panel would only repeat
 * the signed-in account's figure under a name that changes with the switch;
 * every other provider still reads its quota here.
 */

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const quotaCalls: string[] = [];

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      providers: {
        quota: async (provider: string) => {
          quotaCalls.push(provider);
          return json({
            success: true,
            data: {
              quota: {
                provider,
                windows: [{ usedPercent: 5, windowMinutes: 300, resetsAt: null }],
                planType: null,
                credits: null,
                creditsUsed: null,
                creditsTotal: null,
                isPaidAccount: null,
                fetchedAt: 0,
              },
            },
          });
        },
        cliStatus: async (provider: string) => json({
          success: true,
          data: {
            provider,
            installed: true,
            installedVersion: '1.0.0',
            latestVersion: null,
            updateAvailable: false,
            updateCommand: null,
            updateUnavailableReason: null,
            updateInProgress: false,
            lastUpdate: null,
          },
        }),
      },
      workbuddySwitch: {
        status: async () => json({
          success: true,
          data: {
            available: true,
            version: '0.1.62',
            running: false,
            currentUid: 'uid-a',
            accounts: [
              {
                id: 'a',
                uid: 'uid-a',
                nickname: 'Selier',
                phoneNumber: null,
                email: null,
                expiresAt: null,
                needsRelogin: false,
                isEnterprise: false,
              },
            ],
          },
        }),
        credits: async () => json({ success: true, data: { available: true, credits: [] } }),
        progress: async () => json({ success: true, data: { running: false, progress: null } }),
      },
      runningSessions: async () => json({ success: true, data: { sessions: [] } }),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'en' },
  }),
}));

const PROVIDERS: AgentProvider[] = [
  'claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp', 'openclaw',
];

/** A context map covering every provider, so the section can index it directly. */
const buildContexts = (): AgentContextByProvider => Object.fromEntries(
  PROVIDERS.map((provider) => [
    provider,
    {
      authStatus: {
        installed: true,
        provider,
        authenticated: true,
        email: null,
        method: null,
        error: null,
        loading: false,
      },
      onLogin: () => {},
    },
  ]),
) as AgentContextByProvider;

async function renderAccountCategory(agent: AgentProvider) {
  const { default: AgentCategoryContentSection } = await import(
    '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection'
  );

  return render(
    <AgentCategoryContentSection
      selectedAgent={agent}
      selectedCategory="account"
      agentContextById={buildContexts()}
      claudePermissions={{ allowedTools: [], disallowedTools: [], skipPermissions: false }}
      onClaudePermissionsChange={() => {}}
      cursorPermissions={{ allowedCommands: [], disallowedCommands: [], skipPermissions: false }}
      onCursorPermissionsChange={() => {}}
      codexPermissionMode="default"
      onCodexPermissionModeChange={() => {}}
      workbuddyPermissionMode="auto"
      onWorkbuddyPermissionModeChange={() => {}}
      zcodePermissionMode="default"
      onZcodePermissionModeChange={() => {}}
      piPermissionMode="default"
      onPiPermissionModeChange={() => {}}
      dshPermissionMode="default"
      onDshPermissionModeChange={() => {}}
      ompPermissionMode="default"
      onOmpPermissionModeChange={() => {}}
      openclawPermissionMode="default"
      onOpenclawPermissionModeChange={() => {}}
      opencodePermissionMode="default"
      onOpenCodePermissionModeChange={() => {}}
      projects={[]}
    />,
  );
}

beforeEach(() => {
  quotaCalls.length = 0;
});

test('skips the quota panel for WorkBuddy, whose balances live on the account rows', async () => {
  const { container } = await renderAccountCategory('workbuddy');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.workbuddyAccounts\.title/);
  });
  const text = container.textContent ?? '';
  assert.doesNotMatch(text, /agents\.quota\.title/);
  assert.deepEqual(quotaCalls, []);
});

test('still reads quota for a provider that has no per-account balance list', async () => {
  const { container } = await renderAccountCategory('opencode');

  await waitFor(() => {
    assert.match(container.textContent ?? '', /agents\.quota\.window/);
  });
  assert.deepEqual(quotaCalls, ['opencode']);
});
