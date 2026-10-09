import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type {
  McpCatalogEntry,
  McpCatalogProjectionOutcome,
  McpProvider,
  UpsertMcpCatalogEntryPayload,
} from '@/shared/types';

/**
 * The MCP matrix: one row per catalog entry, one column per harness that has a
 * user-scope config, and a cell whose state is the entry's enable switch, a
 * capability refusal, or the outcome of the write that just ran.
 *
 * The fake `t` returns its key (plus serialized options), so assertions can name
 * the exact message the cell would show without depending on a locale file.
 */

const mocks = vi.hoisted(() => ({
  mcpCatalog: vi.fn(),
  mcpCatalogUpsert: vi.fn(),
  mcpCatalogToggle: vi.fn(),
  mcpCatalogDelete: vi.fn(),
  mcpCatalogResync: vi.fn(),
  invalidateCache: vi.fn(),
  // A stable `t` matters: the matrix subscribes to it via its render path.
  translate: (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${JSON.stringify(options)}` : key,
}));

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      mcpCatalog: (...args: unknown[]) => mocks.mcpCatalog(...args),
      mcpCatalogUpsert: (...args: unknown[]) => mocks.mcpCatalogUpsert(...args),
      mcpCatalogToggle: (...args: unknown[]) => mocks.mcpCatalogToggle(...args),
      mcpCatalogDelete: (...args: unknown[]) => mocks.mcpCatalogDelete(...args),
      mcpCatalogResync: (...args: unknown[]) => mocks.mcpCatalogResync(...args),
    },
  },
  readApiJson: async (response: { json: () => Promise<unknown> }) => response.json(),
}));

// The matrix writes the same config files the per-harness page caches, so the
// one thing worth asserting here is that a successful write drops that cache.
vi.mock('@/modules/mcp/hooks/useMcpServers', () => ({
  invalidateMcpServersCache: (...args: unknown[]) => mocks.invalidateCache(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate, i18n: { language: 'en' } }),
}));

const ALL_PROVIDERS: McpProvider[] = [
  'claude', 'cursor', 'codex', 'opencode', 'dsh', 'workbuddy', 'pi', 'zcode', 'omp',
];

/** Builds a catalog entry with every harness switch off unless named. */
function entry(
  id: string,
  name: string,
  transport: McpCatalogEntry['transport'],
  config: McpCatalogEntry['config'],
  enabled: McpProvider[] = [],
): McpCatalogEntry {
  const switches = {} as Record<McpProvider, boolean>;
  for (const provider of ALL_PROVIDERS) {
    switches[provider] = enabled.includes(provider);
  }

  return { id, name, transport, config, enabled: switches, createdAt: '', updatedAt: '' };
}

const ENTRIES: McpCatalogEntry[] = [
  entry('1', 'notion', 'stdio', { command: 'npx', args: ['-y', 'notion-mcp'] }, ['claude']),
  entry('2', 'sentry', 'sse', { url: 'https://sentry.example/sse' }),
  // A secret lives in `env`; the search allow-list must never read it.
  entry('3', 'secretive', 'stdio', { command: 'run', env: { API_KEY: 'SUPERSECRET_TOKEN' } }),
];

function respondWith(entries: McpCatalogEntry[]): void {
  mocks.mcpCatalog.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { entries } }),
  });
}

/** Answers a toggle with the entry the server persisted plus the per-harness projection results. */
function respondToggle(updated: McpCatalogEntry, outcomes: McpCatalogProjectionOutcome[]): void {
  mocks.mcpCatalogToggle.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { entry: updated, outcomes } }),
  });
}

async function renderMatrix() {
  const { default: McpMatrix } = await import('@/modules/mcp/McpMatrix');
  const { container } = render(<McpMatrix />);

  await waitFor(() => {
    assert.ok(!container.textContent?.includes('mcpMatrix.loading'), 'matrix should finish loading');
  });
  return container;
}

/** The body row whose header cell names `name`. */
function rowFor(container: HTMLElement, name: string): HTMLElement {
  const rows = Array.from(container.querySelectorAll('tbody tr'));
  const row = rows.find((candidate) => candidate.textContent?.includes(name));
  assert.ok(row, `expected a matrix row for "${name}"`);
  return row as HTMLElement;
}

/** Collects the `aria-label` of every cell in `row` whose state matches. */
function labelsInState(row: HTMLElement, state: string): string[] {
  return Array.from(row.querySelectorAll(`button[data-state="${state}"]`))
    .map((cell) => cell.getAttribute('aria-label') ?? '');
}

/** The server name each row shows, in table order. */
function rowNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('th span.truncate')?.textContent ?? '',
  );
}

/** The cell button for one harness inside `row`, found through its accessible name. */
function cellFor(row: HTMLElement, providerName: string): HTMLButtonElement {
  const cell = row.querySelector(`button[aria-label*="${providerName}"]`);
  assert.ok(cell, `expected a ${providerName} cell`);
  return cell as HTMLButtonElement;
}

beforeEach(() => {
  mocks.mcpCatalog.mockReset();
  mocks.mcpCatalogUpsert.mockReset();
  mocks.mcpCatalogToggle.mockReset();
  mocks.mcpCatalogDelete.mockReset();
  mocks.mcpCatalogResync.mockReset();
  mocks.invalidateCache.mockReset();
  respondWith(ENTRIES);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('renders one column per harness that has a user scope', async () => {
  const container = await renderMatrix();
  const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
  const body = headers.join('|');

  for (const providerName of ['Claude', 'Cursor', 'Codex', 'OpenCode', 'DeepSeek Harness', 'WorkBuddy', 'Pi', 'ZCode']) {
    assert.ok(body.includes(providerName), `expected a ${providerName} column`);
  }

  // OMP reads MCP servers from config files it owns, so it never gets a column.
  assert.ok(!body.includes('OMP'), 'OMP should not have a column');
});

test('reads the catalog from the api', async () => {
  await renderMatrix();
  assert.equal(mocks.mcpCatalog.mock.calls.length, 1);
});

test('shows on/off cells and refuses only the harness-managed column for a stdio entry', async () => {
  const container = await renderMatrix();
  const row = rowFor(container, 'notion');

  assert.deepEqual(labelsInState(row, 'on'), ['mcpMatrix.cell.on:{"name":"notion","provider":"Claude"}']);
  // cursor, codex, opencode, workbuddy, pi, zcode stay off; dsh is the only refusal.
  assert.equal(labelsInState(row, 'off').length, 6);
  assert.equal(labelsInState(row, 'disabled').length, 1);
  assert.match(labelsInState(row, 'disabled')[0], /mcpMatrix\.disabled\.harnessManaged/);
});

test('disables the sse-unsupported harnesses in addition to the harness-managed column', async () => {
  const container = await renderMatrix();
  const row = rowFor(container, 'sentry');
  const disabledLabels = labelsInState(row, 'disabled');

  // cursor, codex, opencode and pi cannot speak sse; dsh refuses every write.
  assert.equal(disabledLabels.length, 5);
  for (const name of ['Cursor', 'Codex', 'OpenCode', 'Pi']) {
    const label = disabledLabels.find((candidate) => candidate.includes(name));
    assert.ok(label, `expected a disabled ${name} cell`);
    assert.match(label, /mcpMatrix\.disabled\.transport/);
    assert.ok(label.includes('sse'), `${name} refusal should name the transport`);
  }
  assert.ok(disabledLabels.some((label) => /mcpMatrix\.disabled\.harnessManaged/.test(label)));

  // claude, workbuddy and zcode accept sse, so they stay switchable.
  assert.equal(labelsInState(row, 'off').length, 3);
});

test('searches only non-secret fields', async () => {
  const container = await renderMatrix();
  const search = container.querySelector('input[aria-label="mcpMatrix.searchPlaceholder"]');
  assert.ok(search, 'expected the search input');

  fireEvent.change(search, { target: { value: 'notion-mcp' } });
  assert.equal(container.querySelectorAll('tbody tr').length, 1);
  assert.ok(container.textContent?.includes('notion'));

  fireEvent.change(search, { target: { value: 'SUPERSECRET_TOKEN' } });
  assert.equal(container.querySelectorAll('tbody tr').length, 0);
  assert.ok(container.textContent?.includes('mcpMatrix.searchNoResults'));

  fireEvent.change(search, { target: { value: 'sentry.example' } });
  assert.equal(container.querySelectorAll('tbody tr').length, 1);
  assert.ok(container.textContent?.includes('sentry'));
});

test('renders the empty state when the catalog has no entries', async () => {
  respondWith([]);
  const container = await renderMatrix();

  assert.ok(container.textContent?.includes('mcpMatrix.empty'));
  assert.equal(container.querySelectorAll('tbody tr').length, 0);
});

test('surfaces a load failure and offers a reload', async () => {
  mocks.mcpCatalog.mockRejectedValue(new Error('catalog unavailable'));
  const container = await renderMatrix();

  assert.ok(container.textContent?.includes('catalog unavailable'));
  const reload = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'mcpMatrix.reload',
  );
  assert.ok(reload, 'expected a reload button');
});

test('renders each cell state with the right affordance', async () => {
  const { default: McpMatrixCell } = await import('@/modules/mcp/McpMatrixCell');

  const states = ['on', 'off', 'fail', 'disabled'] as const;
  for (const state of states) {
    const toggle = vi.fn();
    const { container, unmount } = render(
      <McpMatrixCell state={state} label={`${state} cell`} onToggle={toggle} />,
    );
    const cell = container.querySelector('button') as HTMLButtonElement | null;

    assert.ok(cell, `expected a button for state ${state}`);
    assert.equal(cell.getAttribute('data-state'), state);
    // Only a write in flight is busy; a rendered state on its own never is.
    assert.equal(cell.getAttribute('aria-busy'), null);
    // `disabled` is the only state the harness itself refuses; the others are
    // clickable once a toggle handler is supplied.
    assert.equal(cell.disabled, state === 'disabled', `${state} cell disabled flag`);
    unmount();
  }
});

test('renders an inert cell when no toggle handler is supplied', async () => {
  const { default: McpMatrixCell } = await import('@/modules/mcp/McpMatrixCell');
  const { container } = render(<McpMatrixCell state="off" label="off cell" />);
  const cell = container.querySelector('button') as HTMLButtonElement | null;

  assert.ok(cell, 'expected a button');
  assert.equal(cell.disabled, true);
});

test('turns a harness on by writing the flipped value through the catalog', async () => {
  const container = await renderMatrix();
  respondToggle(
    entry('1', 'notion', 'stdio', { command: 'npx', args: ['-y', 'notion-mcp'] }, ['claude', 'codex']),
    [{ provider: 'codex', action: 'upsert', ok: true }],
  );

  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Codex'));

  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 1));
  assert.deepEqual(mocks.mcpCatalogToggle.mock.calls[0], ['1', { provider: 'codex', enabled: true }]);
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'on');
  });
  // The write landed in codex's config file, so the cached read of it is stale.
  assert.deepEqual(mocks.invalidateCache.mock.calls, [['codex']]);
});

test('turns a harness off by writing the flipped value', async () => {
  const container = await renderMatrix();
  respondToggle(
    entry('1', 'notion', 'stdio', { command: 'npx' }),
    [{ provider: 'claude', action: 'remove', ok: true }],
  );

  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Claude'));

  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 1));
  assert.deepEqual(mocks.mcpCatalogToggle.mock.calls[0], ['1', { provider: 'claude', enabled: false }]);
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Claude').getAttribute('data-state'), 'off');
  });
});

test('marks one cell failed when a harness refuses the projection, and retries the same value', async () => {
  const container = await renderMatrix();
  // The switch is saved as `on`; only the write into codex's config file failed.
  respondToggle(
    entry('1', 'notion', 'stdio', { command: 'npx' }, ['claude', 'codex']),
    [{ provider: 'codex', action: 'upsert', ok: false, error: 'permission denied' }],
  );

  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Codex'));
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'fail');
  });

  const label = cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('aria-label') ?? '';
  assert.match(label, /mcpMatrix\.cell\.fail/);
  assert.ok(label.includes('permission denied'), 'the refusal reason should be shown');
  // A refused write never reached the file, so nothing may be dropped from the cache.
  assert.equal(mocks.invalidateCache.mock.calls.length, 0);

  // A retry repeats the value the write wanted (`on`) instead of flipping it back off.
  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Codex'));
  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 2));
  assert.deepEqual(mocks.mcpCatalogToggle.mock.calls[1], ['1', { provider: 'codex', enabled: true }]);
});

test('marks the cell failed when the request itself fails, and clears it once a retry succeeds', async () => {
  const container = await renderMatrix();
  mocks.mcpCatalogToggle.mockRejectedValueOnce(new Error('network down'));

  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Codex'));
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'fail');
  });
  assert.match(
    cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('aria-label') ?? '',
    /network down/,
  );

  respondToggle(
    entry('1', 'notion', 'stdio', { command: 'npx' }, ['claude', 'codex']),
    [{ provider: 'codex', action: 'upsert', ok: true }],
  );
  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Codex'));

  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'on');
  });
  assert.deepEqual(mocks.invalidateCache.mock.calls, [['codex']]);
});

test('makes a cell inert while its own write is still in flight', async () => {
  const container = await renderMatrix();
  let resolveToggle: (response: unknown) => void = () => {};
  mocks.mcpCatalogToggle.mockReturnValue(new Promise((resolve) => { resolveToggle = resolve; }));

  const cell = cellFor(rowFor(container, 'notion'), 'Codex');
  fireEvent.click(cell);

  await waitFor(() => assert.equal(cell.getAttribute('aria-busy'), 'true'));
  assert.equal(cell.disabled, true, 'a busy cell must not accept a second click');
  assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 1);

  resolveToggle({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        entry: entry('1', 'notion', 'stdio', { command: 'npx' }, ['claude', 'codex']),
        outcomes: [{ provider: 'codex', action: 'upsert', ok: true }],
      },
    }),
  });
  await waitFor(() => assert.equal(cell.getAttribute('aria-busy'), null));
  assert.equal(cell.disabled, false, 'the cell must be switchable again once the write settles');
});

test('lets the capability refusal outrank a failed write in that cell', async () => {
  const { getCellState } = await import('@/modules/mcp/utils/mcpMatrixRules');
  const stdioEntry = entry('9', 'any-server', 'stdio', { command: 'run' });

  // dsh refuses every app-managed write, so it can never report `fail`.
  assert.equal(getCellState(stdioEntry, 'dsh', true), 'disabled');
  assert.equal(getCellState(stdioEntry, 'claude', true), 'fail');
  assert.equal(getCellState(stdioEntry, 'claude', false), 'off');
});

// ─── batch writes, undo and delete ──────────────────────────────────────────

/** Mirrors the server: flips the named switch and reports a successful projection. */
function respondWithSwitch(): void {
  mocks.mcpCatalogToggle.mockImplementation(
    async (id: string, payload: { provider: McpProvider; enabled: boolean }) => {
      const base = ENTRIES.find((candidate) => candidate.id === id);
      assert.ok(base, `the test toggled an unknown entry (${id})`);
      const updated: McpCatalogEntry = {
        ...base,
        enabled: { ...base.enabled, [payload.provider]: payload.enabled },
      };

      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            entry: updated,
            outcomes: [{
              provider: payload.provider,
              action: payload.enabled ? 'upsert' : 'remove',
              ok: true,
            }],
          },
        }),
      };
    },
  );
}

/** Answers a delete with the server's verdict and the per-harness removal results. */
function respondDelete(removed: boolean, outcomes: McpCatalogProjectionOutcome[] = []): void {
  mocks.mcpCatalogDelete.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { removed, outcomes } }),
  });
}

/** Every toggle call so far, as `[entryId, provider, enabled]` triples. */
function toggleCalls(): Array<[string, string, boolean]> {
  return mocks.mcpCatalogToggle.mock.calls.map((call) => {
    const [id, payload] = call as [string, { provider: string; enabled: boolean }];
    return [id, payload.provider, payload.enabled];
  });
}

/** The matrix button whose accessible name is exactly `label`. */
function buttonFor(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  assert.ok(button, `expected a button labelled ${label}`);
  return button as HTMLButtonElement;
}

/** Opens the ActionMenu whose trigger carries `label` and selects the item starting with `itemLabel`. */
function selectMenuItem(container: HTMLElement, label: string, itemLabel: string): void {
  fireEvent.click(buttonFor(container, label));

  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (candidate) => (candidate.textContent ?? '').startsWith(itemLabel),
  );
  assert.ok(item, `expected a menu item labelled ${itemLabel}`);
  fireEvent.click(item);
}

/**
 * Asserts an open portal menu outranks the Settings dialog hosting the matrix.
 *
 * The dialog is itself a `z-[9999]` portal to `<body>` (Settings.tsx), so a menu
 * left at ActionMenu's default `z-[70]` paints behind it — on a phone, where the
 * dialog is full-screen, tapping "…" looks like it does nothing at all.
 */
function assertMenuOutranksDialog(menu: Element | null): void {
  assert.ok(menu, 'expected a portal menu to render');
  assert.ok(
    menu.className.includes('z-[10000]'),
    `expected the menu to outrank the dialog, got: ${menu.className}`,
  );
}

test('enables a whole column, skipping the cells the harness refuses', async () => {
  const container = await renderMatrix();
  respondWithSwitch();

  // Only codex's column, and only the rows it can actually take: sentry is `sse`.
  selectMenuItem(container, 'mcpMatrix.bulk.menuLabel:{"provider":"Codex"}', 'mcpMatrix.bulk.enableAll');

  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 2));
  assert.deepEqual(toggleCalls(), [
    ['1', 'codex', true],
    ['3', 'codex', true],
  ]);
});

test('narrows a column batch to the rows the search left visible', async () => {
  const container = await renderMatrix();
  respondWithSwitch();

  const search = container.querySelector('input[aria-label="mcpMatrix.searchPlaceholder"]');
  assert.ok(search, 'expected the search input');
  fireEvent.change(search, { target: { value: 'notion' } });

  selectMenuItem(container, 'mcpMatrix.bulk.menuLabel:{"provider":"Codex"}', 'mcpMatrix.bulk.enableAll');

  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 1));
  assert.deepEqual(toggleCalls(), [['1', 'codex', true]]);
});

test('enables every harness a row can reach, leaving the refused and already-on cells alone', async () => {
  const container = await renderMatrix();
  respondWithSwitch();

  // notion is already on for claude; dsh refuses every write.
  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.enableAll');

  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 6));
  assert.deepEqual(toggleCalls(), [
    ['1', 'cursor', true],
    ['1', 'codex', true],
    ['1', 'opencode', true],
    ['1', 'workbuddy', true],
    ['1', 'pi', true],
    ['1', 'zcode', true],
  ]);
});

test('offers undo after a batch and writes every changed cell back', async () => {
  const container = await renderMatrix();
  respondWithSwitch();

  selectMenuItem(container, 'mcpMatrix.bulk.menuLabel:{"provider":"Codex"}', 'mcpMatrix.bulk.enableAll');
  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 2));
  assert.ok(
    container.textContent?.includes('mcpMatrix.undo.enabled:{"count":2}'),
    'the batch should offer an undo naming how many cells it changed',
  );

  const undoButton = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'mcpMatrix.undo.action',
  );
  assert.ok(undoButton, 'expected the undo control');
  fireEvent.click(undoButton);

  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 4));
  assert.deepEqual(toggleCalls().slice(2), [
    ['1', 'codex', false],
    ['3', 'codex', false],
  ]);
  // Undo is a write of its own, not something to take back in turn.
  assert.ok(!container.textContent?.includes('mcpMatrix.undo.enabled'), 'undo must not offer a second undo');
});

test('offers no undo when a batch changed nothing', async () => {
  const container = await renderMatrix();
  respondWithSwitch();

  const search = container.querySelector('input[aria-label="mcpMatrix.searchPlaceholder"]');
  assert.ok(search, 'expected the search input');
  fireEvent.change(search, { target: { value: 'notion' } });

  // notion is already on for claude, so turning that column on changes nothing.
  selectMenuItem(container, 'mcpMatrix.bulk.menuLabel:{"provider":"Claude"}', 'mcpMatrix.bulk.enableAll');

  await waitFor(() => assert.equal(container.querySelectorAll('tbody tr').length, 1));
  assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 0);
  assert.ok(!container.textContent?.includes('mcpMatrix.undo'), 'nothing changed, so there is nothing to undo');
});

test('deletes an entry after confirmation and drops it from the table', async () => {
  const container = await renderMatrix();
  respondDelete(true);
  vi.spyOn(window, 'confirm').mockReturnValue(true);

  assert.equal(container.querySelectorAll('tbody tr').length, 3);
  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.delete');

  await waitFor(() => assert.equal(mocks.mcpCatalogDelete.mock.calls.length, 1));
  assert.deepEqual(mocks.mcpCatalogDelete.mock.calls[0], ['1']);
  await waitFor(() => assert.equal(container.querySelectorAll('tbody tr').length, 2));
  assert.ok(!container.textContent?.includes('notion'), 'the deleted entry should be gone');
  // The removal touched every harness the entry was enabled for, so no harness
  // may keep serving a cached list that still names it.
  assert.deepEqual(mocks.invalidateCache.mock.calls, [[]]);
});

test('keeps the entry when the confirmation is declined', async () => {
  const container = await renderMatrix();
  respondDelete(true);
  vi.spyOn(window, 'confirm').mockReturnValue(false);

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.delete');

  assert.equal(mocks.mcpCatalogDelete.mock.calls.length, 0);
  assert.equal(container.querySelectorAll('tbody tr').length, 3);
});

test('keeps the row and names the harnesses that refused the removal', async () => {
  const container = await renderMatrix();
  respondDelete(false, [{ provider: 'claude', action: 'remove', ok: false, error: 'read-only file' }]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.delete');

  await waitFor(() => {
    assert.ok(
      container.textContent?.includes('mcpMatrix.row.deleteFailed:{"details":"Claude: read-only file"}'),
      'the refusal should be reported with the harness that caused it',
    );
  });
  assert.equal(container.querySelectorAll('tbody tr').length, 3, 'a failed delete must keep the entry visible');
});

// ─── creating and editing entries ───────────────────────────────────────────

/** Answers a save with the entry the server persisted plus its projection results. */
function respondUpsert(saved: McpCatalogEntry, outcomes: McpCatalogProjectionOutcome[] = []): void {
  mocks.mcpCatalogUpsert.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { entry: saved, outcomes } }),
  });
}

/** The control inside the open dialog whose `placeholder` is exactly `text`. */
function controlByPlaceholder(selector: string, text: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.getAttribute('placeholder') === text,
  ) ?? null;
}

/** The control whose `placeholder` contains `text`; used where the placeholder spans lines. */
function controlWithPlaceholder(selector: string, text: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) => (element.getAttribute('placeholder') ?? '').includes(text),
  ) ?? null;
}

/** Renders the matrix and opens the create dialog, returning the matrix container. */
async function openCreateForm(): Promise<HTMLElement> {
  const container = await renderMatrix();
  const add = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'mcpMatrix.addEntry',
  );
  assert.ok(add, 'expected the add button');
  fireEvent.click(add);

  await waitFor(() => assert.ok(document.querySelector('form'), 'expected the entry form'));
  return container;
}

/** Fills the fields an entry needs and submits the dialog. */
function submitEntryForm(fields: { name: string; command?: string }): void {
  const name = controlByPlaceholder('input', 'mcpForm.placeholders.serverName');
  assert.ok(name, 'expected the name field');
  fireEvent.change(name, { target: { value: fields.name } });

  if (fields.command !== undefined) {
    const command = controlByPlaceholder('input', 'npx @my-org/mcp-server');
    assert.ok(command, 'expected the command field');
    fireEvent.change(command, { target: { value: fields.command } });
  }

  const form = document.querySelector('form');
  assert.ok(form, 'expected the entry form');
  fireEvent.submit(form);
}

/** The request body of the nth save. */
function savedPayload(index = 0): UpsertMcpCatalogEntryPayload {
  const call = mocks.mcpCatalogUpsert.mock.calls[index];
  assert.ok(call, `expected save #${index}`);
  return call[0] as UpsertMcpCatalogEntryPayload;
}

test('creates an entry from the form and shows it in the matrix', async () => {
  const container = await openCreateForm();
  respondUpsert(entry('9', 'linear', 'stdio', { command: 'npx linear-mcp' }));

  submitEntryForm({ name: 'linear', command: 'npx linear-mcp' });

  await waitFor(() => assert.equal(mocks.mcpCatalogUpsert.mock.calls.length, 1));
  const payload = savedPayload();
  // No `id` marks a create; the server assigns one.
  assert.equal(payload.id, undefined);
  assert.equal(payload.name, 'linear');
  assert.equal(payload.transport, 'stdio');
  assert.equal(payload.config.command, 'npx linear-mcp');

  // The dialog closes on success and the new row joins the table.
  await waitFor(() => assert.equal(document.querySelector('form'), null, 'the dialog should close'));
  await waitFor(() => assert.equal(container.querySelectorAll('tbody tr').length, 4));
  assert.ok(rowFor(container, 'linear'), 'the created entry needs a row');
  // A create starts with every switch off, so no config file was touched.
  assert.equal(mocks.invalidateCache.mock.calls.length, 0);
});

test('keeps the fields only some harnesses use when it builds the entry', async () => {
  await openCreateForm();
  respondUpsert(entry('9', 'deep', 'stdio', {}));

  // A catalog entry is cross-harness, so the form must keep the codex-only
  // fields rather than borrowing one harness's narrower field set.
  const cwd = controlByPlaceholder('input', '.');
  const envVars = controlWithPlaceholder('textarea', 'GITHUB_TOKEN');
  assert.ok(cwd, 'the catalog form must offer a working directory');
  assert.ok(envVars, 'the catalog form must offer env-var names');
  assert.equal(
    controlByPlaceholder('input', 'MCP_TOKEN'),
    null,
    'the bearer token name is a non-stdio field, so it stays hidden here',
  );

  const name = controlByPlaceholder('input', 'mcpForm.placeholders.serverName');
  const command = controlByPlaceholder('input', 'npx @my-org/mcp-server');
  assert.ok(name && command, 'expected the name and command fields');
  fireEvent.change(name, { target: { value: 'deep' } });
  fireEvent.change(command, { target: { value: 'run' } });
  fireEvent.change(cwd, { target: { value: '/srv' } });
  fireEvent.change(envVars, { target: { value: 'API_KEY\nSECOND_KEY' } });
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogUpsert.mock.calls.length, 1));
  assert.equal(savedPayload().config.cwd, '/srv');
  assert.deepEqual(savedPayload().config.envVars, ['API_KEY', 'SECOND_KEY']);
});

test('opens the edit form prefilled and saves under the entry\'s id', async () => {
  const container = await renderMatrix();
  respondUpsert(
    entry('1', 'notion-renamed', 'stdio', { command: 'npx' }, ['claude']),
    [{ provider: 'claude', action: 'upsert', ok: true }],
  );

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.edit');
  await waitFor(() => assert.ok(document.querySelector('form'), 'expected the entry form'));

  const name = controlByPlaceholder('input', 'mcpForm.placeholders.serverName');
  assert.ok(name, 'expected the name field');
  assert.equal((name as HTMLInputElement).value, 'notion', 'the form must open on the entry being edited');

  fireEvent.change(name, { target: { value: 'notion-renamed' } });
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogUpsert.mock.calls.length, 1));
  const payload = savedPayload();
  assert.equal(payload.id, '1', 'an edit has to address the entry it came from');
  assert.equal(payload.name, 'notion-renamed');

  await waitFor(() => assert.ok(container.textContent?.includes('notion-renamed')));
  // An edit rewrites the row it came from rather than adding a second one.
  assert.deepEqual(rowNames(container), ['notion-renamed', 'sentry', 'secretive']);
  // It is enabled for claude, so that harness's config file was rewritten.
  assert.deepEqual(mocks.invalidateCache.mock.calls, [['claude']]);
});

