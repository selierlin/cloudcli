import { spawnSync } from 'node:child_process';

import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

import { DSH_ACP_PROFILE, getDshHome } from './dsh-models.provider.js';

/**
 * Composition reader for the DeepSeek Harness's own Cordis configuration.
 *
 * DSH declares its plugins as loader patch entries in a Cordis composition
 * (`$DSH_HOME/cordis.patch.yml` plus each profile's own patch layer) rather
 * than a single config document the way Claude or Codex expose one, so both the
 * MCP servers and the pi-ai provider routes live in the composed tree. Rather
 * than re-implementing the composer's layer order, overrides and disable rules
 * - and drifting from them on every harness upgrade - this reads the composed
 * tree the CLI prints for the exact profile the runtime boots. The settings
 * surfaces and the running sessions therefore agree by construction.
 *
 * Used by the DSH MCP provider to report the harness's servers read-only and by
 * the DSH model adapter to list the configured pi-ai provider routes.
 */

/** Loader package that bridges an external MCP server into the harness tool list. */
const DSH_MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';

/** Upper bound on the dump subprocess so a wedged CLI cannot stall a settings request. */
const DUMP_TIMEOUT_MS = 10_000;

/**
 * Generous stdout bound: a plugin-heavy profile can outgrow the 1 MiB spawn
 * default, and a truncated document would decode as "no servers" instead of
 * failing loudly.
 */
const DUMP_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** YAML tag the composer leaves in place for harness-side expressions. */
const JS_TAG = '!!js';

/** Matches a mapping entry (`key:` or `key: value`) but not a plain scalar, a URL or a nested sequence item. */
const MAPPING_ENTRY = /^[^\s:][^:]*:(\s|$)/;

/** Matches a block scalar header (`>`, `>-`, `|`, `|2`) whose value is the indented lines below it. */
const BLOCK_SCALAR_HEADER = /^[>|][+-]?\d*$/;

/** Parsed value of the YAML subset the dump uses: scalars, sequences and mappings. */
type ComposedValue = string | ComposedValue[] | { [key: string]: ComposedValue };

/** One significant line of the dump: its indentation width and its content without it. */
type ComposedLine = { indent: number; text: string };

/**
 * Drops blank and comment lines and records each remaining line's indentation.
 * The dump is serializer output, so the parser only ever meets plain two-space
 * block style - no flow collections beyond empty ones, no anchors, no tags
 * other than `!!js`.
 */
function toSignificantLines(document: string): ComposedLine[] {
  const lines: ComposedLine[] = [];
  for (const raw of document.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text || text.startsWith('#')) {
      continue;
    }
    lines.push({ indent: raw.length - raw.trimStart().length, text });
  }
  return lines;
}

/** Removes the single or double quotes the serializer adds around ambiguous scalars. */
function stripQuotes(text: string): string {
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return text;
}

/**
 * Reads one scalar. `!!js` values are harness-side expressions, so their source
 * text is kept verbatim instead of being evaluated, and the empty flow
 * collections the serializer emits (`[]`, `{}`) collapse to an empty string,
 * which the config mapper reads as "not set".
 */
function parseScalar(text: string): string {
  if (text.startsWith(JS_TAG)) {
    return stripQuotes(text.slice(JS_TAG.length).trim());
  }
  if (text === '[]' || text === '{}') {
    return '';
  }
  return stripQuotes(text);
}

/**
 * Returns the block scalar header a value declares, ignoring an optional `!!js`
 * tag in front of it, or null when the value is a plain scalar. The tag has to
 * be stripped first because the composer emits tagged expressions in both
 * forms, and mistaking `!!js >-` for a scalar would leave the block's own lines
 * unread and desynchronize the rest of the document.
 */
function blockScalarHeader(remainder: string): string | null {
  const untagged = remainder.startsWith(JS_TAG) ? remainder.slice(JS_TAG.length).trim() : remainder;
  return BLOCK_SCALAR_HEADER.test(untagged) ? untagged : null;
}

