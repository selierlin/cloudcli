import { isDeepStrictEqual } from 'node:util';

import { appConfigDb, mcpServersDb } from '@/modules/database/index.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { redactMcpValues, restoreRedactedMcpValues } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type {
  LLMProvider,
  McpCatalogConfig,
  McpCatalogEntry,
  McpCatalogProjectionOutcome,
  McpScope,
  McpTransport,
  ProviderMcpServer,
  UpsertMcpCatalogEntryInput,
  UpsertProviderMcpServerInput,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * SQLite catalog operations the service needs, narrowed so tests can stub them.
 */
type McpCatalogStore = Pick<
  typeof mcpServersDb,
  | 'listCatalogEntries'
  | 'getCatalogEntry'
  | 'findCatalogEntryByName'
  | 'createCatalogEntry'
  | 'updateCatalogEntry'
  | 'deleteCatalogEntry'
  | 'setCatalogAppEnabled'
>;

/**
 * The slice of one harness adapter the projection uses.
 *
 * Narrowed to the write calls plus the two reads the seeder needs, so unit tests
 * can inject a fake without building a whole provider; the real adapters own the
 * scope/transport gate (`assertScopeAndTransport`) and every write-safety measure
 * (atomic replace, symlink refusal, permission tightening).
 */
type McpCatalogProjectionAdapter = {
  upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer>;
  removeServer(input: { name: string; scope?: McpScope }): Promise<unknown>;
  listWritableScopes(): McpScope[];
  listRawServersForScope(scope: McpScope): Promise<ProviderMcpServer[]>;
};

type McpCatalogProviderSource = {
  listProviders(): Array<{ id: LLMProvider; mcp: McpCatalogProjectionAdapter }>;
  resolveProvider(provider: string): { mcp: McpCatalogProjectionAdapter };
};

/** Minimal `app_config` surface the one-shot seeder needs to run at most once. */
type McpCatalogFlagStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

type McpCatalogServiceDependencies = {
  catalog?: McpCatalogStore;
  providers?: McpCatalogProviderSource;
  flags?: McpCatalogFlagStore;
};

/** `app_config` key that records the one-shot seed has run. */
const SEED_FLAG_KEY = 'mcp.catalog.seeded';

/**
 * One catalog entry as the matrix consumes it, plus the result of every
 * harness write the call attempted.
 */
type McpCatalogWriteResult = {
  entry: McpCatalogEntry;
  outcomes: McpCatalogProjectionOutcome[];
};

const CATALOG_SCOPE: McpScope = 'user';

const isUniqueConstraintError = (error: unknown): boolean => (
  error !== null
  && error !== undefined
  && typeof error === 'object'
  && 'code' in error
  && String(error.code).startsWith('SQLITE_CONSTRAINT')
);

const describeError = (error: unknown): string =>
  (error instanceof Error ? error.message : 'Unknown error');