test('keeps what the user typed when the panel re-renders', async () => {
  const container = await renderMatrix();

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.edit');
  await waitFor(() => assert.ok(document.querySelector('form'), 'expected the entry form'));

  const name = controlByPlaceholder('input', 'mcpForm.placeholders.serverName') as HTMLInputElement | null;
  assert.ok(name, 'expected the name field');
  fireEvent.change(name, { target: { value: 'half-typed' } });

  // Any panel re-render hands the dialog fresh props. Rebuilding the entry it
  // was opened on would reload the fields and silently discard the edit.
  const search = container.querySelector('input[aria-label="mcpMatrix.searchPlaceholder"]');
  assert.ok(search, 'expected the search input');
  fireEvent.change(search, { target: { value: 'notion' } });

  assert.equal(name.value, 'half-typed', 'a re-render must not discard the entry being edited');
});

test('keeps the form open and the table unchanged when the save is refused', async () => {
  const container = await openCreateForm();
  mocks.mcpCatalogUpsert.mockRejectedValue(new Error('An MCP server named "notion" already exists.'));
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});

  submitEntryForm({ name: 'notion', command: 'npx' });

  await waitFor(() => assert.equal(alert.mock.calls.length, 1, 'the refusal has to be reported'));
  assert.ok(document.querySelector('form'), 'a refused save must not close the form');
  assert.equal(container.querySelectorAll('tbody tr').length, 3, 'and must not add a row');
});

