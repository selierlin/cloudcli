import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { invalidateMcpServersCache } from '@/modules/mcp/hooks/useMcpServers';
import McpServers from '@/modules/mcp/McpServers';

/**
 * The agents tab's MCP page renders two sections that must not mix: the user
 * scope is a read-only mirror (of the MCP matrix's catalog, or of file entries
 * the catalog does not know about), while the project and local scopes stay
 * file-native and keep their edit and delete actions.
 *
 * The add/edit form is the other half of the same rule: the user scope is gone
 * from it, so nothing here can create a second definition of a server the
 * matrix is supposed to own.
 *
 * The fake `t` returns keys, so the assertions stay independent of locale files.
 */

const mocks = vi.hoisted(() => ({
  mcpServers: vi.fn(),
  mcpCatalog: vi.fn(),
  translate: (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key,
}));

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      mcpServers: (...args: unknown[]) => mocks.mcpServers(...args),
      mcpCatalog: (...args: unknown[]) => mocks.mcpCatalog(...args),
    },
  },
  // Mirrors the real envelope reader: non-2xx or `success: false` throws.
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

// Module-level so the loader's cache key keeps its identity between renders; a
// fresh array per render would make its load effect re-fire forever.
const PROJECTS = [{ projectId: 'proj-1', displayName: 'Demo', fullPath: '/tmp/demo', path: '/tmp/demo' }];

const CATALOG_ENTRY = {
  id: 'entry-1',
  name: 'dbhub',
  transport: 'http',
  config: { url: 'http://127.0.0.1:8880/mcp' },
  enabled: { claude: true },
  createdAt: '2026-01-01 00:00:00',
  updatedAt: '2026-01-01 00:00:00',
};

const jsonResponse = (payload: unknown) => ({ ok: true, json: async () => payload });

/** Answers the harness list request with the servers configured for each scope. */
function respondWithServers(byScope: Record<string, unknown[]>): void {
  mocks.mcpServers.mockImplementation(async (_provider: string, options: { scope: string }) => jsonResponse({
    success: true,
    data: { provider: 'claude', scope: options.scope, servers: byScope[options.scope] ?? [] },
  }));
}

function respondWithCatalog(entries: unknown[]): void {
  mocks.mcpCatalog.mockImplementation(async () => jsonResponse({ success: true, data: { entries } }));
}

beforeEach(() => {
  mocks.mcpServers.mockReset();
  mocks.mcpCatalog.mockReset();
  // The hook's 30s cache is module state shared by every test in this file, so
  // one test's answer would otherwise be served to the next without a request.
  invalidateMcpServersCache();
});

async function renderServers(expected: RegExp, onOpenMcpMatrix?: () => void) {
  const { container, rerender } = render(
    <McpServers selectedProvider="claude" currentProjects={PROJECTS} onOpenMcpMatrix={onOpenMcpMatrix} />,
  );

  await waitFor(() => {
    assert.match(container.textContent ?? '', expected);
  });
  return { container, rerender };
}

/** The card that renders one row, found through the row's own name element. */
function rowFor(container: HTMLElement, name: string): HTMLElement {
  const nameElement = [...container.querySelectorAll('span')].find((element) => element.textContent === name);
  assert.ok(nameElement, `no name element for ${name}`);
  const row = nameElement.closest('div.rounded-lg');
  assert.ok(row instanceof HTMLElement, `no row card for ${name}`);
  return row;
}

function countActions(scope: HTMLElement): number {
  return scope.querySelectorAll('[title="mcpServers.actions.edit"], [title="mcpServers.actions.delete"]').length;
}

/** Opens one of the two add entries in the header's ActionMenu. */
function openAddForm(itemLabel: string): void {
  fireEvent.click(screen.getByText('mcpServers.addButton'));
  const item = screen.getByText(itemLabel);
  const button = item.closest('button');
  assert.ok(button, `no menu item button for ${itemLabel}`);
  fireEvent.click(button);
}

/** The add form's server-name field, wherever the portal put it. */
const serverNameField = () => document.querySelector<HTMLInputElement>(
  'input[placeholder="mcpForm.placeholders.serverName"]',
);