const normalizeName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError('MCP server name is required.', {
      code: 'MCP_SERVER_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  return trimmed;
};

const nameTakenError = (name: string): AppError => new AppError(
  `An MCP server named "${name}" already exists.`,
  { code: 'MCP_CATALOG_NAME_ALREADY_EXISTS', statusCode: 409 },
);

const notFoundError = (): AppError => new AppError('MCP catalog entry not found.', {
  code: 'MCP_CATALOG_ENTRY_NOT_FOUND',
  statusCode: 404,
});

/**
 * Re-applies the edit form's redaction markers against the stored definition.
 *
 * The catalog holds raw secrets (redaction is a response concern), but the edit
 * form echoes `<redacted>` back for keys the user did not touch. Without this
 * restore the placeholder would be persisted and later projected literally into
 * a harness config, destroying the credential.
 */
const restoreConfigSecrets = (
  next: McpCatalogConfig,
  previous?: McpCatalogConfig,
): McpCatalogConfig => ({
  ...next,
  env: restoreRedactedMcpValues(next.env, previous?.env),
  headers: restoreRedactedMcpValues(next.headers, previous?.headers),
  envHttpHeaders: restoreRedactedMcpValues(next.envHttpHeaders, previous?.envHttpHeaders),
});

/**
 * Extracts the catalog definition from one normalized harness server.
 *
 * Absent and empty fields are dropped so two harnesses that normalize the same
 * server to `{}` and `{ args: [] }` still compare equal when the seeder checks
 * whether their definitions agree.
 */
const toCatalogConfig = (server: ProviderMcpServer): McpCatalogConfig => {
  const config: McpCatalogConfig = {};
  if (server.command) config.command = server.command;
  if (server.args?.length) config.args = server.args;
  if (server.env && Object.keys(server.env).length > 0) config.env = server.env;
  if (server.cwd) config.cwd = server.cwd;
  if (server.url) config.url = server.url;
  if (server.headers && Object.keys(server.headers).length > 0) config.headers = server.headers;
  if (server.envVars?.length) config.envVars = server.envVars;
  if (server.bearerTokenEnvVar) config.bearerTokenEnvVar = server.bearerTokenEnvVar;
  if (server.envHttpHeaders && Object.keys(server.envHttpHeaders).length > 0) {
    config.envHttpHeaders = server.envHttpHeaders;
  }

  return config;
};

/**
 * Strips the secrets of one catalog definition for the response.
 *
 * The catalog row holds raw values (redaction is a response concern, §6.1), so
 * every entry leaving this service passes through here: without it the matrix
 * would show each stored credential, and the edit form would echo it back to
 * the browser. An entry is not bound to one harness, hence the shared redactor
 * rather than a provider's own `sanitizeServerForResponse`.
 */
const redactCatalogConfig = (config: McpCatalogConfig): McpCatalogConfig => ({
  ...config,
  env: redactMcpValues(config.env),
  headers: redactMcpValues(config.headers),
  envHttpHeaders: redactMcpValues(config.envHttpHeaders),
});

/** One catalog entry as the response layer may show it; the stored row keeps the raw values. */
const redactCatalogEntry = (entry: McpCatalogEntry): McpCatalogEntry => ({
  ...entry,
  config: redactCatalogConfig(entry.config),
});

/** One harvested definition plus every harness that reported an identical one. */
type SeededCandidate = {
  transport: McpTransport;
  config: McpCatalogConfig;
  providers: LLMProvider[];
};

/**
 * Serializes projections per harness.
 *
 * `writeJsonConfig`/`writeTomlConfig` rewrite the whole config file with no
 * temp-file swap and no lock, so concurrent read-modify-write cycles against
 * the same harness can drop one another's entries. Every projection therefore
 * runs through one promise chain per harness, which also covers the
 * remove-then-upsert pair of a rename.
 */
const createProviderWriteQueue = () => {
  const tails = new Map<LLMProvider, Promise<void>>();

  return async <TResult>(
    provider: LLMProvider,
    operation: () => Promise<TResult>,
  ): Promise<TResult> => {
    const previous = tails.get(provider) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(provider, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(provider) === current) {
        tails.delete(provider);
      }
    }
  };
};

/**
 * App-side MCP catalog service used by the MCP matrix routes.
 *
 * It owns the catalog (SSOT) rows and their per-harness enable switches. The
 * catalog row is the commit point of every mutation; each enabled harness is
 * then written best-effort, and a harness that refuses the write is reported as
 * a failed outcome instead of failing the request. Per-harness switches are set
 * before projection, so a failed projection is retryable from the matrix or by
 * `resyncCatalogToProviders`.
 */