// ─── the resync escape hatch ────────────────────────────────────────────────

/** Answers a resync with the per-harness results of re-applying the whole catalog. */
function respondResync(outcomes: McpCatalogProjectionOutcome[]): void {
  mocks.mcpCatalogResync.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { outcomes } }),
  });
}

/** The matrix button whose text is exactly `label`. */
function buttonByText(container: HTMLElement, label: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  ) as HTMLButtonElement | undefined ?? null;
}

/** Puts one cell of `name` into its failed state by making the server refuse that write. */
async function failCell(container: HTMLElement, name: string, providerName: string): Promise<void> {
  respondToggle(
    entry('1', name, 'stdio', { command: 'npx' }, ['claude', 'codex']),
    [{ provider: 'codex', action: 'upsert', ok: false, error: 'permission denied' }],
  );

  fireEvent.click(cellFor(rowFor(container, name), providerName));
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, name), providerName).getAttribute('data-state'), 'fail');
  });
  // A refused write never reached the file, so nothing was dropped from the cache.
  assert.equal(mocks.invalidateCache.mock.calls.length, 0);
}

test('repairs a failed cell when the resync manages to write that harness', async () => {
  const container = await renderMatrix();
  await failCell(container, 'notion', 'Codex');

  respondResync([{ provider: 'codex', action: 'upsert', ok: true }]);
  fireEvent.click(buttonByText(container, 'mcpMatrix.resync') as HTMLButtonElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogResync.mock.calls.length, 1));
  // The harness's file now matches its switch again, so the cell stops claiming
  // the write failed — and the read the old page cached is stale.
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'on');
  });
  assert.deepEqual(mocks.invalidateCache.mock.calls, [['codex']]);
});