test('keeps user-scope rows read-only while project scope stays editable', async () => {
  respondWithServers({
    user: [{ name: 'playwright', transport: 'stdio', command: 'npx' }],
    project: [{ name: 'proj-srv', transport: 'stdio', command: 'node' }],
  });
  respondWithCatalog([]);

  // Waiting for the project row proves the user scope already committed: the
  // loader commits `user` first and appends project/local afterwards.
  const { container } = await renderServers(/proj-srv/);

  const userRow = rowFor(container, 'playwright');
  assert.match(userRow.textContent ?? '', /mcpServers\.userScope\.unmanagedBadge/);
  assert.equal(countActions(userRow), 0);

  const projectRow = rowFor(container, 'proj-srv');
  assert.equal(countActions(projectRow), 2);
  assert.doesNotMatch(projectRow.textContent ?? '', /mcpServers\.userScope\.unmanagedBadge/);

  // The two scopes are rendered as separate, labelled sections.
  assert.match(container.textContent ?? '', /mcpServers\.sections\.userScope/);
  assert.match(container.textContent ?? '', /mcpServers\.sections\.fileScopes/);
  // Without a jump handler there is nowhere to send the user, so no link at all.
  // `assert.ok` rather than `assert.equal(..., null)`: a failing equality check
  // would make node describe a DOM node and take the vitest worker down with it.
  assert.ok(screen.queryByText('mcpServers.openMatrix') === null, 'jump link rendered without a handler');
});

test('mirrors catalog entries as matrix-managed rows and offers the matrix jump', async () => {
  respondWithServers({ user: [] });
  respondWithCatalog([CATALOG_ENTRY]);

  const onOpenMcpMatrix = vi.fn();
  const { container } = await renderServers(/dbhub/, onOpenMcpMatrix);

  const row = rowFor(container, 'dbhub');
  assert.match(row.textContent ?? '', /mcpServers\.userScope\.managedBadge/);
  assert.match(row.textContent ?? '', /mcpServers\.userScope\.managedHint/);
  assert.equal(countActions(row), 0);

  fireEvent.click(screen.getByText('mcpServers.openMatrix'));
  assert.equal(onOpenMcpMatrix.mock.calls.length, 1);
});

test('shows a catalog entry once even when the harness file still carries it', async () => {
  respondWithServers({
    user: [
      { name: 'dbhub', transport: 'http', url: 'http://127.0.0.1:8880/mcp' },
      { name: 'local-helper', transport: 'stdio', command: 'npx' },
    ],
  });
  respondWithCatalog([CATALOG_ENTRY]);

  // Waiting for the file-only row proves the file rows have committed, so the
  // count below cannot pass merely by outrunning the loader.
  const { container } = await renderServers(/local-helper/);

  const nameElements = [...container.querySelectorAll('span')].filter((element) => element.textContent === 'dbhub');
  assert.equal(nameElements.length, 1);
  assert.match(rowFor(container, 'dbhub').textContent ?? '', /mcpServers\.userScope\.managedBadge/);
  assert.match(rowFor(container, 'local-helper').textContent ?? '', /mcpServers\.userScope\.unmanagedBadge/);
});

test('does not offer the user scope in the per-provider add form', async () => {
  respondWithServers({ user: [] });
  respondWithCatalog([]);
  await renderServers(/mcpServers\.title/);

  openAddForm('mcpServers.addProviderButton:{"provider":"Claude"}');

  await waitFor(() => {
    assert.match(document.body.textContent ?? '', /mcpForm\.scope\.projectProvider/);
  });
  assert.doesNotMatch(document.body.textContent ?? '', /mcpForm\.scope\.userGlobal/);
});

test('does not offer the user scope in the global add form', async () => {
  respondWithServers({ user: [] });
  respondWithCatalog([]);
  await renderServers(/mcpServers\.title/);

  openAddForm('mcpServers.addGlobalButton');

  await waitFor(() => {
    assert.match(document.body.textContent ?? '', /mcpForm\.scope\.projectAllProviders/);
  });
  assert.match(document.body.textContent ?? '', /mcpForm\.scope\.localAllProviders/);
  assert.doesNotMatch(document.body.textContent ?? '', /mcpForm\.scope\.userAllProviders/);
});

test('keeps what the user typed when the page re-renders', async () => {
  respondWithServers({ user: [] });
  respondWithCatalog([]);
  const { rerender } = await renderServers(/mcpServers\.title/);

  openAddForm('mcpServers.addProviderButton:{"provider":"Claude"}');
  await waitFor(() => {
    assert.match(document.body.textContent ?? '', /mcpForm\.scope\.projectProvider/);
  });

  const input = serverNameField();
  assert.ok(input, 'the add form has no server-name field');
  fireEvent.change(input, { target: { value: 'my-server' } });

  rerender(<McpServers selectedProvider="claude" currentProjects={PROJECTS} />);

  // The scope list feeds the form's own reload effect, so a fresh array per
  // render would reset the field the user is filling in.
  assert.equal(serverNameField()?.value, 'my-server');
});