export const createMcpCatalogService = (
  dependencies: McpCatalogServiceDependencies = {},
) => {
  const catalog = dependencies.catalog ?? mcpServersDb;
  const providers = dependencies.providers ?? providerRegistry;
  const flags = dependencies.flags ?? appConfigDb;
  const runSerialized = createProviderWriteQueue();

  const readCatalogEntry = (id: string): McpCatalogEntry => {
    const entry = catalog.getCatalogEntry(id);
    if (!entry) {
      throw notFoundError();
    }

    return entry;
  };

  const assertNameAvailable = (name: string, currentId?: string): void => {
    const existing = catalog.findCatalogEntryByName(name);
    if (existing && existing.id !== currentId) {
      throw nameTakenError(name);
    }
  };

  /** Writes one entry into one harness, reporting the adapter's rejection. */
  const projectUpsert = (
    entry: McpCatalogEntry,
    provider: LLMProvider,
    previousName?: string,
  ): Promise<McpCatalogProjectionOutcome> => runSerialized(provider, async () => {
    const adapter = providers.resolveProvider(provider).mcp;

    // A rename leaves the old key behind in every harness that had it, which
    // would make the old name unreachable from the catalog and invisible in the
    // matrix, so the stale key is cleared before the new one is written.
    if (previousName && previousName !== entry.name) {
      try {
        await adapter.removeServer({ name: previousName, scope: CATALOG_SCOPE });
      } catch (error) {
        return { provider, action: 'remove', ok: false, error: describeError(error) };
      }
    }

    try {
      await adapter.upsertServer({
        name: entry.name,
        scope: CATALOG_SCOPE,
        transport: entry.transport,
        ...entry.config,
      });
      return { provider, action: 'upsert', ok: true };
    } catch (error) {
      return { provider, action: 'upsert', ok: false, error: describeError(error) };
    }
  });

  /** Clears one entry from one harness, reporting the adapter's rejection. */
  const projectRemove = (
    entry: McpCatalogEntry,
    provider: LLMProvider,
  ): Promise<McpCatalogProjectionOutcome> => runSerialized(provider, async () => {
    try {
      await providers.resolveProvider(provider).mcp.removeServer({
        name: entry.name,
        scope: CATALOG_SCOPE,
      });
      return { provider, action: 'remove', ok: true };
    } catch (error) {
      return { provider, action: 'remove', ok: false, error: describeError(error) };
    }
  });

  /** Re-writes every harness the entry is enabled for. */
  const projectEntry = async (
    entry: McpCatalogEntry,
    previousName?: string,
  ): Promise<McpCatalogProjectionOutcome[]> => {
    const outcomes: McpCatalogProjectionOutcome[] = [];
    for (const provider of providers.listProviders()) {
      if (!entry.enabled[provider.id]) {
        continue;
      }

      outcomes.push(await projectUpsert(entry, provider.id, previousName));
    }

    return outcomes;
  };

  const createCatalogEntry = (input: UpsertMcpCatalogEntryInput): McpCatalogEntry => {
    const name = normalizeName(input.name);
    assertNameAvailable(name);

    try {
      return catalog.createCatalogEntry({
        name,
        transport: input.transport,
        config: input.config ?? {},
      });
    } catch (error) {
      // The row-level UNIQUE(name) is the authoritative guard against a race
      // between the availability check above and the insert.
      if (isUniqueConstraintError(error)) {
        throw nameTakenError(name);
      }
      throw error;
    }
  };

  const updateCatalogEntry = (
    id: string,
    input: UpsertMcpCatalogEntryInput,
    previous: McpCatalogEntry,
  ): McpCatalogEntry => {
    const name = normalizeName(input.name);
    assertNameAvailable(name, id);
    const config = restoreConfigSecrets(input.config ?? {}, previous.config);

    try {
      const updated = catalog.updateCatalogEntry(id, {
        name,
        transport: input.transport,
        config,
      });
      if (!updated) {
        throw notFoundError();
      }

      return updated;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw nameTakenError(name);
      }
      throw error;
    }
  };

  return {
    /** Lists every catalog entry with its per-harness switches. */
    listCatalog(): McpCatalogEntry[] {
      return catalog.listCatalogEntries().map(redactCatalogEntry);
    },

    /**
     * Creates a new catalog entry, or updates one when `input.id` is present,
     * then re-projects it into every enabled harness.
     *
     * A create starts with every switch off, so it has nothing to project; an
     * update keeps the existing switches and rewrites those harnesses.
     */
    async upsertCatalogEntry(input: UpsertMcpCatalogEntryInput): Promise<McpCatalogWriteResult> {
      if (!input.id) {
        return { entry: redactCatalogEntry(createCatalogEntry(input)), outcomes: [] };
      }

      const previous = readCatalogEntry(input.id);
      const entry = updateCatalogEntry(input.id, input, previous);
      // The projection writes the raw definition; only the response is redacted.
      return { entry: redactCatalogEntry(entry), outcomes: await projectEntry(entry, previous.name) };
    },

    /**
     * Removes one catalog entry.
     *
     * The harnesses are cleared before the row is deleted: if any of them
     * refuses the removal the row is kept so the entry stays visible and the
     * delete can be retried, rather than leaving a config entry that neither
     * the matrix nor `resync` can reach.
     */
    async deleteCatalogEntry(id: string): Promise<{
      removed: boolean;
      outcomes: McpCatalogProjectionOutcome[];
    }> {
      const entry = readCatalogEntry(id);
      const outcomes: McpCatalogProjectionOutcome[] = [];
      let failed = false;
      for (const provider of providers.listProviders()) {
        if (!entry.enabled[provider.id]) {
          continue;
        }

        const outcome = await projectRemove(entry, provider.id);
        outcomes.push(outcome);
        failed = failed || !outcome.ok;
      }

      if (failed) {
        return { removed: false, outcomes };
      }

      return { removed: catalog.deleteCatalogEntry(id) !== null, outcomes };
    },

    /**
     * Flips one harness switch atomically, then projects that single entry into
     * (or out of) the harness. Projection failure is reported, not thrown: the
     * switch is the user's intent and `resync` can retry it.
     */
    async toggleCatalogApp(
      id: string,
      provider: LLMProvider,
      enabled: boolean,
    ): Promise<McpCatalogWriteResult> {
      readCatalogEntry(id);
      const updated = catalog.setCatalogAppEnabled(id, provider, enabled);
      if (!updated) {
        throw notFoundError();
      }

      const outcome = enabled
        ? await projectUpsert(updated, provider)
        : await projectRemove(updated, provider);
      return { entry: redactCatalogEntry(updated), outcomes: [outcome] };
    },

    /**
     * Escape hatch: re-applies the whole catalog from its switches.
     *
     * Only harnesses that are enabled for at least one entry are visited. A
     * harness with no enabled entry was never written by the catalog, and the
     * structurally-unwritable harnesses (no `user` scope, or self-managed) can
     * never hold one — visiting them would only produce failures that no retry
     * could clear.
     */
    async resyncCatalogToProviders(): Promise<McpCatalogProjectionOutcome[]> {
      const entries = catalog.listCatalogEntries();
      const outcomes: McpCatalogProjectionOutcome[] = [];

      for (const provider of providers.listProviders()) {
        if (!entries.some((entry) => entry.enabled[provider.id])) {
          continue;
        }

        for (const entry of entries) {
          outcomes.push(
            entry.enabled[provider.id]
              ? await projectUpsert(entry, provider.id)
              : await projectRemove(entry, provider.id),
          );
        }
      }

      return outcomes;
    },

    /**
     * One-shot harvest of the harnesses' existing user-scope servers into the
     * catalog, guarded by an `app_config` flag so it runs at most once.
     *
     * The first writable harness to report a name owns its definition. A later
     * harness with an identical definition joins it — projecting the same
     * definition back is a no-op — while a differing one is left switched off
     * and reported in `conflicts`, so seeding never silently rewrites a harness
     * with another harness's definition. Nothing is written back to any file.
     */
    async seedCatalogOnce(): Promise<{ seeded: number; conflicts: string[] }> {
      if (flags.get(SEED_FLAG_KEY)) {
        return { seeded: 0, conflicts: [] };
      }

      const candidates = new Map<string, SeededCandidate>();
      const conflicts = new Set<string>();

      for (const provider of providers.listProviders()) {
        if (!provider.mcp.listWritableScopes().includes(CATALOG_SCOPE)) {
          continue;
        }

        let servers: ProviderMcpServer[];
        try {
          servers = await provider.mcp.listRawServersForScope(CATALOG_SCOPE);
        } catch {
          // Best-effort: one unreadable harness must not block the rest. It
          // stays file-native and simply out of the catalog.
          continue;
        }

        for (const server of servers) {
          const config = toCatalogConfig(server);
          const existing = candidates.get(server.name);
          if (!existing) {
            candidates.set(server.name, {
              transport: server.transport,
              config,
              providers: [provider.id],
            });
          } else if (existing.transport === server.transport && isDeepStrictEqual(existing.config, config)) {
            existing.providers.push(provider.id);
          } else {
            conflicts.add(server.name);
          }
        }
      }

      let seeded = 0;
      for (const [name, candidate] of candidates) {
        // Restartable: an earlier run that crashed before setting the flag may
        // already have written some rows.
        if (catalog.findCatalogEntryByName(name)) {
          continue;
        }

        const entry = catalog.createCatalogEntry({
          name,
          transport: candidate.transport,
          config: candidate.config,
        });
        for (const provider of candidate.providers) {
          catalog.setCatalogAppEnabled(entry.id, provider, true);
        }

        seeded += 1;
      }

      flags.set(SEED_FLAG_KEY, 'true');
      return { seeded, conflicts: [...conflicts] };
    },
  };
};

/** Shared MCP catalog service used by the MCP matrix routes. */
export const mcpCatalogService = createMcpCatalogService();