test('keeps a still-failing cell and names the harness the resync could not write', async () => {
  const container = await renderMatrix();
  await failCell(container, 'notion', 'Codex');

  // A partial success for the same harness must not clear the cell: one of its
  // entries is still unwritten, and the cell cannot tell which write it shows.
  respondResync([
    { provider: 'codex', action: 'upsert', ok: true },
    { provider: 'codex', action: 'upsert', ok: false, error: 'permission denied' },
  ]);
  fireEvent.click(buttonByText(container, 'mcpMatrix.resync') as HTMLButtonElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogResync.mock.calls.length, 1));
  assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'fail');
  await waitFor(() => {
    assert.ok(
      container.textContent?.includes(
        'mcpMatrix.resyncFailed:{"details":"Codex: permission denied"}',
      ),
      'the harness that still refuses has to be reported',
    );
  });
});

test('offers no resync while there is nothing in the catalog to re-apply', async () => {
  respondWith([]);
  const container = await renderMatrix();

  assert.equal((buttonByText(container, 'mcpMatrix.resync') as HTMLButtonElement).disabled, true);
});

// ─── the edit path's capability gate (§11.1) ────────────────────────────────

/** The open dialog's transport picker. */
function transportSelect(): HTMLSelectElement {
  const select = Array.from(document.querySelectorAll('form select')).find(
    (candidate) => Array.from(candidate.querySelectorAll('option')).some(
      (option) => option.getAttribute('value') === 'sse',
    ),
  );
  assert.ok(select, 'expected the transport picker');
  return select as HTMLSelectElement;
}