/**
 * Collects the indented lines of a block scalar and joins them the way its style
 * requires. The lines are kept verbatim: a folded block may hold a harness-side
 * expression whose own quotes are part of the expression.
 */
function readBlockScalar(
  lines: ComposedLine[],
  from: number,
  headerIndent: number,
  folded: boolean,
): { text: string; next: number } {
  const parts: string[] = [];
  let index = from;
  while (index < lines.length && lines[index].indent > headerIndent) {
    parts.push(lines[index].text);
    index += 1;
  }
  return { text: parts.join(folded ? ' ' : '\n'), next: index };
}

/** True for a `-` or `- ...` line, which can only be a sequence item at its own indentation. */
function isSequenceItem(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

/**
 * Reads a mapping whose entries sit at `indent`. `seed` carries the entry that
 * shares its line with a parent `- ` marker, such as the `id: mcp-dbhub` in
 * `- id: mcp-dbhub`, because that entry's value has to be resolved from the
 * same lookahead as any other.
 */
function parseMapping(
  lines: ComposedLine[],
  from: number,
  indent: number,
  seed?: string,
): { value: Record<string, ComposedValue>; next: number } {
  const value: Record<string, ComposedValue> = {};

  const readEntry = (entry: string, after: number): number => {
    const separator = entry.indexOf(':');
    const key = entry.slice(0, separator).trim();
    const remainder = entry.slice(separator + 1).trim();
    const header = blockScalarHeader(remainder);
    if (header) {
      const block = readBlockScalar(lines, after, indent, header.startsWith('>'));
      value[key] = block.text;
      return block.next;
    }
    if (remainder) {
      value[key] = parseScalar(remainder);
      return after;
    }
    const child = lines[after];
    if (child && child.indent > indent) {
      const parsed = parseBlock(lines, after, child.indent);
      value[key] = parsed.value;
      return parsed.next;
    }
    value[key] = '';
    return after;
  };

  let index = from;
  if (seed !== undefined) {
    index = readEntry(seed, index);
  }
  while (
    index < lines.length
    && lines[index].indent === indent
    && MAPPING_ENTRY.test(lines[index].text)
  ) {
    index = readEntry(lines[index].text, index + 1);
  }
  return { value, next: index };
}

/** Reads a sequence whose `- ` items sit at `indent`. */
function parseSequence(
  lines: ComposedLine[],
  from: number,
  indent: number,
): { value: ComposedValue[]; next: number } {
  const value: ComposedValue[] = [];
  let index = from;

  while (
    index < lines.length
    && lines[index].indent === indent
    && isSequenceItem(lines[index].text)
  ) {
    const item = lines[index].text.slice(1).trim();
    if (item && MAPPING_ENTRY.test(item)) {
      // A mapping item whose remaining keys are indented under the dash.
      const mapping = parseMapping(lines, index + 1, indent + 2, item);
      value.push(mapping.value);
      index = mapping.next;
      continue;
    }
    const header = blockScalarHeader(item);
    if (header) {
      const block = readBlockScalar(lines, index + 1, indent, header.startsWith('>'));
      value.push(block.text);
      index = block.next;
      continue;
    }
    if (item) {
      value.push(parseScalar(item));
      index += 1;
      continue;
    }
    const child = lines[index + 1];
    if (child && child.indent > indent) {
      const parsed = parseBlock(lines, index + 1, child.indent);
      value.push(parsed.value);
      index = parsed.next;
      continue;
    }
    value.push('');
    index += 1;
  }

  return { value, next: index };
}

/** Reads the block that starts at `from`, whose members all sit at `indent`. */
function parseBlock(
  lines: ComposedLine[],
  from: number,
  indent: number,
): { value: ComposedValue; next: number } {
  return isSequenceItem(lines[from].text)
    ? parseSequence(lines, from, indent)
    : parseMapping(lines, from, indent);
}

/**
 * Parses a composed DSH profile tree into its loader entries, keyed by entry id.
 *
 * The composer prints one flat sequence: every entry carries its own `id`,
 * `name`, optional `config` and optional `disabled`, with `insert` layers
 * already expanded in place. A reader that needs one plugin's resolved config
 * looks its entry up by id instead of re-implementing the composer's layer
 * order, so it sees whatever the profile and home patch layers actually
 * produced.
 *
 * Used by the DSH MCP and DSH model readers; exported for the DSH tests, which
 * drive it with recorded dump output.
 */
export function parseDshComposedEntries(document: string): Record<string, Record<string, unknown>> {
  const lines = toSignificantLines(document);
  if (lines.length === 0) {
    return {};
  }

  const composed = parseBlock(lines, 0, lines[0].indent);
  if (!Array.isArray(composed.value)) {
    return {};
  }

  const entries: Record<string, Record<string, unknown>> = {};
  for (const entry of composed.value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    // Duplicate ids cannot occur in a composed tree, but keeping the last one
    // mirrors the loader, which lets a later layer's entry win.
    if (typeof entry.id === 'string' && entry.id.trim()) {
      entries[entry.id.trim()] = entry;
    }
  }

  return entries;
}

/**
 * Reads the entries the harness composes for the profile the runtime boots.
 *
 * Used by the DSH MCP and DSH model readers. A missing, failing or overrunning
 * CLI yields an empty map, so a machine without a usable DSH falls back to its
 * own config documents instead of failing the settings request.
 */
export function readDshComposedEntries(): Record<string, Record<string, unknown>> {
  const dump = spawnSync('dsh', ['--profile', DSH_ACP_PROFILE, '--dump-config'], {
    encoding: 'utf8',
    timeout: DUMP_TIMEOUT_MS,
    maxBuffer: DUMP_MAX_BUFFER_BYTES,
    // Pin the harness home the ACP runtime spawns with, so the listed entries
    // are the ones the sessions actually load.
    env: { ...process.env, DSH_HOME: getDshHome() },
  });

  if (dump.error || dump.status !== 0 || typeof dump.stdout !== 'string') {
    const reason = dump.error?.message ?? `dsh exited with code ${dump.status}`;
    console.warn(`[DSH] composed config unavailable: ${reason}`);
    return {};
  }

  return parseDshComposedEntries(dump.stdout);
}

/**
 * Keeps the MCP client entries of a composed tree, keyed by each entry's
 * `serverName` so callers can treat the result like any other provider's
 * name-to-raw-config map. Entries from other plugins, disabled entries and
 * entries without a usable server name are skipped, and each config is returned
 * untouched so the provider adapter owns the field mapping.
 */
function mcpServerConfigsFromEntries(
  entries: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const configs: Record<string, unknown> = {};
  for (const entry of Object.values(entries)) {
    if (entry.name !== DSH_MCP_CLIENT_PACKAGE || entry.disabled === 'true') {
      continue;
    }
    const config = readObjectRecord(entry.config);
    const serverName = readOptionalString(config?.serverName);
    if (!config || !serverName) {
      continue;
    }
    configs[serverName] = config;
  }

  return configs;
}

/**
 * Extracts the MCP server declarations from a composed tree document.
 *
 * Exported for the DSH MCP test, which drives it with recorded dump output.
 */
export function parseDshMcpServerConfigs(document: string): Record<string, unknown> {
  return mcpServerConfigsFromEntries(parseDshComposedEntries(document));
}

/**
 * Reads the MCP servers the harness loads for the profile the runtime boots.
 *
 * Used by the DSH MCP provider. A missing, failing or overrunning CLI yields an
 * empty map, so a machine without a usable DSH shows "no servers configured"
 * instead of failing the settings request.
 */
export function readDshComposedMcpServerConfigs(): Record<string, unknown> {
  return mcpServerConfigsFromEntries(readDshComposedEntries());
}
