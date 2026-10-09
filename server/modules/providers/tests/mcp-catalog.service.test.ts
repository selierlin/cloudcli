import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMcpCatalogService } from '@/modules/providers/services/mcp-catalog.service.js';
import type {
  LLMProvider,
  McpCatalogConfig,
  McpCatalogEntry,
  McpScope,
  McpTransport,
  ProviderMcpServer,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const patchHomeDir = (nextHomeDir: string): (() => void) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const PROVIDERS: LLMProvider[] = [
  'claude',
  'cursor',
  'codex',
  'opencode',
  'dsh',
  'workbuddy',
  'pi',
  'zcode',
  'omp',
];

const disabled = (): Record<LLMProvider, boolean> =>
  Object.fromEntries(PROVIDERS.map((provider) => [provider, false])) as Record<LLMProvider, boolean>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * In-memory stand-in for the SQLite catalog, mirroring `mcpServersDb`'s
 * observable behavior (including returning the row after each mutation).
 */
const createFakeCatalog = () => {
  const entries = new Map<string, McpCatalogEntry>();
  let counter = 0;

  const clone = (entry: McpCatalogEntry): McpCatalogEntry => ({
    ...entry,
    config: { ...entry.config },
    enabled: { ...entry.enabled },
  });

  return {
    entries,
    listCatalogEntries: () => [...entries.values()].map(clone),
    getCatalogEntry: (id: string) => {
      const entry = entries.get(id);
      return entry ? clone(entry) : null;
    },
    findCatalogEntryByName: (name: string) => {
      const entry = [...entries.values()].find((candidate) => candidate.name === name);
      return entry ? clone(entry) : null;
    },
    createCatalogEntry: (draft: { name: string; transport: McpTransport; config: McpCatalogConfig }) => {
      const id = `id-${++counter}`;
      const entry: McpCatalogEntry = {
        id,
        name: draft.name,
        transport: draft.transport,
        config: draft.config,
        enabled: disabled(),
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      };
      entries.set(id, entry);
      return clone(entry);
    },
    updateCatalogEntry: (
      id: string,
      draft: { name: string; transport: McpTransport; config: McpCatalogConfig },
    ) => {
      const entry = entries.get(id);
      if (!entry) {
        return null;
      }

      const next: McpCatalogEntry = {
        ...entry,
        name: draft.name,
        transport: draft.transport,
        config: draft.config,
      };
      entries.set(id, next);
      return clone(next);
    },
    deleteCatalogEntry: (id: string) => {
      const entry = entries.get(id);
      if (!entry) {
        return null;
      }

      entries.delete(id);
      return clone(entry);
    },
    setCatalogAppEnabled: (id: string, provider: LLMProvider, enabled: boolean) => {
      const entry = entries.get(id);
      if (!entry) {
        return null;
      }

      const next: McpCatalogEntry = { ...entry, enabled: { ...entry.enabled, [provider]: enabled } };
      entries.set(id, next);
      return clone(next);
    },
  };
};

/**
 * In-memory stand-in for the harness adapters.
 *
 * It records every write, can make a harness refuse writes (the shape a
 * harness-managed or scope-less harness has), and tracks how many writes were
 * in flight at once per harness so the serialization guarantee is observable.
 */
const createFakeProviders = () => {
  const serversByProvider = new Map<LLMProvider, Map<string, UpsertProviderMcpServerInput>>();
  const upserts: Array<{ provider: LLMProvider; name: string }> = [];
  const removes: Array<{ provider: LLMProvider; name: string }> = [];
  const refusals = new Map<LLMProvider, string>();
  const inFlight = new Map<LLMProvider, number>();
  const peakInFlight = new Map<LLMProvider, number>();
  /** User-scope servers each harness already holds, as the seeder reads them. */
  const rawUserServers = new Map<LLMProvider, ProviderMcpServer[]>();
  /**
   * Scopes each harness can persist to, mirroring the real adapters: dsh is
   * harness-managed (writes throw) and pi/omp manage no MCP at all.
   */
  const writableScopes = new Map<LLMProvider, McpScope[]>(
    PROVIDERS.map((provider) => [
      provider,
      provider === 'dsh' || provider === 'pi' || provider === 'omp'
        ? []
        : ['user', 'project'] as McpScope[],
    ]),
  );
  /** Harnesses the seeder actually read, so "skips non-writable" is observable. */
  const rawReads: LLMProvider[] = [];
  let enterHook: ((provider: LLMProvider) => Promise<void>) | undefined;

  const serversFor = (provider: LLMProvider): Map<string, UpsertProviderMcpServerInput> => {
    let servers = serversByProvider.get(provider);
    if (!servers) {
      servers = new Map();
      serversByProvider.set(provider, servers);
    }

    return servers;
  };

  const track = async <TResult>(
    provider: LLMProvider,
    run: () => Promise<TResult>,
  ): Promise<TResult> => {
    const active = (inFlight.get(provider) ?? 0) + 1;
    inFlight.set(provider, active);
    peakInFlight.set(provider, Math.max(peakInFlight.get(provider) ?? 0, active));
    try {
      if (enterHook) {
        await enterHook(provider);
      }

      const refusal = refusals.get(provider);
      if (refusal) {
        throw new AppError(refusal, { code: 'FAKE_HARNESS_REFUSED', statusCode: 400 });
      }

      return await run();
    } finally {
      inFlight.set(provider, active - 1);
    }
  };

  const mcpFor = (provider: LLMProvider) => ({
    upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
      return track(provider, async () => {
        upserts.push({ provider, name: input.name });
        serversFor(provider).set(input.name, { ...input });
        return { provider, name: input.name, scope: 'user' as McpScope, transport: input.transport };
      });
    },
    removeServer(input: { name: string; scope?: McpScope }) {
      return track(provider, async () => {
        removes.push({ provider, name: input.name });
        const removed = serversFor(provider).delete(input.name);
        return { removed, provider, name: input.name, scope: 'user' as McpScope };
      });
    },
    listWritableScopes: () => writableScopes.get(provider) ?? [],
    listRawServersForScope: (scope: McpScope) => {
      rawReads.push(provider);
      return Promise.resolve(scope === 'user' ? (rawUserServers.get(provider) ?? []) : []);
    },
  });

  const adapters = new Map(PROVIDERS.map((provider) => [provider, mcpFor(provider)] as const));

  return {
    source: {
      listProviders: () => PROVIDERS.map((id) => ({ id, mcp: adapters.get(id)! })),
      resolveProvider: (provider: string) => ({ mcp: adapters.get(provider as LLMProvider)! }),
    },
    serversFor,
    upserts,
    removes,
    refusals,
    peakInFlight,
    rawUserServers,
    writableScopes,
    rawReads,
    setEnterHook: (hook: (provider: LLMProvider) => Promise<void>) => {
      enterHook = hook;
    },
  };
};