test('turns off the harnesses that cannot use an entry\'s new transport', async () => {
  const container = await renderMatrix();

  // The save rewrote the entry as sse; codex cannot speak it and refused the
  // projection, while claude took it.
  respondUpsert(
    entry('1', 'notion', 'sse', { url: 'https://notion.example/sse' }, ['claude', 'codex']),
    [
      { provider: 'claude', action: 'upsert', ok: true },
      { provider: 'codex', action: 'upsert', ok: false, error: 'unsupported transport' },
    ],
  );
  respondToggle(
    entry('1', 'notion', 'sse', { url: 'https://notion.example/sse' }, ['claude']),
    [{ provider: 'codex', action: 'remove', ok: true }],
  );

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.edit');
  await waitFor(() => assert.ok(document.querySelector('form'), 'expected the entry form'));
  fireEvent.change(transportSelect(), { target: { value: 'sse' } });
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogUpsert.mock.calls.length, 1));
  assert.equal(savedPayload().transport, 'sse');

  // The switch the projection could not honour is turned off rather than left
  // as a cell whose only reachable state is `fail`.
  await waitFor(() => assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 1));
  assert.deepEqual(
    mocks.mcpCatalogToggle.mock.calls[0],
    ['1', { provider: 'codex', enabled: false }],
  );
  // claude kept its switch: it accepted the new definition.
  assert.ok(!mocks.mcpCatalogToggle.mock.calls.some(
    (call) => (call[1] as { provider: string }).provider === 'claude',
  ));

  await waitFor(() => {
    assert.ok(
      container.textContent?.includes('mcpMatrix.form.droppedColumns:{"providers":"Codex"}'),
      'the dropped column has to be stated after the save',
    );
  });
});

