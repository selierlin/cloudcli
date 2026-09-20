import assert from 'node:assert/strict';

import { render, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

/**
 * A harness-managed provider (DSH) reports the MCP servers its own harness
 * loads, but every write is rejected. These tests pin the two halves of that:
 * the rows and their connection details are shown, and the edit and delete
 * actions are not offered, unlike for a provider the app can write.
 *
 * The fake `t` returns keys, so the assertions stay independent of locale files.
 */

const mocks = vi.hoisted(() => ({
  mcpServers: vi.fn(),
  // A stable `t` matters here: the panel's loader subscribes to it, so a fake
  // that returned a fresh function per render would refetch in a loop.
  translate: (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key,
}));

vi.mock('@/shared/api', () => ({
  api: { providers: { mcpServers: (...args: unknown[]) => mocks.mcpServers(...args) } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate, i18n: { language: 'en' } }),
}));

type ServerPayload = {
  name: string;
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  headers?: Record<string, string>;
};

const HARNESS_SERVERS: ServerPayload[] = [
  { name: 'dbhub', transport: 'http', url: 'http://127.0.0.1:8880/mcp' },
  { name: 'openviking', transport: 'http', url: 'https://ov.example.com/mcp', headers: { Authorization: '<redacted>' } },
];

const APP_SERVERS: ServerPayload[] = [
  { name: 'playwright', transport: 'stdio', command: 'npx' },
];

/** Answers the settings list request for whichever provider is being rendered. */
function respondForProvider(provider: string): void {
  mocks.mcpServers.mockImplementation(async (requested: string, options: { scope: string }) => {
    const servers = requested === 'dsh' ? HARNESS_SERVERS : APP_SERVERS;
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          provider,
          scope: options.scope,
          servers: options.scope === 'user' ? servers : [],
        },
      }),
    };
  });
}

async function renderServers(provider: 'dsh' | 'claude') {
  respondForProvider(provider);
  const { default: McpServers } = await import('@/modules/mcp/McpServers');
  const { container } = render(<McpServers selectedProvider={provider} currentProjects={[]} />);

  await waitFor(() => {
    assert.match(container.textContent ?? '', /dbhub|playwright/);
  });
  return container;
}

/** Counts the per-row action buttons by the titles the component renders for them. */
function countActions(container: HTMLElement): number {
  return container.querySelectorAll('[title="mcpServers.actions.edit"], [title="mcpServers.actions.delete"]').length;
}

test('lists the harness servers read-only with their connection details', async () => {
  const container = await renderServers('dsh');
  const text = container.textContent ?? '';

  assert.match(text, /dbhub/);
  assert.match(text, /http:\/\/127\.0\.0\.1:8880\/mcp/);
  assert.match(text, /https:\/\/ov\.example\.com\/mcp/);
  assert.match(text, /mcpServers\.managed\.badge/);
  assert.match(text, /mcpServers\.managed\.harnessHint/);
  assert.equal(countActions(container), 0);
});

test('offers edit and delete for a provider the app manages', async () => {
  const container = await renderServers('claude');
  const text = container.textContent ?? '';

  assert.match(text, /playwright/);
  assert.doesNotMatch(text, /mcpServers\.managed\.badge/);
  assert.equal(countActions(container), 2);
});