/** In-memory `app_config` stand-in for the seeder's one-shot flag. */
const createFakeFlags = () => {
  const values = new Map<string, string>();

  return {
    values,
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const createService = () => {
  const catalog = createFakeCatalog();
  const providers = createFakeProviders();
  const flags = createFakeFlags();
  return {
    catalog,
    providers,
    flags,
    service: createMcpCatalogService({ catalog, providers: providers.source, flags }),
  };
};

const writersFor = (
  calls: Array<{ provider: LLMProvider; name: string }>,
  provider?: LLMProvider,
): string[] => calls
  .filter((call) => !provider || call.provider === provider)
  .map((call) => `${call.provider}:${call.name}`);

test('mcpCatalogService creates entries with a trimmed name and empty switches', async () => {
  const { service } = createService();

  const { entry, outcomes } = await service.upsertCatalogEntry({
    name: '  filesystem  ',
    transport: 'stdio',
    config: { command: 'npx' },
  });

  assert.equal(entry.name, 'filesystem');
  assert.equal(entry.transport, 'stdio');
  assert.equal(entry.config.command, 'npx');
  assert.deepEqual(entry.enabled, disabled());
  // A new entry has no enabled harness, so it is never projected.
  assert.deepEqual(outcomes, []);
  assert.deepEqual(service.listCatalog().map((item) => item.name), ['filesystem']);
});

test('mcpCatalogService rejects an empty name', async () => {
  const { service } = createService();

  await assert.rejects(
    () => service.upsertCatalogEntry({ name: '   ', transport: 'stdio', config: {} }),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'MCP_SERVER_NAME_REQUIRED'
      && error.statusCode === 400,
  );
});

test('mcpCatalogService rejects a duplicate name on create and on rename', async () => {
  const { service } = createService();
  const first = (await service.upsertCatalogEntry({ name: 'alpha', transport: 'stdio', config: {} })).entry;
  const second = (await service.upsertCatalogEntry({ name: 'beta', transport: 'stdio', config: {} })).entry;

  await assert.rejects(
    () => service.upsertCatalogEntry({ name: 'alpha', transport: 'http', config: {} }),
    (error: unknown) =>
      error instanceof AppError && error.code === 'MCP_CATALOG_NAME_ALREADY_EXISTS',
  );

  await assert.rejects(
    () => service.upsertCatalogEntry({ id: second.id, name: 'alpha', transport: 'stdio', config: {} }),
    (error: unknown) =>
      error instanceof AppError && error.code === 'MCP_CATALOG_NAME_ALREADY_EXISTS',
  );

  // Renaming an entry to its own name is not a conflict.
  const renamed = (await service.upsertCatalogEntry({
    id: first.id,
    name: 'alpha',
    transport: 'http',
    config: { url: 'https://example.test/mcp' },
  })).entry;
  assert.equal(renamed.transport, 'http');
  assert.equal(renamed.config.url, 'https://example.test/mcp');
});

test('mcpCatalogService rejects an update of an unknown id', async () => {
  const { service } = createService();

  await assert.rejects(
    () => service.upsertCatalogEntry({ id: 'missing', name: 'x', transport: 'stdio', config: {} }),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'MCP_CATALOG_ENTRY_NOT_FOUND'
      && error.statusCode === 404,
  );
});

test('mcpCatalogService re-projects an edit only into the harnesses it is enabled for', async () => {
  const { providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'codex', true);
  await service.toggleCatalogApp(entry.id, 'claude', true);
  providers.upserts.length = 0;

  const { entry: updated, outcomes } = await service.upsertCatalogEntry({
    id: entry.id,
    name: 'filesystem',
    transport: 'http',
    config: { url: 'https://example.test/mcp' },
  });

  assert.equal(updated.id, entry.id);
  assert.equal(updated.transport, 'http');
  // Switches survive an edit.
  assert.equal(updated.enabled.codex, true);
  assert.deepEqual(outcomes.map((outcome) => outcome.ok), [true, true]);
  assert.deepEqual(
    writersFor(providers.upserts).sort(),
    ['claude:filesystem', 'codex:filesystem'],
  );
  assert.equal(providers.serversFor('cursor').size, 0);
});

test('mcpCatalogService toggles one harness on and writes only that harness', async () => {
  const { providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  providers.serversFor('claude').set('user-owned', { name: 'user-owned', scope: 'user', transport: 'stdio' });

  const { entry: toggled, outcomes } = await service.toggleCatalogApp(entry.id, 'claude', true);

  assert.equal(toggled.enabled.claude, true);
  assert.equal(toggled.enabled.codex, false);
  assert.deepEqual(outcomes, [{ provider: 'claude', action: 'upsert', ok: true }]);
  assert.deepEqual(writersFor(providers.upserts), ['claude:filesystem']);
  // An entry the catalog does not own is never touched by a projection.
  assert.equal(providers.serversFor('claude').has('user-owned'), true);

  await assert.rejects(
    () => service.toggleCatalogApp('missing', 'claude', true),
    (error: unknown) =>
      error instanceof AppError && error.code === 'MCP_CATALOG_ENTRY_NOT_FOUND',
  );
});

test('mcpCatalogService toggles one harness off and clears it from that harness', async () => {
  const { providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'claude', true);

  const { entry: toggled, outcomes } = await service.toggleCatalogApp(entry.id, 'claude', false);

  assert.equal(toggled.enabled.claude, false);
  assert.deepEqual(outcomes, [{ provider: 'claude', action: 'remove', ok: true }]);
  assert.deepEqual(writersFor(providers.removes), ['claude:filesystem']);
  assert.equal(providers.serversFor('claude').has('filesystem'), false);
});

test('mcpCatalogService reports a harness that refuses the write without undoing the switch', async () => {
  const { providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  providers.refusals.set('dsh', 'DSH manages its own MCP servers.');

  const { entry: toggled, outcomes } = await service.toggleCatalogApp(entry.id, 'dsh', true);

  // The switch is the user's intent and stays set, so the matrix can render a
  // retryable failed cell instead of silently discarding the request.
  assert.equal(toggled.enabled.dsh, true);
  assert.deepEqual(outcomes, [{
    provider: 'dsh',
    action: 'upsert',
    ok: false,
    error: 'DSH manages its own MCP servers.',
  }]);
  assert.deepEqual(providers.upserts, []);
});

test('mcpCatalogService restores the response redaction marker instead of storing it', async () => {
  const { catalog, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx', env: { API_KEY: 'super-secret' } },
  });

  const { entry: updated } = await service.upsertCatalogEntry({
    id: entry.id,
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx-v2', env: { API_KEY: '<redacted>' } },
  });

  assert.equal(updated.config.command, 'npx-v2');
  // The response stays redacted; the row the form's marker was resolved against
  // kept the real credential, which is what a later projection writes out.
  assert.equal(updated.config.env?.API_KEY, '<redacted>');
  assert.equal(catalog.entries.get(entry.id)?.config.env?.API_KEY, 'super-secret');

  // An untouched key is still removed, and a new literal value replaces it.
  const { entry: removedKey } = await service.upsertCatalogEntry({
    id: entry.id,
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx-v2', env: { OTHER: 'fresh' } },
  });
  assert.deepEqual(removedKey.config.env, { OTHER: '<redacted>' });
  assert.deepEqual(catalog.entries.get(entry.id)?.config.env, { OTHER: 'fresh' });
});

test('mcpCatalogService redacts secrets in every response while the row and the projection keep them', async () => {
  const { catalog, providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: {
      command: 'npx',
      env: { API_KEY: 'super-secret' },
      headers: { Authorization: 'Bearer token' },
      envHttpHeaders: { 'X-Key': 'env-secret' },
    },
  });

  // The create response is the first thing the matrix reads, so it redacts too.
  assert.deepEqual(entry.config.env, { API_KEY: '<redacted>' });
  assert.deepEqual(entry.config.headers, { Authorization: '<redacted>' });
  assert.deepEqual(entry.config.envHttpHeaders, { 'X-Key': '<redacted>' });
  // The stored row is the SSOT and holds the raw values (redaction is a
  // response concern) — a `<redacted>` here would be projected literally into a
  // harness file and destroy the credential.
  assert.deepEqual(catalog.entries.get(entry.id)?.config.env, { API_KEY: 'super-secret' });

  const [listed] = service.listCatalog();
  assert.deepEqual(listed.config.env, { API_KEY: '<redacted>' });

  const toggled = await service.toggleCatalogApp(entry.id, 'claude', true);
  assert.deepEqual(toggled.entry.config.env, { API_KEY: '<redacted>' });
  // The projection itself received the raw definition, which is the whole point
  // of redacting only at the response layer.
  assert.deepEqual(providers.serversFor('claude').get('filesystem')?.env, { API_KEY: 'super-secret' });
  assert.deepEqual(
    providers.serversFor('claude').get('filesystem')?.headers,
    { Authorization: 'Bearer token' },
  );
  // A mutation response may not leak into the store either.
  assert.deepEqual(catalog.entries.get(entry.id)?.config.env, { API_KEY: 'super-secret' });
});

test('mcpCatalogService clears the old key before writing a renamed entry', async () => {
  const { providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'old-name',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'claude', true);
  providers.upserts.length = 0;
  providers.removes.length = 0;

  await service.upsertCatalogEntry({
    id: entry.id,
    name: 'new-name',
    transport: 'stdio',
    config: { command: 'npx' },
  });

  assert.deepEqual(writersFor(providers.removes), ['claude:old-name']);
  assert.deepEqual(writersFor(providers.upserts), ['claude:new-name']);
  assert.deepEqual([...providers.serversFor('claude').keys()], ['new-name']);
});

test('mcpCatalogService reports a rename whose old key could not be cleared and writes nothing', async () => {
  const { catalog, providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'old-name',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'claude', true);
  providers.refusals.set('claude', 'config file is read-only');

  const { entry: renamed, outcomes } = await service.upsertCatalogEntry({
    id: entry.id,
    name: 'new-name',
    transport: 'stdio',
    config: { command: 'npx' },
  });

  // The cleanup comes first, so a refusal leaves the harness holding the old key
  // and nothing half-written under the new one — the residual to report.
  assert.deepEqual(
    outcomes.map((outcome) => `${outcome.provider}:${outcome.action}:${outcome.ok}`),
    ['claude:remove:false'],
  );
  assert.deepEqual([...providers.serversFor('claude').keys()], ['old-name']);
  // The catalog row is the commit point and keeps the new name either way.
  assert.equal(renamed.name, 'new-name');
  assert.equal(catalog.entries.get(entry.id)?.name, 'new-name');
});

test('mcpCatalogService renames an entry whose old key is already gone from the harness', async () => {
  const { providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'old-name',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'claude', true);
  // The switch says claude holds the entry, but the user deleted it from the
  // file — a stale switch must not block the rename for good.
  providers.serversFor('claude').delete('old-name');

  const { outcomes } = await service.upsertCatalogEntry({
    id: entry.id,
    name: 'new-name',
    transport: 'stdio',
    config: { command: 'npx' },
  });

  assert.deepEqual(
    outcomes.map((outcome) => `${outcome.provider}:${outcome.action}:${outcome.ok}`),
    ['claude:upsert:true'],
  );
  assert.deepEqual([...providers.serversFor('claude').keys()], ['new-name']);
});

test('mcpCatalogService clears every enabled harness before deleting the row', async () => {
  const { catalog, providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'claude', true);
  await service.toggleCatalogApp(entry.id, 'codex', true);

  const result = await service.deleteCatalogEntry(entry.id);

  assert.equal(result.removed, true);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.action), ['remove', 'remove']);
  assert.deepEqual(
    writersFor(providers.removes).sort(),
    ['claude:filesystem', 'codex:filesystem'],
  );
  assert.equal(catalog.entries.size, 0);

  await assert.rejects(
    () => service.deleteCatalogEntry('missing'),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'MCP_CATALOG_ENTRY_NOT_FOUND'
      && error.statusCode === 404,
  );
});

