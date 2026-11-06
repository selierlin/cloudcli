import {
  MCP_ADD_BLOCKED_REASON,
  MCP_PROVIDER_NAMES,
  MCP_SUPPORTED_SCOPES,
  MCP_SUPPORTED_TRANSPORTS,
} from '@/shared/constants';
import type { McpAddBlockedReason, McpCatalogEntry, McpProvider, McpTransport } from '@/shared/types';

/**
 * The visual state of one MCP-matrix cell.
 *
 * `on`/`off` mirror the catalog's per-harness switch. `external` is a cell the
 * harness already mounts from its own configuration: the server is live, but
 * the app cannot write or clear it. `disabled` is a capability refusal the user
 * cannot override (the harness accepts no app-managed writes at all, or cannot
 * speak the entry's transport); `fail` is a write the harness refused at
 * projection time and which can be retried.
 */
export type McpMatrixCellState = 'on' | 'off' | 'fail' | 'external' | 'disabled';

/** Why a cell is not an ordinary switch: the harness refuses every app-managed write, cannot speak the entry's transport, or supplies the name itself. */
export type McpMatrixDisabledReason =
  | { kind: McpAddBlockedReason }
  | { kind: 'transport'; transport: McpTransport }
  | { kind: 'external' };

/**
 * The harnesses that get a column in the MCP matrix.
 *
 * A column requires a user-scope config to project into, so `pi` and `omp`
 * (no supported scope at all) never appear. A harness that has a user scope but
 * refuses app-managed writes still gets a column — it is rendered as disabled
 * so the matrix states the reason instead of silently hiding the harness.
 */
export const MCP_MATRIX_PROVIDERS: McpProvider[] = (
  Object.keys(MCP_PROVIDER_NAMES) as McpProvider[]
).filter((provider) => MCP_SUPPORTED_SCOPES[provider].includes('user'));

/**
 * Why this entry cannot be switched in this harness, or null when the cell is a
 * normal on/off switch.
 *
 * Kept separate from the state so the UI can show the reason (hover text) for a
 * non-switchable cell without re-deriving it from the entry's transport, and so
 * the batch writers skip these cells with one check.
 */
export const getCellDisabledReason = (
  entry: McpCatalogEntry,
  provider: McpProvider,
): McpMatrixDisabledReason | null => {
  // Checked first: whoever supplies the name outranks any capability question,
  // and the switch would write a duplicate that the harness drops.
  if (entry.externallyManaged?.includes(provider)) {
    return { kind: 'external' };
  }

  const blockedReason = MCP_ADD_BLOCKED_REASON[provider];
  if (blockedReason) {
    return { kind: blockedReason };
  }

  if (!MCP_SUPPORTED_TRANSPORTS[provider].includes(entry.transport)) {
    return { kind: 'transport', transport: entry.transport };
  }

  return null;
};

/**
 * Resolves the state one matrix cell renders for an entry and harness.
 *
 * Precedence is capability, then write outcome, then the switch: a harness that
 * can never take the entry stays refused even if a write failed there, and a
 * failed projection outranks `on`/`off` because the switch alone would claim the
 * harness's config file was updated when it was not.
 */
export const getCellState = (
  entry: McpCatalogEntry,
  provider: McpProvider,
  hasFailedWrite = false,
): McpMatrixCellState => {
  const reason = getCellDisabledReason(entry, provider);
  if (reason?.kind === 'external') {
    return 'external';
  }

  if (reason) {
    return 'disabled';
  }

  if (hasFailedWrite) {
    return 'fail';
  }

  return entry.enabled[provider] ? 'on' : 'off';
};

/**
 * The searchable text of one entry.
 *
 * The haystack is the explicit allow-list from the design's §11.1 —
 * `name` / `command` / `args` / `cwd` / `url` — and nothing else. A server's
 * `env`, `headers` and `envHttpHeaders` may hold credentials, so none of them
 * ever reaches the search input (or a result count derived from it).
 */
export const getSearchText = (entry: McpCatalogEntry): string => {
  const { config } = entry;
  return [
    entry.name,
    config.command,
    config.url,
    config.cwd,
    ...(config.args ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
};
