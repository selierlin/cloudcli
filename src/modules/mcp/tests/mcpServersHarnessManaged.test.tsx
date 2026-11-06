import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

/**
 * A provider whose only writable scope is the user scope (DSH, and Pi before
 * it) reports the servers it loads, but this page cannot edit them: the user
 * scope belongs to the MCP matrix. These tests pin the two halves of that —
 * the rows and their connection details are shown read-only, and the add
 * action routes to the matrix instead of opening a form with no scope to offer.
 *
 * The last test covers the sibling case: a provider the app can write still
 * shows its user-scope rows read-only. What stays editable there is the
 * file-native project/local scope, which the scope-section tests cover.
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
  api: {
    providers: {
      mcpServers: (...args: unknown[]) => mocks.mcpServers(...args),
      // The page also reads the MCP catalog to tell matrix-managed rows from
      // file-only ones; these tests are about the file rows, so it stays empty.
      mcpCatalog: async () => ({ ok: true, json: async () => ({ success: true, data: { entries: [] } }) }),
    },
  },
  readApiJson: async (response: { ok: boolean; json: () => Promise<{ success: boolean }> }) => {
    const payload = await response.json();
    if (!response.ok || payload.success === false) {
      throw new Error('request failed');
    }
    return payload;
  },
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

const DSH_SERVERS: ServerPayload[] = [
  { name: 'dbhub', transport: 'http', url: 'http://127.0.0.1:8880/mcp' },
  { name: 'openviking', transport: 'http', url: 'https://ov.example.com/mcp', headers: { Authorization: '<redacted>' } },
];

const APP_SERVERS: ServerPayload[] = [
  { name: 'playwright', transport: 'stdio', command: 'npx' },
];

/** Answers the settings list request for whichever provider is being rendered. */
function respondForProvider(provider: string): void {
  mocks.mcpServers.mockImplementation(async (requested: string, options: { scope: string }) => {
    const servers = requested === 'dsh' ? DSH_SERVERS : APP_SERVERS;
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

async function renderServers(provider: 'dsh' | 'claude', onOpenMcpMatrix?: () => void) {
  respondForProvider(provider);
  const { default: McpServers } = await import('@/modules/mcp/McpServers');
  const { container } = render(
    <McpServers selectedProvider={provider} currentProjects={[]} onOpenMcpMatrix={onOpenMcpMatrix} />,
  );

  await waitFor(() => {
    assert.match(container.textContent ?? '', /dbhub|playwright/);
  });
  return container;
}

/** Counts the per-row action buttons by the titles the component renders for them. */
function countActions(container: HTMLElement): number {
  return container.querySelectorAll('[title="mcpServers.actions.edit"], [title="mcpServers.actions.delete"]').length;
}

test('lists the dsh servers read-only, naming the harness home as their owner', async () => {
  const container = await renderServers('dsh');
  const text = container.textContent ?? '';

  assert.match(text, /dbhub/);
  assert.match(text, /http:\/\/127\.0\.0\.1:8880\/mcp/);
  assert.match(text, /https:\/\/ov\.example\.com\/mcp/);
  // Written outside CloudCLI, so the rows name that owner rather than claiming
  // the matrix owns them.
  assert.match(text, /mcpServers\.userScope\.unmanagedBadge/);
  assert.doesNotMatch(text, /mcpServers\.managed\.badge/);
  assert.equal(countActions(container), 0);
});

test('routes the dsh add action to the matrix, which owns the only scope it has', async () => {
  const onOpenMcpMatrix = vi.fn();
  const container = await renderServers('dsh', onOpenMcpMatrix);

  const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  assert.ok(trigger, 'expected the add menu trigger');
  fireEvent.click(trigger);

  const items = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  assert.equal(items.length, 1, 'the form is not offered: it has no scope left to write');
  fireEvent.click(items[0]);

  assert.equal(onOpenMcpMatrix.mock.calls.length, 1);
});

test('lists a writable provider user-scope servers read-only, since the matrix owns that scope', async () => {
  const container = await renderServers('claude');
  const text = container.textContent ?? '';

  assert.match(text, /playwright/);
  assert.match(text, /mcpServers\.userScope\.unmanagedBadge/);
  assert.doesNotMatch(text, /mcpServers\.managed\.badge/);
  assert.equal(countActions(container), 0);
});