test('mcpCatalogService keeps the row when a harness refuses the removal', async () => {
  const { catalog, providers, service } = createService();
  const { entry } = await service.upsertCatalogEntry({
    name: 'filesystem',
    transport: 'stdio',
    config: { command: 'npx' },
  });
  await service.toggleCatalogApp(entry.id, 'claude', true);
  await service.toggleCatalogApp(entry.id, 'codex', true);
  providers.refusals.set('codex', 'Codex config is unreadable.');

  const result = await service.deleteCatalogEntry(entry.id);

  // Deleting the row would strand the entry in the refusing harness with no way
  // to find it again, so the row survives and the delete can be retried.
  assert.equal(result.removed, false);
  assert.deepEqual(
    result.outcomes,
    [
      { provider: 'claude', action: 'remove', ok: true },
      { provider: 'codex', action: 'remove', ok: false, error: 'Codex config is unreadable.' },
    ],
  );
  assert.equal(catalog.entries.size, 1);
});

test('mcpCatalogService serializes concurrent projections into the same harness', async () => {
  const { providers, service } = createService();
  const first = (await service.upsertCatalogEntry({ name: 'first', transport: 'stdio', config: {} })).entry;
  const second = (await service.upsertCatalogEntry({ name: 'second', transport: 'stdio', config: {} })).entry;
  const third = (await service.upsertCatalogEntry({ name: 'third', transport: 'stdio', config: {} })).entry;

  // Every adapter call yields to the event loop, so unsynchronized projections
  // would be observed running against one harness at the same time.
  providers.setEnterHook(async () => {
    await sleep(5);
  });

  await Promise.all([
    service.toggleCatalogApp(first.id, 'claude', true),
    service.toggleCatalogApp(second.id, 'claude', true),
    service.toggleCatalogApp(third.id, 'claude', true),
  ]);

  assert.equal(providers.peakInFlight.get('claude'), 1);
  assert.deepEqual(writersFor(providers.upserts).sort(), [
    'claude:first',
    'claude:second',
    'claude:third',
  ]);
});