test('states which columns a save dropped, and nothing when it dropped none', async () => {
  const container = await renderMatrix();
  respondUpsert(
    entry('1', 'notion', 'stdio', { command: 'npx' }, ['claude']),
    [{ provider: 'claude', action: 'upsert', ok: true }],
  );

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.edit');
  await waitFor(() => assert.ok(document.querySelector('form'), 'expected the entry form'));
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogUpsert.mock.calls.length, 1));
  // A save that every enabled harness accepted says only what the table shows.
  assert.ok(!(container.textContent ?? '').includes('mcpMatrix.form.droppedColumns'));
  assert.equal(mocks.mcpCatalogToggle.mock.calls.length, 0);
  assert.deepEqual(mocks.invalidateCache.mock.calls, [['claude']]);
});

test('marks the harnesses a save failed to write, and retries them on the cell', async () => {
  const container = await renderMatrix();

  // claude took the rewritten definition; codex refused it, so its config file
  // still holds the previous definition while the catalog row says otherwise.
  respondUpsert(
    entry('1', 'notion', 'stdio', { command: 'npx-v2' }, ['claude', 'codex']),
    [
      { provider: 'claude', action: 'upsert', ok: true },
      { provider: 'codex', action: 'upsert', ok: false, error: 'permission denied' },
    ],
  );

  selectMenuItem(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}', 'mcpMatrix.row.edit');
  await waitFor(() => assert.ok(document.querySelector('form'), 'expected the entry form'));
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);

  await waitFor(() => assert.equal(mocks.mcpCatalogUpsert.mock.calls.length, 1));
  // The refusal is only knowable from this response, and the cell has to say so.
  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'fail');
  });
  assert.match(
    cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('aria-label') ?? '',
    /permission denied/,
  );
  // A refused write never reached codex's file, so its cached read is still good.
  assert.deepEqual(mocks.invalidateCache.mock.calls, [['claude']]);

  // Clicking the failed cell replays the write the save was reaching for.
  respondToggle(
    entry('1', 'notion', 'stdio', { command: 'npx-v2' }, ['claude', 'codex']),
    [{ provider: 'codex', action: 'upsert', ok: true }],
  );
  fireEvent.click(cellFor(rowFor(container, 'notion'), 'Codex'));

  await waitFor(() => {
    assert.equal(cellFor(rowFor(container, 'notion'), 'Codex').getAttribute('data-state'), 'on');
  });
  assert.deepEqual(mocks.mcpCatalogToggle.mock.calls[0], ['1', { provider: 'codex', enabled: true }]);
});

test('opens the row menu above the dialog layer that hosts the matrix', async () => {
  const container = await renderMatrix();

  fireEvent.click(buttonFor(container, 'mcpMatrix.row.menuLabel:{"name":"notion"}'));

  assertMenuOutranksDialog(document.querySelector('[role="menu"]'));
});

test('opens the column menu above the dialog layer too', async () => {
  const container = await renderMatrix();

  fireEvent.click(buttonFor(container, 'mcpMatrix.bulk.menuLabel:{"provider":"Codex"}'));

  assertMenuOutranksDialog(document.querySelector('[role="menu"]'));
});
