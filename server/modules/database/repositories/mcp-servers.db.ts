/**
 * App-side MCP server catalog persistence consumed by the Providers module.
 *
 * This is the SSOT for user-scope MCP definitions. Harness-native config files
 * are projections written by the providers module; nothing here touches those
 * files. Rows carry the raw (unredacted) connection definition plus one enable
 * switch per harness.
 */

import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';
import type { LLMProvider, McpCatalogConfig, McpCatalogEntry, McpTransport } from '@/shared/types.js';

type McpServerRow = {
  id: string;
  name: string;
  transport: McpTransport;
  server_config: string;
  enabled_claude: number;
  enabled_cursor: number;
  enabled_codex: number;
  enabled_opencode: number;
  enabled_dsh: number;
  enabled_workbuddy: number;
  enabled_pi: number;
  enabled_zcode: number;
  enabled_omp: number;
  created_at: string;
  updated_at: string;
};

/** The connection fields a caller supplies; the repository mints `id`. */
type McpCatalogEntryDraft = {
  name: string;
  transport: McpTransport;
  config: McpCatalogConfig;
};

/**
 * Maps each harness to its enable column.
 *
 * Typed as a full `Record<LLMProvider, ...>` so adding a provider without a
 * matching column fails the build instead of silently dropping the switch.
 * Every value is a literal column name, so building an `UPDATE` from it cannot
 * inject SQL.
 */
const ENABLED_COLUMN_BY_PROVIDER: Record<LLMProvider, keyof McpServerRow> = {
  claude: 'enabled_claude',
  cursor: 'enabled_cursor',
  codex: 'enabled_codex',
  opencode: 'enabled_opencode',
  dsh: 'enabled_dsh',
  workbuddy: 'enabled_workbuddy',
  pi: 'enabled_pi',
  zcode: 'enabled_zcode',
  omp: 'enabled_omp',
};

const parseServerConfig = (raw: string): McpCatalogConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as McpCatalogConfig;
    }
  } catch {
    // A hand-edited or corrupt row degrades to an empty definition rather than
    // breaking the whole catalog listing.
  }

  return {};
};

const toEnabledMap = (row: McpServerRow): Record<LLMProvider, boolean> => {
  const enabled = {} as Record<LLMProvider, boolean>;
  for (const [provider, column] of Object.entries(ENABLED_COLUMN_BY_PROVIDER) as [
    LLMProvider,
    keyof McpServerRow,
  ][]) {
    enabled[provider] = row[column] === 1;
  }

  return enabled;
};

const toMcpCatalogEntry = (row: McpServerRow): McpCatalogEntry => ({
  id: row.id,
  name: row.name,
  transport: row.transport,
  config: parseServerConfig(row.server_config),
  enabled: toEnabledMap(row),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readMcpServerRow = (id: string): McpServerRow | null => {
  const row = getConnection()
    .prepare('SELECT * FROM mcp_servers WHERE id = ?')
    .get(id) as McpServerRow | undefined;

  return row ?? null;
};

export const mcpServersDb = {
  listCatalogEntries(): McpCatalogEntry[] {
    const rows = getConnection()
      .prepare('SELECT * FROM mcp_servers ORDER BY lower(name) ASC, id ASC')
      .all() as McpServerRow[];

    return rows.map(toMcpCatalogEntry);
  },

  getCatalogEntry(id: string): McpCatalogEntry | null {
    const row = readMcpServerRow(id);
    return row ? toMcpCatalogEntry(row) : null;
  },

  findCatalogEntryByName(name: string): McpCatalogEntry | null {
    const row = getConnection()
      .prepare('SELECT * FROM mcp_servers WHERE name = ?')
      .get(name) as McpServerRow | undefined;

    return row ? toMcpCatalogEntry(row) : null;
  },

  createCatalogEntry(draft: McpCatalogEntryDraft): McpCatalogEntry {
    const db = getConnection();
    const id = randomUUID();
    db.prepare(
      'INSERT INTO mcp_servers (id, name, transport, server_config) VALUES (?, ?, ?, ?)',
    ).run(id, draft.name, draft.transport, JSON.stringify(draft.config));

    const row = readMcpServerRow(id);
    if (!row) {
      throw new Error('Created MCP catalog entry could not be read back.');
    }

    return toMcpCatalogEntry(row);
  },

  updateCatalogEntry(id: string, draft: McpCatalogEntryDraft): McpCatalogEntry | null {
    const result = getConnection()
      .prepare(`
        UPDATE mcp_servers
        SET name = ?, transport = ?, server_config = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(draft.name, draft.transport, JSON.stringify(draft.config), id);

    if (result.changes === 0) {
      return null;
    }

    const row = readMcpServerRow(id);
    return row ? toMcpCatalogEntry(row) : null;
  },

  deleteCatalogEntry(id: string): McpCatalogEntry | null {
    const db = getConnection();
    const remove = db.transaction(() => {
      const row = readMcpServerRow(id);
      if (!row) {
        return null;
      }

      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
      return row;
    });

    const row = remove();
    return row ? toMcpCatalogEntry(row) : null;
  },

  setCatalogAppEnabled(
    id: string,
    provider: LLMProvider,
    enabled: boolean,
  ): McpCatalogEntry | null {
    const column = ENABLED_COLUMN_BY_PROVIDER[provider];
    if (!column) {
      return null;
    }

    const result = getConnection()
      .prepare(`UPDATE mcp_servers SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(enabled ? 1 : 0, id);

    if (result.changes === 0) {
      return null;
    }

    const row = readMcpServerRow(id);
    return row ? toMcpCatalogEntry(row) : null;
  },
};