test('mcpCatalogService resync re-applies enabled entries and clears the rest of a managed harness', async () => {
  const { providers, service } = createService();
  const enabled = (await service.upsertCatalogEntry({ name: 'enabled', transport: 'stdio', config: {} })).entry;
  await service.upsertCatalogEntry({ name: 'disabled', transport: 'stdio', config: {} });
  await service.toggleCatalogApp(enabled.id, 'claude', true);
  providers.upserts.length = 0;
  providers.removes.length = 0;

  const outcomes = await service.resyncCatalogToProviders();

  // Claude is the only harness the catalog manages, so every catalog entry is
  // re-applied there: the enabled one written, the other cleared.
  assert.deepEqual(
    outcomes.map((outcome) => `${outcome.provider}:${outcome.action}:${outcome.ok}`),
    ['claude:upsert:true', 'claude:remove:true'],
  );
  assert.deepEqual(writersFor(providers.upserts), ['claude:enabled']);
  assert.deepEqual(writersFor(providers.removes), ['claude:disabled']);
  // Harnesses with no enabled entry are never visited, so a harness that cannot
  // accept app-managed writes never produces a failure no retry could clear.
  assert.deepEqual(writersFor(providers.upserts, 'dsh'), []);
  assert.deepEqual(writersFor(providers.removes, 'pi'), []);
});

test('mcpCatalogService keeps concurrent projections into one real harness file intact', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'mcp-catalog-projection-'));
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // The real adapter writes a real config file; only the catalog is faked.
    const catalog = createFakeCatalog();
    const service = createMcpCatalogService({ catalog });
    const first = (await service.upsertCatalogEntry({
      name: 'first',
      transport: 'stdio',
      config: { command: 'npx' },
    })).entry;
    const second = (await service.upsertCatalogEntry({
      name: 'second',
      transport: 'stdio',
      config: { command: 'npx' },
    })).entry;

    const results = await Promise.all([
      service.toggleCatalogApp(first.id, 'claude', true),
      service.toggleCatalogApp(second.id, 'claude', true),
    ]);

    assert.deepEqual(
      results.flatMap((result) => result.outcomes.map((outcome) => outcome.ok)),
      [true, true],
    );
    // Without a per-harness write queue the two read-modify-write cycles
    // interleave and the second write drops the first entry.
    const config = JSON.parse(
      await readFile(path.join(tempRoot, '.claude.json'), 'utf8'),
    ) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(config.mcpServers).sort(), ['first', 'second']);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('mcpCatalogService seeds existing user-scope servers and stores raw secrets', async () => {
  const { catalog, providers, flags, service } = createService();
  providers.rawUserServers.set('claude', [{
    provider: 'claude',
    name: 'filesystem',
    scope: 'user',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { API_KEY: 'super-secret' },
  }]);
  // The same definition reported by a second harness joins the entry instead of
  // conflicting, because projecting it back is a no-op.
  providers.rawUserServers.set('codex', [{
    provider: 'codex',
    name: 'filesystem',
    scope: 'user',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { API_KEY: 'super-secret' },
  }]);

  const result = await service.seedCatalogOnce();

  assert.deepEqual(result, { seeded: 1, conflicts: [] });
  const entry = catalog.listCatalogEntries()[0];
  assert.equal(entry.name, 'filesystem');
  // The raw definition is stored; redaction is a response-layer concern. Reading
  // through `listServersForScope` would have persisted `<redacted>` here.
  assert.equal(entry.config.env?.API_KEY, 'super-secret');
  assert.equal(entry.enabled.claude, true);
  assert.equal(entry.enabled.codex, true);
  assert.equal(entry.enabled.cursor, false);
  // Seeding only fills the catalog; it never writes a harness file.
  assert.deepEqual(providers.upserts, []);
  assert.deepEqual(providers.removes, []);
  assert.equal(flags.values.size, 1);
});

test('mcpCatalogService seeding skips harnesses whose adapter reports no writable scope', async () => {
  const { catalog, providers, service } = createService();
  const server = (provider: LLMProvider, name: string): ProviderMcpServer => ({
    provider,
    name,
    scope: 'user',
    transport: 'stdio',
    command: 'npx',
  });
  // dsh/pi/omp can be read from but never written back to, so a catalog row for
  // them could never be toggled off or deleted.
  providers.rawUserServers.set('dsh', [server('dsh', 'dsh-managed')]);
  providers.rawUserServers.set('pi', [server('pi', 'pi-managed')]);
  providers.rawUserServers.set('omp', [server('omp', 'omp-managed')]);
  providers.rawUserServers.set('claude', [server('claude', 'claude-owned')]);

  const result = await service.seedCatalogOnce();

  assert.deepEqual(catalog.listCatalogEntries().map((entry) => entry.name), ['claude-owned']);
  assert.equal(result.seeded, 1);
  // A skipped harness is never even read.
  assert.deepEqual(providers.rawReads, ['claude', 'cursor', 'codex', 'opencode', 'workbuddy', 'zcode']);
});

test('mcpCatalogService seeding keeps the first definition of a conflicting name', async () => {
  const { catalog, providers, service } = createService();
  providers.rawUserServers.set('claude', [{
    provider: 'claude',
    name: 'shared',
    scope: 'user',
    transport: 'stdio',
    command: 'claude-command',
  }]);
  providers.rawUserServers.set('codex', [{
    provider: 'codex',
    name: 'shared',
    scope: 'user',
    transport: 'stdio',
    command: 'codex-command',
  }]);

  const result = await service.seedCatalogOnce();

  assert.equal(result.seeded, 1);
  assert.deepEqual(result.conflicts, ['shared']);
  const entry = catalog.listCatalogEntries()[0];
  assert.equal(entry.config.command, 'claude-command');
  // Enabling codex would project claude's definition into it, silently
  // rewriting the user's Codex config, so only the owning harness is enabled.
  assert.equal(entry.enabled.claude, true);
  assert.equal(entry.enabled.codex, false);
});

test('mcpCatalogService seeds the catalog only once', async () => {
  const { catalog, providers, service } = createService();
  providers.rawUserServers.set('claude', [{
    provider: 'claude',
    name: 'filesystem',
    scope: 'user',
    transport: 'stdio',
    command: 'npx',
  }]);

  const first = await service.seedCatalogOnce();
  providers.rawReads.length = 0;
  const second = await service.seedCatalogOnce();

  assert.equal(first.seeded, 1);
  assert.deepEqual(second, { seeded: 0, conflicts: [] });
  // The guard short-circuits before any harness is read again.
  assert.deepEqual(providers.rawReads, []);
  assert.equal(catalog.listCatalogEntries().length, 1);
});
